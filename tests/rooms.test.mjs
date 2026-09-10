import assert from 'node:assert/strict';
import test from 'node:test';

import { RoomError, RoomManager } from '../server/room-manager.ts';
import { makeRoomCode } from '../server/room-code.ts';

test('generates unambiguous six-character room codes', () => {
  assert.equal(makeRoomCode(Uint8Array.from([0, 1, 2, 23, 24, 31])), 'ABCZ29');
  assert.match(makeRoomCode(), /^[A-HJ-NP-Z2-9]{6}$/);
});

test('retries room-code collisions', () => {
  const values = ['ABC234', 'ABC234', 'XYZ789'];
  const manager = new RoomManager({ codeSource: () => values.shift() });
  assert.equal(manager.createRoom({ nickname: 'A', humanLimit: 2, botCount: 0, difficulty: 'easy' }).room.code, 'ABC234');
  assert.equal(manager.createRoom({ nickname: 'B', humanLimit: 2, botCount: 0, difficulty: 'easy' }).room.code, 'XYZ789');
});

test('enforces capacity and assigns unique display nicknames', () => {
  const manager = new RoomManager({ codeSource: () => 'ABC234' });
  const { room } = manager.createRoom({ nickname: 'Ace', humanLimit: 2, botCount: 0, difficulty: 'normal' });
  assert.equal(manager.joinRoom(room.code, { nickname: 'Ace' }).player.nickname, 'Ace (2)');
  assert.throws(() => manager.joinRoom(room.code, { nickname: 'Third' }), error => error instanceof RoomError && error.code === 'ROOM_FULL');
});

test('allows only the host to configure and requires all humans ready', () => {
  const manager = new RoomManager({ codeSource: () => 'ABC234' });
  const { room, player: host } = manager.createRoom({ nickname: 'A', humanLimit: 3, botCount: 1, difficulty: 'normal' });
  const { player: second } = manager.joinRoom(room.code, { nickname: 'B' });
  assert.throws(() => manager.configureRoom(room.code, second.id, { botCount: 0, difficulty: 'hard' }), /NOT_HOST/);
  manager.configureRoom(room.code, host.id, { botCount: 2, difficulty: 'hard' });
  assert.equal(room.difficulty, 'hard');
  assert.throws(() => manager.startMatch(room.code, host.id), /NOT_READY/);
  manager.setReady(room.code, host.id, true);
  manager.setReady(room.code, second.id, true);
  manager.startMatch(room.code, host.id);
  assert.equal(room.phase, 'playing');
});

test('transfers host to the earliest remaining connected player', () => {
  const manager = new RoomManager({ codeSource: () => 'ABC234' });
  const { room, player: host } = manager.createRoom({ nickname: 'A', humanLimit: 4, botCount: 0, difficulty: 'normal' });
  const second = manager.joinRoom(room.code, { nickname: 'B' }).player;
  manager.joinRoom(room.code, { nickname: 'C' });
  manager.disconnect(host.id, 1000);
  assert.equal(room.hostPlayerId, second.id);
});

test('retains seats for 30 seconds and reconnects the same identity', () => {
  const manager = new RoomManager({ codeSource: () => 'ABC234' });
  const { room, player } = manager.createRoom({ nickname: 'A', humanLimit: 2, botCount: 0, difficulty: 'easy' });
  manager.disconnect(player.id, 1_000);
  const restored = manager.reconnect(player.reconnectToken, 30_999);
  assert.equal(restored.player.id, player.id);
  manager.disconnect(player.id, 31_000);
  manager.sweep(61_001);
  assert.equal(room.players.has(player.id), false);
});

test('marks a previous connection for eviction when a token reconnects', () => {
  const manager = new RoomManager({ codeSource: () => 'ABC234' });
  const { player } = manager.createRoom({ nickname: 'A', humanLimit: 2, botCount: 0, difficulty: 'easy' });
  player.connectionId = 'old';
  const restored = manager.reconnect(player.reconnectToken, 2_000, 'new');
  assert.equal(restored.evictedConnectionId, 'old');
  assert.equal(player.connectionId, 'new');
});

test('removes empty playing rooms after 60 seconds', () => {
  const manager = new RoomManager({ codeSource: () => 'ABC234' });
  const { room, player } = manager.createRoom({ nickname: 'A', humanLimit: 2, botCount: 0, difficulty: 'easy' });
  room.phase = 'playing';
  manager.disconnect(player.id, 1000);
  manager.sweep(60_999);
  assert.ok(manager.getRoom(room.code));
  manager.sweep(61_001);
  assert.equal(manager.getRoom(room.code), undefined);
});

test('three rounds keep room identity, roster and configuration but require fresh readiness',()=>{
 const manager=new RoomManager(),{room,player:host}=manager.createRoom({nickname:'A',humanLimit:3,botCount:1,difficulty:'hard'}),{player:guest}=manager.joinRoom(room.code,{nickname:'B'});
 for(let round=0;round<3;round++){
  manager.setReady(room.code,host.id,true);manager.setReady(room.code,guest.id,true);manager.startMatch(room.code,host.id);room.phase='finished';
  assert.throws(()=>manager.playAgain(room.code,guest.id),/NOT_HOST/);manager.playAgain(room.code,host.id);
  const state=manager.roomState(room);assert.equal(state.phase,'lobby');assert.equal(state.roomCode,room.code);assert.deepEqual(state.players.map(p=>p.nickname),['A','B']);assert.equal(state.botCount,1);assert.equal(state.difficulty,'hard');assert.ok(state.players.every(p=>!p.ready));
  assert.throws(()=>manager.startMatch(room.code,host.id),/NOT_READY/);
 }
});
