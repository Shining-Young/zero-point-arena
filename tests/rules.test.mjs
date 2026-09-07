import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canStand, moveActor, lineClear, findPath, reloadAmmo, matchOutcome } from '../lib/game/rules.ts';

const wall = [{ x: 0, z: 0, w: 3, d: 8, h: 3 }];
test('solid cover blocks movement but allows sliding alongside it', () => {
  assert.equal(canStand(0, 0, wall), false);
  const p = moveActor({ x: -2, z: 0 }, 1, 1, wall);
  assert.ok(p.x < -1.8);
  assert.equal(p.z, 1);
});
test('bullets and vision cannot pass through cover', () => {
  assert.equal(lineClear({x:-4,y:1.6,z:0},{x:4,y:1.6,z:0},wall),false);
  assert.equal(lineClear({x:-4,y:4,z:0},{x:4,y:4,z:0},wall),true);
  assert.equal(lineClear({x:-4,y:1.6,z:6},{x:4,y:1.6,z:6},wall),true);
});
test('AI finds a traversable route around the blocking wall', () => {
  const start={x:-5,z:0}, end={x:5,z:0};
  const path=findPath(start,end,wall);
  assert.ok(path.length>0);
  assert.ok(path.some(p=>Math.abs(p.z)>4));
  let last=start;
  for(const p of path){
    assert.ok(canStand(p.x,p.z,wall));
    assert.ok(lineClear({...last,y:1},{...p,y:1},wall));
    last=p;
  }
  assert.ok(Math.hypot(last.x-end.x,last.z-end.z)<2);
});
test('reload transfers only available rounds and never manufactures ammunition', () => {
  assert.deepEqual(reloadAmmo(24,3,30),{ammo:27,reserve:0});
  assert.deepEqual(reloadAmmo(24,90,30),{ammo:30,reserve:84});
  assert.deepEqual(reloadAmmo(30,90,30),{ammo:30,reserve:90});
});
test('AI escapes a cover edge when the rounded navigation cell is inside a container',()=>{
  const start={x:7,z:5},end={x:0,z:20};
  assert.ok(canStand(start.x,start.z,undefined,.46));
  const path=findPath(start,end);
  assert.ok(path.length>0);
  let last=start;
  for(const p of path){
    assert.ok(lineClear({...last,y:1},{...p,y:1}));
    const steps=Math.ceil(Math.hypot(p.x-last.x,p.z-last.z)/.1);
    for(let i=1;i<=steps;i++)assert.ok(canStand(last.x+(p.x-last.x)*i/steps,last.z+(p.z-last.z)*i/steps,undefined,.46));
    last=p;
  }
  assert.ok(Math.hypot(last.x-end.x,last.z-end.z)<2);
});
test('match ends on target score or time with a distinct draw', () => {
  assert.equal(matchOutcome(14,12,200),null);
  assert.equal(matchOutcome(15,12,200),'win');
  assert.equal(matchOutcome(4,15,200),'loss');
  assert.equal(matchOutcome(4,3,0),'win');
  assert.equal(matchOutcome(4,4,0),'draw');
});
