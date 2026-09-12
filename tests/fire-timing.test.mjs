import test from 'node:test';import assert from 'node:assert/strict';
import * as timing from '../lib/game/fire-timing.ts';
test('850 rpm stays stable at 60 fps without accumulating a burst after idle',()=>{
 assert.equal(typeof timing.nextShotTime,'function');let previous=-Infinity,count=0,interval=60000/850;
 for(let now=0;now<10000;now+=1000/60)if(now-previous>=interval){previous=timing.nextShotTime(previous,now,interval);count++;}
 assert.ok(Math.abs(count-142)<=1,String(count));assert.equal(timing.nextShotTime(previous,20000,interval),20000);
});
