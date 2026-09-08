import { z } from 'zod';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, RELEASE_VERSION } from './config.ts';

export { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, RELEASE_VERSION };

export type ProtocolErrorCode = 'BAD_MESSAGE' | 'MESSAGE_TOO_LARGE' | 'VERSION_MISMATCH';
const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

export class ProtocolError extends Error {
  constructor(public readonly code: ProtocolErrorCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'ProtocolError';
  }
}

const nickname = z.string().trim().min(1).max(16);
const roomCode = z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/);
const difficulty = z.enum(['easy', 'normal', 'hard']);
const weapon = z.enum(['rifle', 'pistol']);
const finite = z.number().finite();
const sequence = z.number().int().nonnegative();

const helloSchema = z.object({
  type: z.literal('hello'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  releaseVersion: z.string().trim().min(1).max(32),
  reconnectToken: z.string().min(16).max(256).optional(),
}).strict();

const createRoomSchema = z.object({
  type: z.literal('create_room'), nickname,
  humanLimit: z.number().int().min(2).max(4),
  botCount: z.number().int().min(0).max(3), difficulty,
}).strict();

const joinRoomSchema = z.object({
  type: z.literal('join_room'), nickname, roomCode,
  reconnectToken: z.string().min(16).max(256).optional(),
}).strict();

const inputSchema = z.object({
  type: z.literal('input'), sequence,
  moveX: finite.min(-1).max(1), moveZ: finite.min(-1).max(1),
  yaw: finite, pitch: finite.min(-Math.PI / 2).max(Math.PI / 2),
  jump: z.boolean(), crouch: z.boolean(), sprint: z.boolean(),
  clientTime: finite.nonnegative(),
}).strict();

const fireSchema = z.object({
  type: z.literal('fire'), weapon, sequence, yaw: finite,
  pitch: finite.min(-Math.PI / 2).max(Math.PI / 2), clientTime: finite.nonnegative(),
}).strict();

export const clientMessageSchema = z.discriminatedUnion('type', [
  helloSchema, createRoomSchema, joinRoomSchema,
  z.object({ type: z.literal('set_ready'), ready: z.boolean() }).strict(),
  z.object({ type: z.literal('configure_room'), botCount: z.number().int().min(0).max(3), difficulty }).strict(),
  z.object({ type: z.literal('start_match') }).strict(),
  inputSchema, fireSchema,
  z.object({ type: z.literal('reload') }).strict(),
  z.object({ type: z.literal('switch_weapon'), weapon }).strict(),
  z.object({ type: z.literal('leave_room') }).strict(),
  z.object({ type: z.literal('play_again') }).strict(),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type Difficulty = z.infer<typeof difficulty>;
export type Weapon = z.infer<typeof weapon>;
export type CreateRoomMessage = z.infer<typeof createRoomSchema>;
export type JoinRoomMessage = z.infer<typeof joinRoomSchema>;

export type RoomPlayer = {
  playerId: string; nickname: string; connected: boolean; ready: boolean;
  isHost: boolean; isBot: boolean;
};
export type SnapshotEntity = {
  id: string; nickname: string; isBot: boolean; x: number; y: number; z: number;
  yaw: number; pitch: number; health: number; weapon: Weapon; ammo: number;
  reserve: number; kills: number; deaths: number; alive: boolean;
  reloadLeft: number; spawnProtection: number;
};
export type CombatEventMessage =
  | { type:'combat_event';event:'shot';actorId:string;yaw:number;pitch:number }
  | { type:'combat_event';event:'hit'|'headshot'|'kill'|'reload'|'respawn';actorId:string;targetId?:string;value?:number };
export type ServerMessage =
  | { type: 'welcome'; playerId: string; reconnectToken: string; serverTime: number }
  | { type: 'room_state'; roomCode: string; hostPlayerId: string; phase: 'lobby' | 'playing' | 'finished'; humanLimit: number; botCount: number; difficulty: Difficulty; players: RoomPlayer[] }
  | { type: 'snapshot'; tick: number; serverTime: number; remainingSeconds: number; lastProcessedInput?: number; entities: SnapshotEntity[] }
  | CombatEventMessage
  | { type: 'match_started'; serverTime: number }
  | { type: 'match_finished'; winnerId?: string; reason: 'score' | 'time' }
  | { type: 'host_changed'; hostPlayerId: string }
  | { type: 'error'; code: string; message: string };

export function parseClientMessage(raw: string): ClientMessage {
  if (utf8Bytes(raw) > MAX_MESSAGE_BYTES) throw new ProtocolError('MESSAGE_TOO_LARGE');
  let value: unknown;
  try { value = JSON.parse(raw); } catch (error) { throw new ProtocolError('BAD_MESSAGE', error); }
  if (typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'hello' && (value as { protocolVersion?: unknown }).protocolVersion !== PROTOCOL_VERSION) {
    throw new ProtocolError('VERSION_MISMATCH');
  }
  const result = clientMessageSchema.safeParse(value);
  if (!result.success) throw new ProtocolError('BAD_MESSAGE', result.error);
  return result.data;
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

const SERVER_TYPES = new Set(['welcome','room_state','snapshot','combat_event','match_started','match_finished','host_changed','error']);
export function parseServerMessage(raw:string):ServerMessage{
  if(utf8Bytes(raw)>MAX_MESSAGE_BYTES)throw new ProtocolError('MESSAGE_TOO_LARGE');
  let value:unknown;try{value=JSON.parse(raw);}catch(error){throw new ProtocolError('BAD_MESSAGE',error);}
  if(!value||typeof value!=='object'||!SERVER_TYPES.has(String((value as {type?:unknown}).type)))throw new ProtocolError('BAD_MESSAGE');
  return value as ServerMessage;
}
