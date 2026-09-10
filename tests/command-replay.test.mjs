import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchSimulation } from '../server/simulation.ts';
import * as motion from '../lib/network/motion.ts';
const input=(sequence,moveZ=1)=>({sequence,moveX:0,moveZ,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,aiming:false,clientTime:0,dt:.01,life:0});
test('acknowledges only simulated input and does not repeat a completed command',()=>{
 const sim=new MatchSimulation([{id:'a',nickname:'A',x:8,z:0}]);
 sim.applyInput('a',input(1));assert.equal(sim.player('a').lastInput,-1);
 sim.tick(.05);assert.equal(sim.player('a').lastInput,1);
 const stopped=sim.player('a').z;sim.tick(.05);assert.equal(sim.player('a').z,stopped);
});
test('replay converges after jitter and stop without extra displacement',()=>{
 assert.equal(typeof motion.CommandPrediction,'function');
 const sim=new MatchSimulation([{id:'a',nickname:'A',x:8,z:0}]);
 const prediction=new motion.CommandPrediction();prediction.reset(sim.player('a'));
 for(let n=1;n<=50;n++)prediction.step(input(n,n<=30?1:0));
 for(let offset=0;offset<50;offset+=5){for(const command of prediction.pending.filter(c=>c.sequence>offset&&c.sequence<=offset+5))sim.applyInput('a',command);sim.tick(.05);prediction.reconcile(sim.player('a'),sim.player('a').lastInput);}
 assert.ok(Math.abs(prediction.position.z-sim.player('a').z)<1e-9);
 const end=prediction.position.z;for(let n=0;n<10;n++){sim.tick(.05);prediction.reconcile(sim.player('a'),sim.player('a').lastInput);}
 assert.equal(prediction.position.z,end);assert.equal(prediction.pending.length,0);
});
test('network shot waits for its preceding movement command',()=>{
 const sim=new MatchSimulation([{id:'a',nickname:'A',x:8,z:0}]);
 sim.applyInput('a',input(1));sim.queueFire('a',{sequence:2,weapon:'rifle',yaw:0,pitch:0,clientTime:0,inputSequence:1,life:0});
 assert.equal(sim.player('a').ammo,30);sim.tick(.05);assert.equal(sim.player('a').ammo,29);
 assert.equal(sim.player('a').lastInput,1);
});
test('queued shot uses its exact command boundary and precedes a subsequent reload',()=>{
 const sim=new MatchSimulation([{id:'a',nickname:'A',x:8,z:0}]);
 for(let n=1;n<=5;n++)sim.applyInput('a',input(n));
 sim.queueFire('a',{sequence:6,weapon:'rifle',yaw:Math.PI/2,pitch:0,clientTime:0,inputSequence:5,life:0});sim.queueReload('a');
 for(let n=7;n<=11;n++)sim.applyInput('a',input(n));
 sim.tick(.1);
 const shot=sim.events.find(e=>e.type==='shot');assert.ok(shot);assert.ok(Math.abs(shot.end.z+.23)<1e-8);
 assert.equal(sim.player('a').ammo,29);assert.ok(sim.player('a').reloadLeft>0);
 assert.ok(sim.player('a').z<shot.end.z);
});

test('prediction converges at 80, 200 and 400 ms round trip after releasing movement',()=>{
 for(const rtt of [80,200,400]){
  const sim=new MatchSimulation([{id:'a',nickname:'A',x:8,z:0}]),prediction=new motion.CommandPrediction();prediction.reset(sim.player('a'));
  const packets=[],snapshots=[];let outgoing=[];
  for(let t=10;t<=4000;t+=10){
   if(t<=2500){const command=input(t/10,t<=1500?1:0);prediction.step(command);outgoing.push(command);}
   if(t%50===0&&outgoing.length){packets.push({at:t+rtt/2,commands:outgoing});outgoing=[];}
   while(packets[0]?.at<=t){for(const c of packets.shift().commands)sim.applyInput('a',c);}
   if(t%50===0)sim.tick(.05);
   if(t%100===0)snapshots.push({at:t+rtt/2,state:{...sim.player('a')},ack:sim.player('a').lastInput});
   while(snapshots[0]?.at<=t){const snap=snapshots.shift();prediction.reconcile(snap.state,snap.ack);}
   assert.ok(prediction.pending.length<90,`${rtt} ms must remain below recovery limit`);
  }
  assert.equal(prediction.pending.length,0);assert.ok(Math.abs(prediction.position.z-sim.player('a').z)<1e-8);
 }
});
