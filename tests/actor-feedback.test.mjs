import test from 'node:test';import assert from 'node:assert/strict';
import {MatchSimulation} from '../server/simulation.ts';
import * as feedback from '../lib/game/actor-feedback.ts';
test('protected impacts emit shield feedback without damage or hit confirmation',()=>{
 const sim=new MatchSimulation([{id:'a',nickname:'A',x:8,z:0},{id:'b',nickname:'B',x:8,z:-4}]);
 sim.fire('a',{sequence:1,weapon:'rifle',yaw:0,pitch:0,clientTime:0});
 assert.equal(sim.player('b').health,100);assert.ok(sim.events.some(e=>e.type==='shield'&&e.targetId==='b'));assert.equal(sim.events.some(e=>e.type==='hit'||e.type==='headshot'),false);
});
test('name labels hide distant, dead and occluded characters',()=>{
 assert.equal(typeof feedback.canShowActorLabel,'function');
 const eye={x:8,y:1.68,z:0};assert.equal(feedback.canShowActorLabel(eye,{x:8,y:0,z:-4},true,[]),true);
 assert.equal(feedback.canShowActorLabel(eye,{x:8,y:0,z:-40},true,[]),false);
 assert.equal(feedback.canShowActorLabel(eye,{x:8,y:0,z:-4},false,[]),false);
 assert.equal(feedback.canShowActorLabel(eye,{x:8,y:0,z:-4},true,[{x:8,z:-2,w:3,d:1,h:3}]),false);
});
