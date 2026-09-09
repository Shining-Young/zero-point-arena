import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';

registerHooks({resolve(specifier,context,nextResolve){
  try{return nextResolve(specifier,context);}catch(error){
    if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return nextResolve(specifier+'.ts',context);
    throw error;
  }
}});
const {ArenaGame,INITIAL}=await import('../lib/game/engine.ts');
const {makeSoldier}=await import('../lib/game/world.ts');
const {WeaponPresentation}=await import('../lib/game/weapon-presentation.ts');
const quiet={shot(){},hit(){},kill(){},reload(){},tone(){}};
function harness(){
  const g=Object.create(ArenaGame.prototype);
  Object.assign(g,{state:{...INITIAL,phase:'playing',feed:[],bots:[]},options:{difficulty:'normal',sensitivity:1,sound:false},
    scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(76,1,.06,160),audio:quiet,presentation:new WeaponPresentation(),
    bots:[],effects:[],solid:[],guns:[new THREE.Group(),new THREE.Group()],gunRig:new THREE.Group(),
    keys:new Set(),ammo:[{ammo:30,reserve:120},{ammo:12,reserve:60}],cooldown:0,reloadLeft:0,
    recoil:0,clock:0,feedTimes:[],pitch:0,yaw:0,moving:false,aiming:false,
    callback(){},resume(){this.state.phase='playing';},flashTime:0});
  g.camera.position.set(0,1.15,8);g.camera.lookAt(0,1.15,0);g.camera.updateMatrixWorld(true);
  return g;
}
function addBot(g,x=0,z=0){
  const b={...makeSoldier(0),id:0,health:100,dead:0,cooldown:0,noticed:4,path:[],repath:1,walk:0,spawnShield:0,lastSeen:null};
  b.root.position.set(x,0,z);b.targets.forEach(t=>t.userData.bot=0);g.bots.push(b);g.scene.add(b.root);return b;
}
function inputEnvironment(g){
  const previousDocument=globalThis.document,previousWindow=globalThis.window;
  const doc=new EventTarget(),win=new EventTarget(),canvas=new EventTarget();
  doc.pointerLockElement=null;doc.exitPointerLock=()=>{doc.pointerLockElement=null;};
  canvas.focus=()=>{};canvas.requestPointerLock=()=>Promise.reject(new Error('blocked'));
  globalThis.document=doc;globalThis.window=win;g.renderer={domElement:canvas};g.abort=new AbortController();g.bind();
  return {doc,canvas,move(x,y,target=canvas){const e=new Event('mousemove');Object.defineProperties(e,{target:{value:target},movementX:{value:x},movementY:{value:y}});doc.dispatchEvent(e);},cleanup(){g.abort.abort();globalThis.document=previousDocument;globalThis.window=previousWindow;}};
}
test('unlocked compatibility mode follows mouse movement without holding the right button',()=>{
  const g=harness();g.state.fallback=true;g.dragging=false;const env=inputEnvironment(g);
  try{env.move(50,20);assert.ok(g.yaw<0);assert.ok(g.pitch<0);}finally{env.cleanup();}
});
test('moving over menus does not turn the unlocked camera',()=>{
  const g=harness();g.state.fallback=true;const env=inputEnvironment(g);
  try{env.move(50,20,env.doc);assert.equal(g.yaw,0);g.state.phase='paused';env.move(50,20);assert.equal(g.yaw,0);}finally{env.cleanup();}
});

test('right click toggles ADS through release and menus suppress gameplay input',()=>{
  const g=harness(),env=inputEnvironment(g);
  const mouse=(type,button)=>{const event=new Event(type,{cancelable:true});Object.defineProperty(event,'button',{value:button});(type==='mousedown'?env.canvas:env.doc).dispatchEvent(event);};
  try{
    env.doc.pointerLockElement=env.canvas;
    mouse('mousedown',2);assert.equal(g.aiming,true);
    mouse('mouseup',2);assert.equal(g.aiming,true);
    mouse('mousedown',2);assert.equal(g.aiming,false);
    mouse('mousedown',2);g.pause();assert.equal(g.presentation.aimIntent,false);
    mouse('mousedown',0);mouse('mousedown',2);
    const key=new Event('keydown');Object.defineProperty(key,'code',{value:'KeyW'});env.doc.dispatchEvent(key);
    assert.equal(g.shooting,false);assert.equal(g.aiming,false);assert.equal(g.keys.size,0);
  }finally{env.cleanup();}
});

test('switching weapons and death clear the intended aim even during reload',()=>{
  const g=harness();g.presentation.toggleAim();g.aiming=true;g.ammo[0].ammo=3;g.reload();
  assert.equal(g.aiming,false);assert.equal(g.presentation.aimIntent,true);
  g.switchWeapon(1);assert.equal(g.presentation.aimIntent,false);
  g.presentation.toggleAim();addBot(g,-19,-10);g.state.x=-19;g.state.z=-18;g.state.health=1;g.state.protection=0;
  const random=Math.random;Math.random=()=>0;
  try{g.updateBots(.016);assert.equal(g.state.health,0);assert.equal(g.presentation.aimIntent,false);}finally{Math.random=random;}
});

test('all offline bot difficulties use the same rifle body damage as the player',()=>{
  const shooter=harness(),victim=addBot(shooter);shooter.shoot();const damage=100-victim.health;
  const random=Math.random;Math.random=()=>0;
  try{for(const difficulty of ['easy','normal','hard']){const g=harness();g.options.difficulty=difficulty;addBot(g,-19,-10);g.state.x=-19;g.state.z=-18;g.state.protection=0;g.updateBots(.016);assert.equal(100-g.state.health,damage,difficulty);}}finally{Math.random=random;}
});
test('pointer lock can be retried and rejection preserves mouse compatibility mode',async()=>{
  const g=harness();const env=inputEnvironment(g);
  try{await g.requestMouseLock();assert.equal(g.state.fallback,true);env.move(50,0);assert.ok(g.yaw<0);}finally{env.cleanup();}
});
test('starting a fresh round restores the rifle model after using the pistol',()=>{
  const g=harness();g.state.weapon=1;g.guns[0].visible=false;g.guns[1].visible=true;
  g.start(g.options);
  assert.equal(g.state.weapon,0);assert.equal(g.guns[0].visible,true);assert.equal(g.guns[1].visible,false);
  assert.equal(g.state.time,300);assert.equal(g.state.kills,0);assert.equal(g.state.health,100);
});
test('shooting resolves a real body hit and consumes one round',()=>{
  const g=harness(),b=addBot(g);g.shoot();
  assert.equal(b.health,71);assert.equal(g.state.ammo,29);assert.equal(g.state.hits,1);
});
test('a real wall intersection prevents damaging the soldier behind it',()=>{
  const g=harness(),b=addBot(g);const wall=new THREE.Mesh(new THREE.BoxGeometry(5,4,1),new THREE.MeshBasicMaterial());
  wall.position.set(0,2,4);g.scene.add(wall);g.solid.push(wall);g.shoot();
  assert.equal(b.health,100);assert.equal(g.state.hits,0);assert.equal(g.state.ammo,29);
});
test('a headshot eliminates a bot and updates score and feed',()=>{
  const g=harness(),b=addBot(g);g.camera.position.set(0,1.72,8);g.camera.lookAt(0,1.72,0);g.camera.updateMatrixWorld(true);g.shoot();
  assert.ok(b.health<=0);assert.equal(g.state.kills,1);assert.equal(g.state.headshots,1);assert.equal(b.root.visible,false);assert.equal(g.state.feed[0].headshot,true);
});
test('switching weapons cancels reload without transferring ammunition',()=>{
  const g=harness();g.ammo[0].ammo=3;g.reload();assert.ok(g.reloadLeft>0);g.switchWeapon(1);
  assert.equal(g.reloadLeft,0);assert.equal(g.ammo[0].ammo,3);assert.equal(g.state.ammo,12);
});
test('AI cannot damage a player behind an obstacle',()=>{
  const g=harness();addBot(g,-9,-18);g.state.x=-9;g.state.z=3;g.camera.position.y=1.68;
  const random=Math.random;Math.random=()=>0;
  try{g.updateBots(.016);assert.equal(g.state.health,100);assert.equal(g.effects.length,0);}finally{Math.random=random;}
});
test('spawn protection prevents AI damage even with unobstructed aim',()=>{
  const g=harness();addBot(g,-19,-10);g.state.x=-19;g.state.z=-18;g.state.protection=2;
  const random=Math.random;Math.random=()=>0;
  try{g.updateBots(.016);assert.equal(g.state.health,100);}finally{Math.random=random;}
});
test('AI can shoot, eliminate, and schedule player respawn',()=>{
  const g=harness();addBot(g,-19,-10);g.state.x=-19;g.state.z=-18;g.state.health=1;g.state.protection=0;
  const random=Math.random;Math.random=()=>0;
  try{g.updateBots(.016);assert.equal(g.state.health,0);assert.equal(g.state.deaths,1);assert.equal(g.state.phase,'respawn');assert.equal(g.state.respawn,3);}finally{Math.random=random;}
});
