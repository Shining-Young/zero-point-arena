import assert from 'node:assert/strict';
import test from 'node:test';

const motion = await import('../lib/network/motion.ts').catch(() => ({}));

test('advances local prediction on every render frame', () => {
  assert.equal(typeof motion.advanceLocalPrediction, 'function');
  let state = {
    position: { x: 8, z: 0 },
    visualPosition: { x: 8, z: 0 },
    movement: { y: 0, velocityY: 0, grounded: true, crouched: false },
  };
  const positions = [];
  for (let frame = 0; frame < 60; frame += 1) {
    state = motion.advanceLocalPrediction(state, {
      moveX: 0, moveZ: 1, yaw: 0, jump: false, crouch: false, sprint: false,
    }, 1 / 60);
    positions.push(state.visualPosition.z);
  }
  assert.equal(new Set(positions).size, 60);
  assert.ok(Math.abs(state.position.z + 4.6) < 0.01);
  assert.deepEqual(state.position, state.visualPosition);
});

test('reconciles an acknowledged prediction without dragging the rendered player backward', () => {
  assert.equal(typeof motion.reconcilePrediction, 'function');
  const result = motion.reconcilePrediction(
    { x: 0, z: -0.84 },
    { x: 0, z: -0.84 },
    [
      { sequence: 1, position: { x: 0, z: -0.21 } },
      { sequence: 2, position: { x: 0, z: -0.42 } },
      { sequence: 3, position: { x: 0, z: -0.63 } },
    ],
    { x: 0, z: -0.40 },
    2,
    3,
    [],
  );
  assert.ok(Math.abs(result.position.z + 0.82) < 0.001);
  assert.equal(result.visualPosition.z, -0.84);
  assert.deepEqual(result.pending.map(item => item.sequence), [3]);
  assert.equal(result.snapped, false);
});

test('does not apply the same prediction correction again on the next acknowledgement', () => {
  const first = motion.reconcilePrediction(
    { x: 0, z: -0.84 },
    { x: 0, z: -0.84 },
    [
      { sequence: 1, position: { x: 0, z: -0.21 } },
      { sequence: 2, position: { x: 0, z: -0.42 } },
      { sequence: 3, position: { x: 0, z: -0.63 } },
    ],
    { x: 0, z: -0.21 },
    2,
    3,
    [],
  );
  assert.ok(Math.abs(first.position.z + 0.63) < 0.001);
  assert.ok(Math.abs(first.pending[0].position.z + 0.42) < 0.001);

  const second = motion.reconcilePrediction(
    { x: 0, z: -0.84 },
    first.visualPosition,
    [...first.pending, { sequence: 4, position: { x: 0, z: -0.84 } }],
    { x: 0, z: -0.42 },
    3,
    3,
    [],
  );
  assert.ok(Math.abs(second.position.z + 0.84) < 0.001);
});

test('replays pending movement with collision instead of correcting into cover', () => {
  const wall = [{ x: 0, z: 0, w: 1, d: 4, h: 3 }];
  const result = motion.reconcilePrediction(
    { x: -1, z: 0 },
    { x: -1, z: 0 },
    [{ sequence: 1, position: { x: -2, z: 0 } }],
    { x: -1.2, z: 0 },
    1,
    3,
    wall,
  );
  assert.ok(result.position.x < -0.9);
});

test('snaps the visual correction when a wall blocks its smoothing path', () => {
  assert.equal(typeof motion.smoothVisualPosition, 'function');
  const wall = [{ x: 0, z: 0, w: 1, d: 4, h: 3 }];
  const result = motion.smoothVisualPosition(
    { x: -1, z: 0 },
    { x: 1, z: 0 },
    0.5,
    wall,
  );
  assert.deepEqual(result, { x: 1, z: 0 });
});

test('snaps both positions when the server respawns the player far away', () => {
  const result = motion.reconcilePrediction(
    { x: -18, z: 18 },
    { x: -18.2, z: 18.1 },
    [{ sequence: 4, position: { x: -18.4, z: 18.3 } }],
    { x: 19, z: -19 },
    4,
  );
  assert.equal(result.snapped, true);
  assert.deepEqual(result.position, { x: 19, z: -19 });
  assert.deepEqual(result.visualPosition, { x: 19, z: -19 });
});

test('accepts a far authoritative respawn when no prediction is pending after reconnect', () => {
  const result = motion.reconcilePrediction(
    { x: -19, z: 19 },
    { x: -19, z: 19 },
    [],
    { x: 19, z: -19 },
    undefined,
  );
  assert.equal(result.snapped, true);
  assert.deepEqual(result.position, { x: 19, z: -19 });
  assert.deepEqual(result.visualPosition, { x: 19, z: -19 });
});

test('interpolates remote poses smoothly across wrapped angles', () => {
  assert.equal(typeof motion.interpolatePose, 'function');
  const pose = motion.interpolatePose(
    { x: 0, y: 0, z: 0, yaw: 3.1 },
    { x: 2, y: 2, z: -2, yaw: -3.1 },
    0.5,
  );
  assert.deepEqual({ x: pose.x, y: pose.y, z: pose.z }, { x: 1, y: 1, z: -1 });
  assert.ok(Math.abs(Math.abs(pose.yaw) - Math.PI) < 0.01);
});

test('snaps a remote respawn instead of sliding the actor across the arena', () => {
  const pose = motion.interpolatePose(
    { x: -19, y: 0, z: 19, yaw: 0 },
    { x: 19, y: 0, z: -19, yaw: 1 },
    0.5,
    true,
  );
  assert.deepEqual(pose, { x: 19, y: 0, z: -19, yaw: 1 });
});

test('resets stale jump motion when an authoritative respawn arrives', () => {
  assert.equal(typeof motion.applyVerticalAuthority, 'function');
  const movement = { y: 1.4, velocityY: 3, grounded: false, crouched: true };
  assert.deepEqual(motion.applyVerticalAuthority(movement, 0, true), {
    y: 0, velocityY: 0, grounded: true, crouched: false,
  });
  assert.deepEqual(motion.applyVerticalAuthority(movement, 0, false), movement);
});
