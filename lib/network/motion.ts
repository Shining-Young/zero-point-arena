import { advanceActor, moveActor, type MovementInput, type MovementState, type Obstacle, type Point } from '../game/rules.ts';

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
  obstacles?:Obstacle[],
) {
  const acknowledged = acknowledgedSequence === undefined ? undefined : [...pending].reverse().find(item => item.sequence <= acknowledgedSequence);
  const remaining = acknowledgedSequence === undefined ? pending : pending.filter(item => item.sequence > acknowledgedSequence);
  if (!acknowledged) {
    if (Math.hypot(authoritative.x - position.x, authoritative.z - position.z) > hardSnapDistance) {
      return { position: authoritative, visualPosition: authoritative, pending: [], snapped: true };
    }
    return { position, visualPosition, pending: remaining, snapped: false };
  }
  const correction = { x: authoritative.x - acknowledged.position.x, z: authoritative.z - acknowledged.position.z };
  if (Math.hypot(correction.x, correction.z) > hardSnapDistance) {
    return { position: authoritative, visualPosition: authoritative, pending: [], snapped: true };
  }
  let replayed={...authoritative},previous=acknowledged.position;
  const replayedPending=remaining.map(item=>{
    replayed=moveActor(replayed,item.position.x-previous.x,item.position.z-previous.z,obstacles);previous=item.position;
    return {sequence:item.sequence,position:{...replayed}};
  });
  const tail=remaining[remaining.length-1]?.position??acknowledged.position;
  replayed=moveActor(replayed,position.x-tail.x,position.z-tail.z,obstacles);
  return {
    position: replayed,
    visualPosition,
    pending: replayedPending,
    snapped: false,
  };
}

export function smoothVisualPosition(visual: Point, target: Point, alpha: number, obstacles?: Obstacle[]): Point {
  const t = Math.max(0, Math.min(1, alpha));
  const candidate = {
    x: visual.x + (target.x - visual.x) * t,
    z: visual.z + (target.z - visual.z) * t,
  };
  const constrained = moveActor(visual, candidate.x - visual.x, candidate.z - visual.z, obstacles);
  const blocked = Math.hypot(constrained.x - candidate.x, constrained.z - candidate.z) > 1e-4;
  return blocked ? { ...target } : constrained;
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
