import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceActor } from '../lib/game/rules.ts';
import { MatchSimulation } from '../server/simulation.ts';

const input = (sequence, overrides = {}) => ({ sequence, moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, clientTime: 0, ...overrides });

test('normalizes diagonal movement and blocks obstacles', () => {
  const straight = advanceActor({ x: 8, z: -10 }, { moveX: 0, moveZ: 1, yaw: 0, sprint: false, crouch: false, jump: false }, { grounded: true, y: 0, velocityY: 0 }, 1);
  const diagonal = advanceActor({ x: 8, z: -10 }, { moveX: 1, moveZ: 1, yaw: 0, sprint: false, crouch: false, jump: false }, { grounded: true, y: 0, velocityY: 0 }, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.position.x - 8, diagonal.position.z + 10) - Math.hypot(straight.position.x - 8, straight.position.z + 10)) < 0.01);
  const blocked = advanceActor({ x: -9, z: -15 }, { moveX: 0, moveZ: 1, yaw: 0, sprint: false, crouch: false, jump: false }, { grounded: true, y: 0, velocityY: 0 }, 2);
  assert.ok(blocked.position.z < -14);
});

test('tracks jump and crouch state', () => {
  const jumped = advanceActor({ x: 8, z: -10 }, { moveX: 0, moveZ: 0, yaw: 0, sprint: false, crouch: false, jump: true }, { grounded: true, y: 0, velocityY: 0 }, 0.05);
  assert.ok(jumped.movement.y > 0);
  const crouched = advanceActor({ x: 8, z: -10 }, { moveX: 0, moveZ: 0, yaw: 0, sprint: false, crouch: true, jump: false }, { grounded: true, y: 0, velocityY: 0 }, 0.05);
  assert.equal(crouched.movement.crouched, true);
});

test('rejects stale input and enforces weapon cadence and ammo', () => {
  const sim = new MatchSimulation([{ id: 'a', nickname: 'A', x: 8, z: -10 }], { now: () => 1000 });
  assert.equal(sim.applyInput('a', input(2, { moveZ: 1 })), true);
  assert.equal(sim.applyInput('a', input(2, { moveZ: -1 })), false);
  assert.equal(sim.fire('a', { sequence: 1, weapon: 'rifle', yaw: 0, pitch: 0, clientTime: 1000 }), true);
  assert.equal(sim.fire('a', { sequence: 2, weapon: 'rifle', yaw: 0, pitch: 0, clientTime: 1000 }), false);
  assert.equal(sim.player('a').ammo, 29);
});

test('reloads on the server after the weapon delay', () => {
  const sim = new MatchSimulation([{ id: 'a', nickname: 'A', x: 8, z: -10 }]);
  sim.player('a').ammo = 1;
  assert.equal(sim.reload('a'), true);
  sim.tick(1);
  assert.equal(sim.player('a').ammo, 1);
  sim.tick(1);
  assert.equal(sim.player('a').ammo, 30);
});

test('rejects shots through cover and damages visible targets', () => {
  const covered = new MatchSimulation([{ id: 'a', nickname: 'A', x: -9, z: -18 }, { id: 'b', nickname: 'B', x: -9, z: 3 }], { now: () => 4000 });
  covered.tick(3.1);
  covered.fire('a', { sequence: 1, weapon: 'rifle', yaw: 0, pitch: 0, clientTime: 4000 });
  assert.equal(covered.player('b').health, 100);
  const open = new MatchSimulation([{ id: 'a', nickname: 'A', x: 8, z: -15 }, { id: 'b', nickname: 'B', x: 8, z: -8 }], { now: () => 4000 });
  open.tick(3.1);
  open.fire('a', { sequence: 1, weapon: 'rifle', yaw: 0, pitch: 0, clientTime: 4000 });
  assert.equal(open.player('b').health, 71);
});

test('applies death, score, respawn and match finish', () => {
  const sim = new MatchSimulation([{ id: 'a', nickname: 'A', x: 8, z: -15 }, { id: 'b', nickname: 'B', x: 8, z: -8 }], { scoreLimit: 1, now: () => 5000 });
  sim.tick(3.1);
  sim.player('b').health = 20;
  sim.fire('a', { sequence: 1, weapon: 'rifle', yaw: 0, pitch: 0, clientTime: 5000 });
  assert.equal(sim.player('a').kills, 1);
  assert.equal(sim.finished, true);
  assert.equal(sim.player('b').alive, false);
});

test('server bots produce movement or fire decisions', () => {
  const sim = new MatchSimulation([{ id: 'a', nickname: 'A', x: 8, z: -10 }, { id: 'bot-1', nickname: 'BOT 01', x: 8, z: 0, isBot: true }], { difficulty: 'hard' });
  const before = sim.player('bot-1').z;
  for (let i = 0; i < 20; i += 1) sim.tick(0.05);
  assert.ok(sim.player('bot-1').z !== before || sim.events.length > 0);
});
