import test from 'node:test';import assert from 'node:assert/strict';
import {LocalGameConnection} from '../lib/network/local.ts';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('offline transport starts everyone with pistol and pauses simulation in settings',async t=>{
 const c=new LocalGameConnection('easy'),messages=[];c.subscribe(m=>messages.push(m));c.connect();t.after(()=>c.close());
 const initial=messages.find(m=>m.type==='snapshot');assert.equal(initial.entities.length,5);assert.ok(initial.entities.every(p=>p.weapon==='pistol'&&p.coins===0&&p.ammo===12));await wait(80);assert.equal(messages.filter(m=>m.type==='snapshot').at(-1).remainingSeconds,initial.remainingSeconds);
 c.setPaused(false);await wait(80);assert.ok(messages.filter(m=>m.type==='snapshot').at(-1).remainingSeconds<initial.remainingSeconds);
});
test('offline shop uses authoritative purchase and does not refill ammo on equip',async t=>{
 const c=new LocalGameConnection(),messages=[];c.subscribe(m=>messages.push(m));c.connect();t.after(()=>c.close());const player=c.simulation.player(c.playerId);player.coins=600;c.setPaused(false);
 c.send({type:'shop',requestId:'buy',action:'buy_weapon',weapon:'smg'});await wait(80);assert.ok(messages.find(m=>m.type==='shop_result'&&m.ok));assert.equal(player.coins,150);assert.equal(player.ammo,30);assert.equal(player.reserve,0);
 c.send({type:'shop',requestId:'ammo',action:'buy_ammo',weapon:'smg'});await wait(80);assert.equal(player.reserve,30);assert.equal(player.coins,105);
 c.send({type:'shop',requestId:'ammo',action:'buy_ammo',weapon:'smg'});await wait(80);assert.equal(player.reserve,30);assert.equal(player.coins,105);
 c.close();const next=new LocalGameConnection();t.after(()=>next.close());assert.equal(next.simulation.player(next.playerId).coins,0);assert.deepEqual(Object.keys(next.simulation.player(next.playerId).inventory),['pistol']);
});
