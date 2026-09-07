import type { Point } from '../lib/game/rules.ts';

type Frame = { at: number; positions: Map<string, Point> };

export class PositionHistory {
  private frames: Frame[] = [];
  constructor(private readonly retentionMs = 500) {}
  record(at: number, positions: Map<string, Point>) {
    this.frames.push({ at, positions: new Map(positions) });
    while (this.frames[0] && at - this.frames[0].at > this.retentionMs) this.frames.shift();
  }
  sample(playerId: string, at: number) {
    let selected = this.frames[0];
    for (const frame of this.frames) if (frame.at <= at) selected = frame; else break;
    return selected?.positions.get(playerId);
  }
}

