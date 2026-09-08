import { advanceActor, type MovementInput, type MovementState, type Point } from '../game/rules.ts';

export type LocalPrediction = {
  position: Point;
  visualPosition: Point;
  movement: MovementState;
};

export type PendingPrediction = { sequence: number; position: Point };
export type Pose = Point & { y: number; yaw: number };

export function advanceLocalPrediction(state: LocalPrediction, input: MovementInput, dt: number): LocalPrediction {
  const next = advanceActor(state.position, input, state.movement, dt);
  return {
    position: next.position,
    visualPosition: {
      x: state.visualPosition.x + next.position.x - state.position.x,
      z: state.visualPosition.z + next.position.z - state.position.z,
    },
    movement: next.movement,
  };
}

export function reconcilePrediction(
  position: Point,
  visualPosition: Point,
  pending: PendingPrediction[],
  authoritative: Point,
  acknowledgedSequence: number | undefined,
  hardSnapDistance = 3,
) {
  const acknowledged = acknowledgedSequence === undefined ? undefined : [...pending].reverse().find(item => item.sequence <= acknowledgedSequence);
  const remaining = acknowledgedSequence === undefined ? pending : pending.filter(item => item.sequence > acknowledgedSequence);
  if (!acknowledged) {
    if (Math.hypot(authoritative.x - position.x, authoritative.z - position.z) > hardSnapDistance) {
      return { position: authoritative, visualPosition: authoritative, pending: remaining, snapped: true };
    }
    return { position, visualPosition, pending: remaining, snapped: false };
  }
  const correction = { x: authoritative.x - acknowledged.position.x, z: authoritative.z - acknowledged.position.z };
  if (Math.hypot(correction.x, correction.z) > hardSnapDistance) {
    return { position: authoritative, visualPosition: authoritative, pending: remaining, snapped: true };
  }
  return {
    position: { x: position.x + correction.x, z: position.z + correction.z },
    visualPosition,
    pending: remaining,
    snapped: false,
  };
}

export function interpolatePose(before: Pose, after: Pose, alpha: number, discontinuity = false, teleportDistance = 3): Pose {
  if (discontinuity || Math.hypot(after.x - before.x, after.z - before.z) > teleportDistance) return { ...after };
  const t = Math.max(0, Math.min(1, alpha));
  const angleDelta = Math.atan2(Math.sin(after.yaw - before.yaw), Math.cos(after.yaw - before.yaw));
  return {
    x: before.x + (after.x - before.x) * t,
    y: before.y + (after.y - before.y) * t,
    z: before.z + (after.z - before.z) * t,
    yaw: before.yaw + angleDelta * t,
  };
}

export function applyVerticalAuthority(movement: MovementState, y: number, discontinuity: boolean): MovementState {
  if (!discontinuity) return movement;
  return { y, velocityY: 0, grounded: y <= 0, crouched: false };
}
