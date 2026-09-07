# Multiplayer Protocol and Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested, authoritative WebSocket room server for 2–4 internet players with optional server-controlled bots.

**Architecture:** Shared TypeScript schemas define the versioned wire protocol. A single-process room manager owns lobby state and an authoritative 20 Hz simulation; a thin HTTP/WebSocket gateway validates and rate-limits all traffic. The server is stateless across restarts and deploys as one Docker-backed Render web service.

**Tech Stack:** Node.js 24, TypeScript 5.9, `ws`, Zod, Node test runner, Docker, Render Blueprint

**Spec:** `docs/superpowers/specs/2026-09-07-internet-multiplayer-design.md`

## Global Constraints

- Do not use Sites or `.openai/hosting.json` for the multiplayer server.
- Protocol version is exactly `1`; messages are JSON and at most 8192 bytes.
- Rooms support 2–4 human seats, optional bots up to four total participants, 15 kills, and 300 seconds.
- Server tick is 20 Hz; snapshots are 10 Hz; accepted input rate is at most 30 per second per player.
- Reconnect seats are retained for 30 seconds; empty match rooms are retained for 60 seconds.
- The first deployment is one Render instance in `singapore`, using the `free` plan for external testing.

---

### Task 1: Shared Wire Protocol

**Files:**
- Modify: `package.json`
- Create: `shared/protocol.ts`
- Create: `shared/config.ts`
- Create: `tests/protocol.test.mjs`

**Interfaces:**
- Produces: `parseClientMessage(raw: string): ClientMessage`, `encodeServerMessage(message: ServerMessage): string`, `PROTOCOL_VERSION`, `MAX_MESSAGE_BYTES`.
- Consumes: nothing beyond Zod.

- [ ] **Step 1: Add dependencies and scripts**

Add `ws` and `zod` to dependencies; add `@types/ws` and `tsx` to dev dependencies. Add scripts:

```json
{
  "server:dev": "tsx watch server/index.ts",
  "server:start": "tsx server/index.ts",
  "test:server": "node --experimental-transform-types --test tests/protocol.test.mjs tests/rooms.test.mjs tests/simulation.test.mjs tests/gateway.test.mjs"
}
```

- [ ] **Step 2: Write failing protocol tests**

Cover a valid `hello`, `create_room`, `join_room`, `input`, and `fire`; reject protocol `2`, a 17-character nickname, lowercase or ambiguous room codes, non-finite numbers, an unknown message type, and a string whose UTF-8 size exceeds 8192 bytes.

```js
test('rejects an unsupported protocol version', () => {
  assert.throws(() => parseClientMessage(JSON.stringify({
    type: 'hello', protocolVersion: 2, releaseVersion: '1.0.0'
  })), /VERSION_MISMATCH/);
});
```

- [ ] **Step 3: Run the protocol test and verify RED**

Run `node --experimental-transform-types --test tests/protocol.test.mjs`.
Expected: FAIL because `shared/protocol.ts` does not exist.

- [ ] **Step 4: Implement strict discriminated schemas**

Define all client and server message types from the spec with `z.discriminatedUnion('type', [...])`. Normalize room codes with `/^[A-HJ-NP-Z2-9]{6}$/`, trim nicknames, require finite yaw/pitch and clamp movement axes to `[-1, 1]`. Throw typed errors with codes `BAD_MESSAGE`, `MESSAGE_TOO_LARGE`, or `VERSION_MISMATCH`.

```ts
export function parseClientMessage(raw: string): ClientMessage {
  if (Buffer.byteLength(raw, 'utf8') > MAX_MESSAGE_BYTES)
    throw new ProtocolError('MESSAGE_TOO_LARGE');
  const value: unknown = JSON.parse(raw);
  return clientMessageSchema.parse(value);
}
```

- [ ] **Step 5: Run the protocol tests and verify GREEN**

Run `node --experimental-transform-types --test tests/protocol.test.mjs`.
Expected: all protocol tests PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json shared tests/protocol.test.mjs
git commit -m "feat: define multiplayer wire protocol"
```

### Task 2: Lobby and Room Lifecycle

**Files:**
- Create: `server/room-code.ts`
- Create: `server/room-manager.ts`
- Create: `server/types.ts`
- Create: `tests/rooms.test.mjs`

**Interfaces:**
- Consumes: `CreateRoomMessage`, `JoinRoomMessage`, `Difficulty` from `shared/protocol.ts`.
- Produces: `RoomManager.createRoom()`, `joinRoom()`, `disconnect()`, `reconnect()`, `configureRoom()`, `setReady()`, `startMatch()`, `playAgain()`, and `sweep(now)`.

- [ ] **Step 1: Write failing room tests**

Test six-character codes without `0/O/1/I`, collision retries using an injected random source, maximum human seats, unique nickname suffixing, host-only configuration, all-humans-ready start, host migration to the oldest connection, 30-second seat retention, duplicate-token eviction, and 60-second room cleanup.

```js
test('transfers host to the earliest remaining connected player', () => {
  const { room, host } = createRoomWithClock();
  const second = manager.joinRoom(room.code, { nickname: 'B' });
  manager.disconnect(host.playerId, 1000);
  assert.equal(room.hostPlayerId, second.playerId);
});
```

- [ ] **Step 2: Run and verify RED**

Run `node --experimental-transform-types --test tests/rooms.test.mjs`.
Expected: FAIL because `RoomManager` is missing.

- [ ] **Step 3: Implement room codes and state transitions**

Use `crypto.randomBytes` for production codes and reconnect tokens. Store `Map<roomCode, Room>` and `Map<reconnectToken, PlayerRef>`. Return serializable `room_state` payloads without reconnect tokens.

```ts
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function roomCode(bytes = randomBytes(6)): string {
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}
```

- [ ] **Step 4: Run room tests and verify GREEN**

Run `node --experimental-transform-types --test tests/rooms.test.mjs`.
Expected: all room lifecycle tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server tests/rooms.test.mjs
git commit -m "feat: add multiplayer rooms and reconnect lifecycle"
```

### Task 3: Authoritative Match Simulation

**Files:**
- Create: `server/simulation.ts`
- Create: `server/history.ts`
- Create: `server/bots.ts`
- Create: `tests/simulation.test.mjs`
- Modify: `lib/game/rules.ts`

**Interfaces:**
- Consumes: `moveActor`, `lineClear`, `findPath`, `reloadAmmo`, `matchOutcome`, `OBSTACLES`, and room participants.
- Produces: `MatchSimulation.applyInput()`, `fire()`, `reload()`, `switchWeapon()`, `tick(dt)`, `snapshot()`, and combat events.

- [ ] **Step 1: Write failing authoritative simulation tests**

Test diagonal speed normalization, obstacle collision, jump/crouch state, stale and duplicate input sequence rejection, AR-4 and P-12 fire cadence, server ammo consumption, reload timing, head/body damage, cover blocking, 200 ms rewind cap, spawn protection, death/respawn, score limit, timeout, and server bots producing valid movement and shots.

```js
test('rejects a shot through the shared container obstacle', () => {
  const sim = matchWithPlayers({ shooter: [-9, -18], target: [-9, 3] });
  sim.fire('shooter', { sequence: 1, yaw: 0, pitch: 0, clientTime: 1000 });
  assert.equal(sim.player('target').health, 100);
});
```

- [ ] **Step 2: Run and verify RED**

Run `node --experimental-transform-types --test tests/simulation.test.mjs`.
Expected: FAIL because `MatchSimulation` is missing.

- [ ] **Step 3: Extract shared deterministic movement helpers**

Add a shared `advanceActor(position, input, movementState, dt)` helper that uses existing collision geometry. It must normalize movement axes, apply sprint/crouch speed, and return position plus vertical state without reading DOM or Three.js.

- [ ] **Step 4: Implement the fixed-step match**

The server accumulates elapsed time and calls simulation with `FIXED_DT = 1 / 20`. Keep a circular 500 ms history of timestamped participant transforms. Rewind only targets, never obstacles or shooter ammo state.

```ts
while (accumulator >= FIXED_DT) {
  simulation.tick(FIXED_DT);
  accumulator -= FIXED_DT;
}
```

- [ ] **Step 5: Implement server bots from shared rules**

Move bot decision data into plain server records. Reuse `findPath` and `lineClear`; emit the same input/fire operations used for human players so scoring and combat rules have one path.

- [ ] **Step 6: Run simulation and existing tests**

Run `npm test` and `npm run typecheck`.
Expected: existing 17 tests and all new simulation tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/game/rules.ts server tests/simulation.test.mjs
git commit -m "feat: add authoritative multiplayer simulation"
```

### Task 4: WebSocket Gateway and Abuse Limits

**Files:**
- Create: `server/index.ts`
- Create: `server/gateway.ts`
- Create: `server/rate-limit.ts`
- Create: `tests/gateway.test.mjs`

**Interfaces:**
- Consumes: protocol parser, `RoomManager`, and `MatchSimulation`.
- Produces: HTTP `GET /health`, WebSocket upgrade on `/game`, room broadcasts, and graceful shutdown.

- [ ] **Step 1: Write failing gateway tests with real sockets**

Start the server on port `0`. Test health response, reject other WebSocket paths, `hello` before room actions, create/join broadcasts, input acknowledgement, 30-input-per-second allowance, close code `1009` for oversized messages, application error for malformed JSON, and duplicate reconnect closing the old connection.

```js
test('reports application readiness', async () => {
  const server = await startTestServer();
  const response = await fetch(`${server.httpUrl}/health`);
  assert.deepEqual(await response.json(), { ok: true, protocolVersion: 1 });
  await server.close();
});
```

- [ ] **Step 2: Run and verify RED**

Run `node --experimental-transform-types --test tests/gateway.test.mjs`.
Expected: FAIL because the gateway is missing.

- [ ] **Step 3: Implement HTTP and WebSocket lifecycle**

Bind to `process.env.PORT ?? 3001` and `0.0.0.0`. Associate each socket with at most one player. Broadcast `room_state` on lobby changes, `snapshot` every second simulation tick, and combat events immediately.

- [ ] **Step 4: Add token-bucket limits and safe logging**

Create buckets for 30 input messages/second, 60 total messages/second, 10 room creations/IP/minute, and 60 joins/IP/minute. Log anonymous player IDs and error codes only; never log nicknames or reconnect tokens.

- [ ] **Step 5: Run gateway and full server tests**

Run `npm run test:server` and `npm run typecheck`.
Expected: all tests PASS with no open handles.

- [ ] **Step 6: Commit**

```bash
git add server tests/gateway.test.mjs package.json
git commit -m "feat: expose authoritative websocket game gateway"
```

### Task 5: Docker and Render Deployment Contract

**Files:**
- Create: `Dockerfile.server`
- Create: `.dockerignore`
- Create: `render.yaml`
- Create: `server/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `npm run server:start` and HTTP `/health`.
- Produces: a non-root production container and Render Blueprint named `zero-point-game-server`.

- [ ] **Step 1: Write the production container and Blueprint**

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY lib/game/rules.ts ./lib/game/rules.ts
USER node
ENV NODE_ENV=production
CMD ["node", "--experimental-transform-types", "server/index.ts"]
```

```yaml
services:
  - type: web
    name: zero-point-game-server
    runtime: docker
    region: singapore
    plan: free
    dockerfilePath: ./Dockerfile.server
    healthCheckPath: /health
    autoDeployTrigger: off
```

- [ ] **Step 2: Verify the container locally**

Run `docker build -f Dockerfile.server -t zero-point-server:test .`, start it with `docker run --rm -p 3101:3001 zero-point-server:test`, then request `http://localhost:3101/health`.
Expected: HTTP 200 with protocol version `1`.

- [ ] **Step 3: Run a two-client smoke test against the container**

Use the real WebSocket test helper to create a room, join it, ready both players, start the match, exchange input, observe both player IDs in one snapshot, and close both sockets.
Expected: the smoke test exits `0` and the container has no uncaught errors.

- [ ] **Step 4: Update server operations documentation**

Document `PORT`, SIGTERM behavior, `/health`, `/game`, log fields, in-memory room loss on restart, single-instance requirement, and Render free-instance cold starts.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.server .dockerignore render.yaml server/README.md README.md
git commit -m "build: package multiplayer server for Render"
```

## Server Plan Verification

Run:

```bash
npm test
npm run test:server
npm run typecheck
docker build -f Dockerfile.server -t zero-point-server:test .
```

Expected: all tests pass, TypeScript reports no errors, and the server image builds successfully.
