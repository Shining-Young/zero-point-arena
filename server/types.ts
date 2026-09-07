import type { Difficulty } from '../shared/protocol.ts';

export type RoomPhase = 'lobby' | 'playing' | 'finished';

export type RoomPlayerRecord = {
  id: string;
  nickname: string;
  reconnectToken: string;
  connected: boolean;
  ready: boolean;
  joinedAt: number;
  disconnectedAt?: number;
  connectionId?: string;
};

export type Room = {
  code: string;
  phase: RoomPhase;
  hostPlayerId: string;
  humanLimit: number;
  botCount: number;
  difficulty: Difficulty;
  players: Map<string, RoomPlayerRecord>;
  emptySince?: number;
};

