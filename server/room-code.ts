import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(bytes: Uint8Array = randomBytes(6)): string {
  return Array.from(bytes.slice(0, 6), byte => ALPHABET[byte % ALPHABET.length]).join('');
}

