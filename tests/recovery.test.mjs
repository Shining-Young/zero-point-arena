import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { GameConnection } from '../lib/network/client.ts';
import { MatchSimulation } from '../server/simulation.ts';
import * as controls from '../lib/game/controls.ts';
class Socket extends EventEmitter {readyState=0;sent=[];addEventListener(t,f){this.on(t,f)}send(s){this.sent.push(JSON.parse(s))}open(){this.readyState=1;this.emit('open')}message(m){this.emit('message',{data:JSON.stringify(m)})}close(){this.readyState=3;this.emit('close')}}
test('heartbeat measures real round trip and reconnects silent open sockets',()=>{
 let now=0;const jobs=[],sockets=[];const c=new GameConnection({url:'test',now:()=>now,socketFactory:()=>{const s=new Socket();sockets.push(s);return s},setTimeout:(fn,ms)=>{jobs.push({fn,ms});return fn},clearTimeout:()=>{}});
 c.connect();sockets[0].open();assert.equal(c.latency,-1);now=1000;jobs.shift().fn();const ping=sockets[0].sent.find(m=>m.type==='ping');assert.ok(ping);now=1120;sockets[0].message({type:'pong',clientTime:ping.clientTime});assert.equal(c.latency,120);now=4000;jobs.shift().fn();assert.equal(c.phase,'reconnecting');c.close();
});
test('input recovery discards queued moves and actions and invalidates in-flight old-life commands',()=>{
 const sim=new MatchSimulation([{id:'a',nickname:'A',x:8,z:0}]);const p=sim.player('a');const input={sequence:1,moveX:0,moveZ:1,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,dt:.01,life:p.life,clientTime:0};
 sim.applyInput('a',input);sim.queueFire('a',{sequence:2,weapon:'pistol',yaw:0,pitch:0,clientTime:0,inputSequence:1,life:p.life});
 assert.equal(typeof sim.resetInputs,'function');sim.resetInputs('a');assert.equal(sim.applyInput('a',{...input,sequence:3}),false);sim.tick(.05);assert.equal(p.z,0);assert.equal(p.ammo,12);assert.equal(p.life,1);
});
test('both sprint keys override toggle aim only while moving and upright',()=>{
 assert.equal(typeof controls.readMovementControls,'function');
 for(const shift of ['ShiftLeft','ShiftRight']){const m=controls.readMovementControls(new Set(['KeyW',shift]),true);assert.equal(m.sprint,true);assert.equal(m.aiming,false)}
 assert.equal(controls.readMovementControls(new Set(['ShiftLeft']),true).sprint,false);
 assert.equal(controls.readMovementControls(new Set(['KeyW','ShiftRight','KeyC']),true).sprint,false);
});

test('recovers cleanly after 1–3 second delivery stalls without replaying stale actions',()=>{
 for(const delay of [1000,2000,3000]){
  const sim=new MatchSimulation([{id:'a',nickname:'A',x:8,z:0}]);const p=sim.player('a');
  for(let i=0;i<delay/50;i++)sim.tick(.05);
  const oldLife=p.life;for(let i=1;i<=80;i++)sim.applyInput('a',{sequence:i,moveX:0,moveZ:1,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,dt:.01,life:oldLife,clientTime:0});
  sim.resetInputs('a');sim.tick(.05);assert.equal(p.z,0);
  sim.applyInput('a',{sequence:81,moveX:0,moveZ:1,yaw:0,pitch:0,jump:false,crouch:false,sprint:true,dt:.01,life:p.life,clientTime:delay});sim.tick(.05);assert.ok(Math.abs(p.z+.072)<1e-8);
  const stopped=p.z;for(let i=0;i<20;i++)sim.tick(.05);assert.equal(p.z,stopped);
 }
});

test('input reset removes discarded sequence barriers so a fresh client can resume',()=>{
 const sim=new MatchSimulation([{id:'a',nickname:'A',x:8,z:0}]);const p=sim.player('a'),input={sequence:6000,moveX:0,moveZ:1,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,dt:.01,life:0,clientTime:0};
 sim.applyInput('a',input);sim.tick(.05);sim.applyInput('a',{...input,sequence:6100});sim.resetInputs('a');
 assert.equal(sim.applyInput('a',{...input,sequence:p.lastInput+1,life:p.life}),true);
});

test('silent sockets reconnect without waiting for the close handshake',()=>{
 let now=0;const jobs=[];const socket=new Socket();socket.close=()=>{socket.readyState=2};const c=new GameConnection({url:'test',now:()=>now,socketFactory:()=>socket,setTimeout:(fn,ms)=>{jobs.push({fn,ms});return fn},clearTimeout:()=>{}});
 c.connect();socket.open();now=3000;jobs.shift().fn();assert.equal(c.phase,'reconnecting');assert.ok(jobs.some(job=>job.ms===1000));c.close();
});
