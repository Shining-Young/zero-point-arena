import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_MESSAGE_BYTES,
  ProtocolError,
  encodeServerMessage,
  parseClientMessage,
  parseServerMessage,
} from '../shared/protocol.ts';

const parse = value => parseClientMessage(JSON.stringify(value));

test('accepts the core client messages', () => {
  assert.equal(parse({ type: 'hello', protocolVersion:4, releaseVersion: '1.0.0' }).type, 'hello');
  assert.equal(parse({ type: 'create_room', nickname: ' Alice ', humanLimit: 4, botCount: 2, difficulty: 'normal' }).nickname, 'Alice');
  assert.equal(parse({ type: 'join_room', nickname: 'Bob', roomCode: 'ABC234' }).roomCode, 'ABC234');
  assert.equal(parse({ type: 'input', sequence: 1, moveX: 1, moveZ: -1, yaw: 0.5, pitch: 0, jump: false, crouch: false, sprint: true, clientTime: 100 }).type, 'input');
  assert.equal(parse({ type: 'fire', weapon: 'rifle', sequence: 2, yaw: 0, pitch: 0, clientTime: 120 }).type, 'fire');
});

test('rejects an unsupported protocol version', () => {
  assert.throws(() => parse({ type: 'hello', protocolVersion: 1, releaseVersion: '1.0.0' }), error => error instanceof ProtocolError && error.code === 'VERSION_MISMATCH');
});

test('rejects invalid nicknames, room codes and unknown message types', () => {
  assert.throws(() => parse({ type: 'create_room', nickname: '12345678901234567', humanLimit: 4, botCount: 0, difficulty: 'easy' }), /BAD_MESSAGE/);
  assert.throws(() => parse({ type: 'join_room', nickname: 'Bob', roomCode: 'abc234' }), /BAD_MESSAGE/);
  assert.throws(() => parse({ type: 'join_room', nickname: 'Bob', roomCode: 'ABCO10' }), /BAD_MESSAGE/);
  assert.throws(() => parse({ type: 'dance' }), /BAD_MESSAGE/);
});

test('rejects malformed and non-finite data', () => {
  assert.throws(() => parseClientMessage('{'), /BAD_MESSAGE/);
  assert.throws(() => parse({ type: 'input', sequence: 1, moveX: 0, moveZ: 0, yaw: 'Infinity', pitch: 0, jump: false, crouch: false, sprint: false, clientTime: 0 }), /BAD_MESSAGE/);
});

test('rejects messages larger than the UTF-8 byte limit', () => {
  const raw = JSON.stringify({ type: 'hello', protocolVersion:4, releaseVersion: '测'.repeat(MAX_MESSAGE_BYTES) });
  assert.ok(Buffer.byteLength(raw, 'utf8') > MAX_MESSAGE_BYTES);
  assert.throws(() => parseClientMessage(raw), error => error instanceof ProtocolError && error.code === 'MESSAGE_TOO_LARGE');
});

test('encodes server messages as JSON', () => {
  const encoded = encodeServerMessage({ type: 'error', code: 'ROOM_NOT_FOUND', message: '房间不存在' });
  assert.deepEqual(JSON.parse(encoded), { type: 'error', code: 'ROOM_NOT_FOUND', message: '房间不存在' });
});

test('parses server messages in a browser environment without Node Buffer', () => {
  const original = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    assert.equal(parseServerMessage('{"type":"error","code":"X","message":"x"}').type, 'error');
  } finally {
    globalThis.Buffer = original;
  }
});
