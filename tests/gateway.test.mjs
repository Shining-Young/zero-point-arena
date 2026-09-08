import assert from 'node:assert/strict';
import test from 'node:test';
import WebSocket from 'ws';

import { createGameServer } from '../server/gateway.ts';

function client(url) {
  const ws = new WebSocket(url);
  const messages = [];
  ws.on('message', data => messages.push(JSON.parse(data.toString())));
  return { ws, messages, send: value => ws.send(JSON.stringify(value)), waitFor: type => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${type}`)), 1500);
    const scan = () => { const found = messages.find(message => message.type === type); if (found) { clearTimeout(timer); resolve(found); } else setTimeout(scan, 10); }; scan();
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
  assert.deepEqual(await response.json(), { ok: true, protocolVersion: 1 });
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
  a.send({ type: 'hello', protocolVersion: 1, releaseVersion: '0.2.0' });
  a.send({ type: 'create_room', nickname: 'A', humanLimit: 2, botCount: 0, difficulty: 'easy' });
  const room = await a.waitFor('room_state');
  b.send({ type: 'hello', protocolVersion: 1, releaseVersion: '0.2.0' });
  b.send({ type: 'join_room', nickname: 'B', roomCode: room.roomCode });
  await b.waitFor('welcome');
  const joined = await b.waitFor('room_state');
  assert.equal(joined.players.length, 2);
});

test('starts a match and publishes authoritative snapshots', async t => {
  const server = await createGameServer({ port: 0 }); t.after(server.close);
  const a = await opened(`${server.wsBase}/game`), b = await opened(`${server.wsBase}/game`);
  t.after(() => { a.ws.close(); b.ws.close(); });
  for (const c of [a,b]) c.send({ type:'hello', protocolVersion:1, releaseVersion:'0.2.0' });
  a.send({ type:'create_room', nickname:'A', humanLimit:2, botCount:0, difficulty:'normal' });
  const room = await a.waitFor('room_state');
  b.send({ type:'join_room', nickname:'B', roomCode:room.roomCode }); await b.waitFor('room_state');
  a.send({ type:'set_ready', ready:true }); b.send({ type:'set_ready', ready:true });
  await new Promise(resolve=>setTimeout(resolve,30)); a.send({ type:'start_match' });
  const snapshot = await a.waitFor('snapshot');
  assert.equal(snapshot.entities.length, 2);
  a.send({ type:'fire', weapon:'rifle', sequence:1, yaw:0, pitch:0, clientTime:Date.now() });
  const combat = await b.waitFor('combat_event');
  assert.equal(combat.event, 'shot');
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
