import type { Difficulty } from '../shared/protocol.ts';

const BOT_SETTINGS = {
  easy: { reaction: 0.8, aim: 0.82 },
  normal: { reaction: 0.55, aim: 0.9 },
  hard: { reaction: 0.3, aim: 0.96 },
} as const;

export function botSettings(difficulty: Difficulty) { return BOT_SETTINGS[difficulty]; }

