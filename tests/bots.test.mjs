import assert from 'node:assert/strict';
import test from 'node:test';
import * as bots from '../server/bots.ts';
import { advanceActor, canStand, yawToward } from '../lib/game/rules.ts';
import { MatchSimulation } from '../server/simulation.ts';

const actor = (overrides = {}) => ({ id:'bot', x:8, y:0, z:-8, yaw:0, pitch:0, alive:true, ammo:30, reserve:120, reloadLeft:0, cooldown:0, ...overrides });
const human = (overrides = {}) => ({ id:'human', x:8, y:0, z:-15, alive:true, ...overrides });
function controller(difficulty = 'normal') { assert.equal(typeof bots.BotController, 'function'); return new bots.BotController(difficulty, () => .8); }
function step(ai, bot, targets, dt = .05) { const result=ai.update(bot,targets,dt); bot.yaw=result.yaw;bot.pitch=result.pitch;return result; }
const seeded=(initial=42)=>{let seed=initial;return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};

test('reaction delays match the approved offline baseline', () => {
  for(const [difficulty,reaction] of [['easy',1.25],['normal',.85],['hard',.5]]){
    assert.equal(bots.botSettings(difficulty).reaction,reaction);
    const ai=controller(difficulty),bot=actor();
    for(let i=0;i<Math.floor(reaction/.01)-1;i++) assert.equal(step(ai,bot,[human()],.01).fire,false);
  }
});

test('seeded aim intersections at 10–20m roughly follow offline accuracy and bursts limit shot rate', t => {
  for(const [difficulty,accuracy] of [['easy',.28],['normal',.42],['hard',.58]]){
    let hits=0,shots=0;
    for(const dist of [10,15,20]){
      const ai=new bots.BotController(difficulty,seeded(731+dist)),bot=actor({x:20,z:2}),target=human({x:20,z:2-dist});
      for(let i=0;i<120*60;i++){
        bot.cooldown=Math.max(0,bot.cooldown-1/60);
        const d=step(ai,bot,[target],1/60);
        if(!d.fire)continue;
        bot.cooldown=.105;shots++;
        const along=dist*Math.cos(d.yaw),side=Math.abs(dist*Math.sin(d.yaw)),hitY=1.65+Math.tan(d.pitch)*along;
        if(along>0&&side<=.55&&hitY>=.2&&hitY<=1.98)hits++;
      }
    }
    const rate=hits/shots;
    t.diagnostic(`${difficulty}: ${Math.round(rate*100)}% intersections; ${(shots/360).toFixed(2)} shots/sec`);
    assert.ok(Math.abs(rate-accuracy)<.12,`${difficulty} intersection rate ${rate} should approximate ${accuracy}`);
    assert.ok(shots/360<4,'burst rests must cap sustained rifle output');
  }
});

test('each acquisition and target switch has its own reaction delay', () => {
  const ai=controller(), bot=actor();
  for(let i=0;i<10;i++) assert.equal(step(ai,bot,[human()]).fire,false);
  assert.ok(Array.from({length:10},()=>step(ai,bot,[human()])).some(d=>d.fire));
  for(let i=0;i<10;i++) assert.equal(step(ai,bot,[human({id:'new'})]).fire,false);
  assert.equal(step(ai,actor({id:'second'}),[human()]).fire,false);
});

test('does not fire without a target or through cover and reacquires after sight loss', () => {
  const ai=controller('hard'), bot=actor();
  for(let i=0;i<30;i++) step(ai,bot,[human()]);
  assert.equal(step(ai,bot,[]).fire,false);
  assert.equal(step(ai,bot,[human()]).fire,false);
  const covered=actor({x:-9,z:3});
  for(let i=0;i<50;i++) assert.equal(step(ai,covered,[human({x:-9,z:-18})]).fire,false);
});

test('tracking is bounded and aim remains imperfect after tracking settles', () => {
  const ai=controller(), bot=actor({yaw:Math.PI/2}), target=human();
  const first=step(ai,bot,[target]);
  assert.ok(Math.abs(first.yaw-Math.PI/2)<.3);
  assert.ok(Math.abs(first.yaw-yawToward(bot,target))>.2);
  for(let i=0;i<100;i++) step(ai,bot,[target]);
  assert.ok(Math.abs(bot.yaw-yawToward(bot,target))>.001);
});

test('bursts include deliberate rests and reload never fires', () => {
  const ai=controller('hard'), bot=actor();
  const decisions=Array.from({length:100},()=>step(ai,bot,[human()]));
  const first=decisions.findIndex(d=>d.fire);
  assert.ok(first>=0);
  assert.ok(decisions.slice(first+1).some(d=>!d.fire));
  const empty=step(ai,actor({ammo:0}),[human()]);
  assert.equal(empty.reload,true);assert.equal(empty.fire,false);
  assert.equal(step(ai,actor({reloadLeft:1}),[human()]).fire,false);
  assert.equal(step(ai,actor({cooldown:.2}),[human()]).fire,false);
});

test('navigation routes around cover using shared collision', () => {
  const ai=controller('hard'), bot=actor({x:-9,z:3}), target=human({x:-9,z:-18});
  let maxDetour=0;
  for(let i=0;i<400;i++) {
    const decision=step(ai,bot,[target]);
    const moved=advanceActor(bot,decision.input,{y:0,grounded:true,velocityY:0},.05);
    Object.assign(bot,moved.position);
    assert.ok(canStand(bot.x,bot.z));maxDetour=Math.max(maxDetour,Math.abs(bot.x+9));
  }
  assert.ok(maxDetour>3);assert.ok(bot.z<-14);
});

test('injected seeded randomness reproduces decisions', () => {
  const a=new bots.BotController('normal',seeded()),b=new bots.BotController('normal',seeded());
  const left=actor(),right=actor();
  for(let i=0;i<100;i++) assert.deepEqual(step(a,left,[human()]),step(b,right,[human()]));
});

test('distance and target movement increase angular aim error', () => {
  const measure=(z,moving)=>{
    const ai=controller(),bot=actor(),target=human({z});
    for(let i=0;i<60;i++) {if(moving)target.x+=.02;step(ai,bot,[target]);}
    return Math.abs(bot.yaw-yawToward(bot,target));
  };
  assert.ok(measure(-21,false)>measure(-12,false));
  assert.ok(measure(-15,true)>measure(-15,false));
});

test('bot and human shots use identical body and head damage at every difficulty', () => {
  for(const difficulty of ['easy','normal','hard'])for(const pitch of [0,.03]){
    const health=[];
    for(const isBot of [false,true]){
      const sim=new RifleFixture([{id:'a',nickname:'A',x:8,z:-8,isBot},{id:'b',nickname:'B',x:8,z:-15}],{difficulty,now:()=>1000});
      sim.player('b').spawnProtection=0;
      assert.equal(sim.fire('a',{sequence:1,weapon:'rifle',yaw:0,pitch,clientTime:1000}),true);
      health.push(sim.player('b').health);
    }
    assert.deepEqual(health,pitch===0?[70,70]:[0,0]);
  }
});

// Combat/motion fixtures explicitly arrange a purchased rifle and ammunition.
class RifleFixture extends MatchSimulation {
 constructor(...args){super(...args);for(const p of this.players.values()){p.coins=6000;this.buy(p.id,'buy_weapon','rifle','fixture-rifle');for(let n=0;n<4;n++)this.buy(p.id,'buy_ammo','rifle','fixture-ammo-'+n);p.cooldown=0;p.input.aiming=true;}}
}
