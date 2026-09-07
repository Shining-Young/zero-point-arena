import { randomBytes, randomUUID } from 'node:crypto';
import type { CreateRoomMessage, Difficulty, JoinRoomMessage, ServerMessage } from '../shared/protocol.ts';
import { EMPTY_MATCH_GRACE_MS, RECONNECT_GRACE_MS } from '../shared/config.ts';
import { makeRoomCode } from './room-code.ts';
import type { Room, RoomPlayerRecord } from './types.ts';

export class RoomError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'RoomError'; }
}

type RoomConfig = Pick<CreateRoomMessage, 'nickname' | 'humanLimit' | 'botCount' | 'difficulty'>;
type JoinConfig = Pick<JoinRoomMessage, 'nickname'>;
type ManagerOptions = { codeSource?: () => string; now?: () => number };

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly tokens = new Map<string, { roomCode: string; playerId: string }>();
  private readonly codeSource: () => string;
  private readonly now: () => number;

  constructor(options: ManagerOptions = {}) {
    this.codeSource = options.codeSource ?? (() => makeRoomCode());
    this.now = options.now ?? Date.now;
  }

  getRoom(code: string) { return this.rooms.get(code); }

  createRoom(config: RoomConfig, connectionId?: string) {
    let code = '';
    for (let attempts = 0; attempts < 100; attempts += 1) {
      code = this.codeSource();
      if (!this.rooms.has(code)) break;
    }
    if (!code || this.rooms.has(code)) throw new RoomError('CODE_EXHAUSTED');
    const player = this.makePlayer(config.nickname, connectionId);
    const room: Room = {
      code, phase: 'lobby', hostPlayerId: player.id,
      humanLimit: config.humanLimit, botCount: config.botCount,
      difficulty: config.difficulty, players: new Map([[player.id, player]]),
    };
    this.rooms.set(code, room);
    this.tokens.set(player.reconnectToken, { roomCode: code, playerId: player.id });
    return { room, player };
  }

  joinRoom(code: string, config: JoinConfig, connectionId?: string) {
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND');
    if (room.phase !== 'lobby') throw new RoomError('MATCH_ALREADY_STARTED');
    if ([...room.players.values()].filter(player => player.connected || player.disconnectedAt !== undefined).length >= room.humanLimit) throw new RoomError('ROOM_FULL');
    const player = this.makePlayer(this.uniqueNickname(room, config.nickname), connectionId);
    room.players.set(player.id, player);
    this.tokens.set(player.reconnectToken, { roomCode: code, playerId: player.id });
    room.emptySince = undefined;
    return { room, player };
  }

  configureRoom(code: string, playerId: string, config: { botCount: number; difficulty: Difficulty }) {
    const room = this.mustRoom(code);
    this.requireHost(room, playerId);
    if (room.phase !== 'lobby') throw new RoomError('MATCH_ALREADY_STARTED');
    room.botCount = Math.max(0, Math.min(4 - room.players.size, config.botCount));
    room.difficulty = config.difficulty;
    return room;
  }

  setReady(code: string, playerId: string, ready: boolean) {
    const player = this.mustPlayer(this.mustRoom(code), playerId);
    player.ready = ready;
  }

  startMatch(code: string, playerId: string) {
    const room = this.mustRoom(code);
    this.requireHost(room, playerId);
    if (room.phase !== 'lobby') throw new RoomError('MATCH_ALREADY_STARTED');
    const humans = [...room.players.values()].filter(player => player.connected);
    if (!humans.length || humans.some(player => !player.ready)) throw new RoomError('NOT_READY');
    room.phase = 'playing';
    return room;
  }

  playAgain(code: string, playerId: string) {
    const room = this.mustRoom(code);
    this.requireHost(room, playerId);
    if (room.phase !== 'finished') throw new RoomError('MATCH_NOT_FINISHED');
    room.phase = 'lobby';
    for (const player of room.players.values()) player.ready = false;
    return room;
  }

  disconnect(playerId: string, at = this.now()) {
    for (const room of this.rooms.values()) {
      const player = room.players.get(playerId);
      if (!player) continue;
      player.connected = false;
      player.disconnectedAt = at;
      player.connectionId = undefined;
      const connected = [...room.players.values()].filter(item => item.connected).sort((a, b) => a.joinedAt - b.joinedAt);
      if (room.hostPlayerId === playerId && connected[0]) room.hostPlayerId = connected[0].id;
      if (!connected.length) room.emptySince = at;
      return room;
    }
  }

  reconnect(token: string, at = this.now(), connectionId?: string) {
    const ref = this.tokens.get(token);
    if (!ref) throw new RoomError('RECONNECT_EXPIRED');
    const room = this.rooms.get(ref.roomCode);
    const player = room?.players.get(ref.playerId);
    if (!room || !player || (player.disconnectedAt !== undefined && at - player.disconnectedAt > RECONNECT_GRACE_MS)) throw new RoomError('RECONNECT_EXPIRED');
    const evictedConnectionId = player.connected ? player.connectionId : undefined;
    player.connected = true;
    player.disconnectedAt = undefined;
    player.connectionId = connectionId;
    room.emptySince = undefined;
    return { room, player, evictedConnectionId };
  }

  leaveRoom(code: string, playerId: string) {
    const room = this.mustRoom(code);
    const player = this.mustPlayer(room, playerId);
    room.players.delete(playerId);
    this.tokens.delete(player.reconnectToken);
    const connected = [...room.players.values()].filter(item => item.connected).sort((a, b) => a.joinedAt - b.joinedAt);
    if (room.hostPlayerId === playerId && connected[0]) room.hostPlayerId = connected[0].id;
    if (!room.players.size || (room.phase === 'lobby' && !connected.length)) this.rooms.delete(code);
  }

  sweep(at = this.now()) {
    for (const [code, room] of this.rooms) {
      for (const [playerId, player] of room.players) {
        if (!player.connected && player.disconnectedAt !== undefined && at - player.disconnectedAt > RECONNECT_GRACE_MS) {
          room.players.delete(playerId);
          this.tokens.delete(player.reconnectToken);
        }
      }
      if (room.phase === 'playing' && room.emptySince !== undefined && at - room.emptySince > EMPTY_MATCH_GRACE_MS) this.rooms.delete(code);
      else if (!room.players.size && room.phase !== 'playing') this.rooms.delete(code);
    }
  }

  roomState(room: Room): Extract<ServerMessage, { type: 'room_state' }> {
    return {
      type: 'room_state', roomCode: room.code, hostPlayerId: room.hostPlayerId,
      phase: room.phase, humanLimit: room.humanLimit, botCount: room.botCount,
      difficulty: room.difficulty,
      players: [...room.players.values()].map(player => ({
        playerId: player.id, nickname: player.nickname, connected: player.connected,
        ready: player.ready, isHost: player.id === room.hostPlayerId, isBot: false,
      })),
    };
  }

  private makePlayer(nickname: string, connectionId?: string): RoomPlayerRecord {
    return {
      id: randomUUID(), nickname: nickname.trim(), reconnectToken: randomBytes(16).toString('hex'),
      connected: true, ready: false, joinedAt: this.now(), connectionId,
    };
  }

  private uniqueNickname(room: Room, requested: string) {
    const base = requested.trim();
    const used = new Set([...room.players.values()].map(player => player.nickname));
    if (!used.has(base)) return base;
    let suffix = 2;
    while (used.has(`${base} (${suffix})`)) suffix += 1;
    return `${base} (${suffix})`.slice(0, 16);
  }

  private mustRoom(code: string) {
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND');
    return room;
  }

  private mustPlayer(room: Room, playerId: string) {
    const player = room.players.get(playerId);
    if (!player) throw new RoomError('PLAYER_NOT_FOUND');
    return player;
  }

  private requireHost(room: Room, playerId: string) {
    if (room.hostPlayerId !== playerId) throw new RoomError('NOT_HOST');
  }
}

