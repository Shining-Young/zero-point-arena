import test from 'node:test';
import assert from 'node:assert/strict';
import * as combat from '../shared/combat.ts';
test('shot endpoint stops at cover before a target',()=>{
 const hit=combat.traceShot({x:-9,y:1.68,z:3},0,0,70,[{id:'b',x:-9,y:0,z:-18,alive:true}]);
 assert.equal(hit.targetId,undefined);assert.ok(Math.abs(hit.end.z+2)<1e-8);
});
test('shared ray reports body hit and floor endpoint',()=>{
 const hit=combat.traceShot({x:8,y:1.68,z:-8},0,0,70,[{id:'b',x:8,y:0,z:-15,alive:true}]);
 assert.equal(hit.targetId,'b');assert.equal(hit.headshot,false);
 const floor=combat.traceShot({x:8,y:1,z:-8},0,-Math.PI/2,70,[]);assert.ok(Math.abs(floor.end.y)<1e-8);
});
test('shared weapon muzzle cannot shoot through low cover beneath a clear eye ray',()=>{
 const eye={x:0,y:1.68,z:2.05},targets=[{id:'b',x:0,y:0,z:-3,alive:true}];
 assert.equal(combat.traceShot(eye,0,0,70,targets).targetId,'b');
 const hit=combat.traceWeaponShot(eye,0,0,'rifle',false,targets);
 assert.equal(hit.targetId,undefined);assert.ok(hit.end.z>-1.5);
});
