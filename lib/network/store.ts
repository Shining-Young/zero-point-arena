import type { ServerMessage } from '../../shared/protocol.ts';
export type ConnectionPhase='offline'|'connecting'|'lobby'|'playing'|'reconnecting'|'ended';
export type ConnectionState={phase:ConnectionPhase;lastMessage?:ServerMessage;error?:string;latency:number};
export const INITIAL_CONNECTION:ConnectionState={phase:'offline',latency:0};

