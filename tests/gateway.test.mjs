import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';

import { createGameServer } from '../server/gateway.ts';

function client(url) {
  const ws = new WebSocket(url);
  const messages = [];
  ws.on('message', data => messages.push(JSON.parse(data.toString())));
  return { ws, messages, send: value => ws.send(JSON.stringify(value)), waitFor: type => new Promise((resolve, reject) => {
    let done=false;const timer = setTimeout(() => {done=true;reject(new Error(`timeout ${type}`));}, 1500);
    const scan = () => { if(done)return;const found = messages.find(message => message.type === type); if (found) { clearTimeout(timer); resolve(found); } else setTimeout(scan, 10); }; scan();
  }) };
}

async function opened(url) {
  const c = client(url);
  await new Promise((resolve, reject) => { c.ws.once('open', resolve); c.ws.once('error', reject); });
  return c;
}

test('reports application readiness and rejects other websocket paths', async t => {
  const server = await createGameServer({ port: 0 }); t.after(server.close);
  const response = await fetch(`${server.httpUrl}/health`);
  assert.deepEqual(await response.json(), { ok: true, protocolVersion:4, releaseVersion: '0.2.5' });
  const bad = new WebSocket(`${server.wsBase}/wrong`);
  const status = await new Promise(resolve => bad.on('unexpected-response', (_req, res) => resolve(res.statusCode)));
  assert.equal(status, 404);
});

test('requires hello then creates, joins and broadcasts a room', async t => {
  const server = await createGameServer({ port: 0 }); t.after(server.close);
  const a = await opened(`${server.wsBase}/game`), b = await opened(`${server.wsBase}/game`);
  t.after(() => { a.ws.close(); b.ws.close(); });
  a.send({ type: 'create_room', nickname: 'A', humanLimit: 2, botCount: 0, difficulty: 'easy' });
  assert.equal((await a.waitFor('error')).code, 'HELLO_REQUIRED');
  a.send({ type: 'hello', protocolVersion:4, releaseVersion: '0.2.5' });
  a.send({ type: 'create_room', nickname: 'A', humanLimit: 2, botCount: 0, difficulty: 'easy' });
  const room = await a.waitFor('room_state');
  b.send({ type: 'hello', protocolVersion:4, releaseVersion: '0.2.5' });
  b.send({ type: 'join_room', nickname: 'B', roomCode: room.roomCode });
  await b.waitFor('welcome');
  const joined = await b.waitFor('room_state');
  assert.equal(joined.players.length, 2);
});

test('starts a match and publishes authoritative snapshots', async t => {
  const server = await createGameServer({ port: 0 }); t.after(server.close);
  const a = await opened(`${server.wsBase}/game`), b = await opened(`${server.wsBase}/game`);
  t.after(() => { a.ws.close(); b.ws.close(); });
  for (const c of [a,b]) c.send({ type:'hello', protocolVersion:4, releaseVersion:'0.2.5' });
  a.send({ type:'create_room', nickname:'A', humanLimit:2, botCount:0, difficulty:'normal' });
  const room = await a.waitFor('room_state');
  b.send({ type:'join_room', nickname:'B', roomCode:room.roomCode }); await b.waitFor('room_state');
  a.send({ type:'set_ready', ready:true }); b.send({ type:'set_ready', ready:true });
  await new Promise(resolve=>setTimeout(resolve,30)); a.send({ type:'start_match' });
  const snapshot = await a.waitFor('snapshot');
  assert.equal(snapshot.entities.length, 2);
  a.send({ type:'fire', weapon:'rifle', sequence:1, yaw:.75, pitch:-.2, clientTime:Date.now() });
  const combat = await b.waitFor('combat_event');
  assert.equal(combat.event, 'shot');
  assert.equal(combat.yaw, .75);
  assert.equal(combat.pitch, -.2);
});

test('returns application errors for malformed JSON and closes oversized messages', async t => {
  const server = await createGameServer({ port: 0 }); t.after(server.close);
  const malformed = await opened(`${server.wsBase}/game`); malformed.ws.send('{');
  assert.equal((await malformed.waitFor('error')).code, 'BAD_MESSAGE');
  const huge = await opened(`${server.wsBase}/game`);
  const closed = new Promise(resolve => huge.ws.once('close', code => resolve(code)));
  huge.ws.send('x'.repeat(9000));
  assert.equal(await closed, 1009);
  malformed.ws.close();
});

test('network batches preserve shot pose, action order and final stopped position',async t=>{
 const server=await createGameServer({port:0});t.after(server.close);
 const a=await opened(server.wsBase+'/game'),b=await opened(server.wsBase+'/game');t.after(()=>{a.ws.close();b.ws.close();});
 for(const c of[a,b])c.send({type:'hello',protocolVersion:4,releaseVersion:'0.2.5'});
 a.send({type:'create_room',nickname:'A',humanLimit:2,botCount:0,difficulty:'normal'});
 const room=await a.waitFor('room_state');b.send({type:'join_room',nickname:'B',roomCode:room.roomCode});await b.waitFor('welcome');
 a.send({type:'set_ready',ready:true});b.send({type:'set_ready',ready:true});await new Promise(r=>setTimeout(r,30));a.send({type:'start_match'});
 const initial=await a.waitFor('snapshot'),me=initial.entities.find(e=>e.nickname==='A');
 const command=(sequence,moveZ)=>({type:'input',sequence,moveX:0,moveZ,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,dt:.01,life:me.life,clientTime:Date.now()});
 a.send({type:'input_batch',commands:[1,2,3,4,5].map(n=>command(n,1))});
 a.send({type:'fire',sequence:6,weapon:'rifle',yaw:Math.PI/2,pitch:0,inputSequence:5,life:me.life,clientTime:Date.now()});
 a.send({type:'input_batch',commands:[7,8,9,10,11].map(n=>command(n,0))});a.send({type:'reload'});
 await new Promise(r=>setTimeout(r,350));
 const events=a.messages.filter(m=>m.type==='combat_event'&&m.actorId===me.id);
 assert.deepEqual(events.map(e=>e.event),['shot','reload']);assert.ok(Math.abs(events[0].end.z-(me.z-.23))<1e-7);
 const snapshot=a.messages.filter(m=>m.type==='snapshot').at(-1),local=snapshot.entities.find(e=>e.id===me.id);
 assert.equal(snapshot.lastProcessedInput,11);assert.equal(local.ammo,29);assert.ok(local.reloadLeft>0);assert.ok(Math.abs(local.z-(me.z-.23))<1e-8);
 await new Promise(r=>setTimeout(r,150));const stopped=a.messages.filter(m=>m.type==='snapshot').at(-1).entities.find(e=>e.id===me.id);assert.equal(stopped.z,local.z);
});

test('responds to heartbeat without a room and explicitly reports input throttling',async t=>{
 const server=await createGameServer({port:0});t.after(server.close);const a=await opened(server.wsBase+'/game');t.after(()=>a.ws.close());
 a.send({type:'hello',protocolVersion:4,releaseVersion:'0.2.5'});a.send({type:'ping',clientTime:123});assert.equal((await a.waitFor('pong')).clientTime,123);
 a.send({type:'create_room',nickname:'A',humanLimit:2,botCount:0,difficulty:'normal'});await a.waitFor('room_state');a.send({type:'set_ready',ready:true});a.send({type:'start_match'});const first=await a.waitFor('snapshot');
 for(let n=0;n<35;n++)a.send({type:'input_batch',commands:[{type:'input',sequence:n,moveX:0,moveZ:1,yaw:0,pitch:0,jump:false,crouch:false,sprint:false,dt:.01,life:0,clientTime:Date.now()}]});
 assert.equal((await a.waitFor('error')).code,'INPUT_RATE_LIMIT');a.send({type:'resync_input'});const reset=await a.waitFor('input_resynced');assert.equal(reset.entity.life,first.entities[0].life+1);
});

test('replacement socket stays connected when the evicted socket closes later',async t=>{
 const server=await createGameServer({port:0});t.after(server.close);const old=await opened(server.wsBase+'/game');t.after(()=>old.ws.close());
 old.send({type:'hello',protocolVersion:4,releaseVersion:'0.2.5'});old.send({type:'create_room',nickname:'A',humanLimit:2,botCount:0,difficulty:'normal'});const identity=await old.waitFor('welcome'),room=await old.waitFor('room_state');
 const replacement=await opened(server.wsBase+'/game');t.after(()=>replacement.ws.close());replacement.send({type:'hello',protocolVersion:4,releaseVersion:'0.2.5',reconnectToken:identity.reconnectToken});await replacement.waitFor('welcome');await new Promise(r=>setTimeout(r,60));
 assert.equal(server.rooms.getRoom(room.roomCode).players.get(identity.playerId).connected,true);
});
