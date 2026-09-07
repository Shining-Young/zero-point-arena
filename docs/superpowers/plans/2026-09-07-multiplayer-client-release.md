# Multiplayer Client and Windows Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing FPS to the authoritative server, add the room experience, and produce a Node-free Windows x64 portable game package.

**Architecture:** A transport/store layer converts validated WebSocket messages into lobby and match state. A multiplayer engine reuses current Three.js presentation and shared movement rules, predicting the local player while interpolating remote snapshots. Electron loads a local Vite build and supplies the fixed production WebSocket endpoint.

**Tech Stack:** React 19, Vite 8, Three.js, TypeScript, Electron, electron-builder, Playwright-free Node/WebSocket integration harness

**Spec:** `docs/superpowers/specs/2026-09-07-internet-multiplayer-design.md`

## Global Constraints

- Do not use Sites, Vinext hosting, or an embedded web preview for release gameplay.
- Preserve offline single-player training and all current combat controls.
- Multiplayer UI is Chinese and requires only nickname and six-character room code.
- Windows target is x64 portable; players do not need Node.js or administrator rights.
- Protocol version is exactly `1`; incompatible releases cannot enter a room.
- Remote entities render from a 100 ms interpolation buffer; local correction threshold is 0.35 m.

---

### Task 1: WebSocket Client and Reconnect Store

**Files:**
- Create: `lib/network/client.ts`
- Create: `lib/network/store.ts`
- Create: `lib/network/time-sync.ts`
- Create: `tests/network-client.test.mjs`

**Interfaces:**
- Consumes: `ClientMessage`, `ServerMessage`, `parseServerMessage()` from `shared/protocol.ts`.
- Produces: `GameConnection.connect()`, `send()`, `close()`, `subscribe()`, `latency`, and state phases `offline|connecting|lobby|playing|reconnecting|ended`.

- [ ] **Step 1: Write failing transport tests with a real local WebSocket server**

Test hello handshake, outbound queue before welcome, room state subscription, ping latency, malformed server message rejection, retry delays of 1/2/4/8 seconds, reconnect token reuse, explicit leave disabling retries, and version mismatch transitioning to a terminal error.

```js
test('reuses the reconnect token after an unexpected close', async () => {
  const connection = new GameConnection({ url, storage, timers });
  await connection.connect();
  server.sendWelcome({ reconnectToken: 'token-1' });
  server.drop();
  timers.advanceBy(1000);
  assert.equal(server.lastHello.reconnectToken, 'token-1');
});
```

- [ ] **Step 2: Run and verify RED**

Run `node --experimental-transform-types --test tests/network-client.test.mjs`.
Expected: FAIL because `GameConnection` is missing.

- [ ] **Step 3: Implement validated transport and immutable store**

Inject WebSocket, timers, storage, and clock for tests. Persist only reconnect token, nickname, and last room code. Never place the token in a URL or log it.

- [ ] **Step 4: Implement clock offset and interpolation sample selection**

Maintain median offset from five ping samples. Export `sampleSnapshots(buffer, renderServerTime)` that brackets render time and returns interpolation alpha clamped to `[0,1]`.

- [ ] **Step 5: Run tests and commit**

Run `npm test` and `npm run typecheck`, then:

```bash
git add lib/network tests/network-client.test.mjs
git commit -m "feat: add multiplayer websocket client"
```

### Task 2: Separate Local Simulation from Three.js Presentation

**Files:**
- Create: `lib/game/presentation.ts`
- Create: `lib/game/input.ts`
- Rename: `lib/game/engine.ts` to `lib/game/local-training.ts`
- Modify: `app/game.tsx`
- Modify: `tests/engine.test.mjs`

**Interfaces:**
- Produces: `GamePresentation`, `InputController`, and `LocalTrainingGame`.
- Consumes: current `world.ts`, `audio.ts`, and shared rules without changing player-visible single-player behavior.

- [ ] **Step 1: Add characterization tests for extracted behavior**

Keep current 17 tests and add tests that one input listener set is installed, Pointer Lock failure preserves fallback mouse look, presentation creates/removes remote soldiers by ID, and disposal releases listeners and Three.js resources.

- [ ] **Step 2: Run and verify RED**

Run `npm test`.
Expected: new extraction tests FAIL because the modules are missing; existing tests remain green.

- [ ] **Step 3: Extract input and rendering without changing rules**

Move keyboard, mouse, Pointer Lock, resize, scene, weapon animation, tracer, spark, and soldier display into focused classes. `LocalTrainingGame` owns local bots and delegates rendering/input.

```ts
export interface PresentedActor {
  id: string;
  x: number; y: number; z: number;
  yaw: number;
  health: number;
  kind: 'human' | 'bot';
}
```

- [ ] **Step 4: Run tests, typecheck, and local training smoke check**

Run `npm test`, `npm run typecheck`, and `npm run dev`. Start training, move, shoot, switch weapons, pause, resume, die, and respawn.
Expected: behavior matches the current game and Pointer Lock works in a standalone browser.

- [ ] **Step 5: Commit**

```bash
git add lib/game app/game.tsx tests/engine.test.mjs
git commit -m "refactor: separate fps presentation and local training"
```

### Task 3: Lobby and Room Interface

**Files:**
- Create: `app/multiplayer-menu.tsx`
- Create: `app/room-lobby.tsx`
- Create: `app/network-status.tsx`
- Modify: `app/game.tsx`
- Modify: `app/globals.css`
- Create: `tests/lobby-state.test.mjs`

**Interfaces:**
- Consumes: `GameConnection` store and room messages.
- Produces: create/join forms, six-character code copy, ready controls, host settings, start action, reconnect/error states.

- [ ] **Step 1: Write failing lobby reducer tests**

Test preserving nickname after a failed join, uppercasing room codes, disabling start until all humans are ready, host-only controls, player slot rendering, version error, reconnect overlay, and returning to offline training.

- [ ] **Step 2: Run and verify RED**

Run `node --experimental-transform-types --test tests/lobby-state.test.mjs`.
Expected: FAIL because the lobby reducer is missing.

- [ ] **Step 3: Implement accessible room forms and states**

Use semantic labels and buttons. Validate nickname length and room code before sending. Copy the room code with `navigator.clipboard.writeText`, with a selectable text fallback when clipboard permission is denied.

- [ ] **Step 4: Connect lobby actions to the transport**

Map create, join, configure, ready, start, play again, and leave directly to protocol messages. Display server error codes as specific Chinese guidance.

- [ ] **Step 5: Run tests, typecheck, and commit**

```bash
git add app tests/lobby-state.test.mjs
git commit -m "feat: add multiplayer room lobby"
```

### Task 4: Multiplayer Gameplay Engine

**Files:**
- Create: `lib/game/multiplayer.ts`
- Create: `lib/game/interpolation.ts`
- Create: `tests/multiplayer-engine.test.mjs`
- Modify: `app/game.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `GameConnection`, `GamePresentation`, `InputController`, shared movement rules, snapshots and combat events.
- Produces: predicted local view, interpolated remote humans/bots, multiplayer HUD, latency status, and server-driven results.

- [ ] **Step 1: Write failing multiplayer engine tests**

Test 20 Hz input sends, increasing input sequences, local prediction, acknowledgement removal, correction below/above 0.35 m, 100 ms interpolation, spawn/despawn, weapon events, server-only damage/score changes, reconnect freeze, and match result handling.

```js
test('snaps large authority errors and smooths small errors', () => {
  engine.position.set(0, 0);
  engine.applySnapshot(snapshotAt(0.2, 0));
  assert.equal(engine.correctionMode, 'smooth');
  engine.applySnapshot(snapshotAt(2, 0));
  assert.deepEqual(engine.position, { x: 2, z: 0 });
});
```

- [ ] **Step 2: Run and verify RED**

Run `node --experimental-transform-types --test tests/multiplayer-engine.test.mjs`.
Expected: FAIL because `MultiplayerGame` is missing.

- [ ] **Step 3: Implement prediction and reconciliation**

Buffer unacknowledged inputs. On each authoritative snapshot, restore the acknowledged server state and replay remaining inputs. Smooth errors up to 0.35 m over 100 ms; snap larger errors.

- [ ] **Step 4: Implement remote interpolation and events**

Render at `estimatedServerNow - 100ms`. Interpolate position and shortest-path yaw. Apply combat events once by event ID for tracers, hit markers, audio, feed, death, respawn, and results.

- [ ] **Step 5: Run full tests and typecheck**

Run `npm test`, `npm run test:server`, and `npm run typecheck`.
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/game app tests/multiplayer-engine.test.mjs
git commit -m "feat: render authoritative multiplayer matches"
```

### Task 5: Standalone Vite and Electron Runtime

**Files:**
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `electron/main.cjs`
- Create: `electron/preload.cjs`
- Create: `vite.client.config.ts`
- Create: `electron-builder.yml`
- Modify: `package.json`
- Delete: `.openai/hosting.json`
- Delete: `vite.config.ts`
- Delete: `next.config.ts`
- Delete: `启动游戏.bat`

**Interfaces:**
- Consumes: React game UI and `VITE_GAME_SERVER_URL` at build time.
- Produces: `dist-client/`, Electron main process, and `release/zero-point-0.2.0-win-x64.zip`.

- [ ] **Step 1: Add Vite/Electron build scripts and dependencies**

Add `electron` and `electron-builder` as dev dependencies and `@vitejs/plugin-react`. Scripts:

```json
{
  "client:dev": "vite --config vite.client.config.ts",
  "client:build": "vite build --config vite.client.config.ts",
  "desktop:dev": "npm-run-all --parallel client:dev desktop:open",
  "desktop:open": "wait-on http://localhost:5173 && electron .",
  "desktop:pack": "npm run client:build && electron-builder --win zip"
}
```

Add `npm-run-all` and `wait-on` as dev dependencies. Remove Vinext, the Sites Vite plugin, Cloudflare Vite plugin, Wrangler, React Server DOM, and server-only Next metadata usage after the standalone build works.

- [ ] **Step 2: Implement local-file-safe Vite entry**

Configure `base: './'`, React aliases, Tailwind PostCSS, and output `dist-client`. Render the existing `Game` directly in `src/main.tsx`; move metadata to `index.html`.

- [ ] **Step 3: Implement a locked-down Electron shell**

Use `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, deny new windows, and open external HTTP links with the OS browser. In development load `http://localhost:5173`; in production load `dist-client/index.html`. Enable no privileged preload APIs beyond `{ platform, releaseVersion }`.

- [ ] **Step 4: Configure the Windows portable ZIP**

Set app ID `cn.zeropoint.arena`, product name `零点行动`, x64 target, artifact name `zero-point-${version}-win-x64.zip`, and include only Electron runtime, `dist-client`, main/preload scripts, license, and README.

- [ ] **Step 5: Verify desktop input and offline mode**

Run the unpacked app. Verify Pointer Lock captures on start, Esc releases and pauses, retry restores capture, and local training works with the network disconnected.

- [ ] **Step 6: Run client build and package**

Run `npm run client:build` and `npm run desktop:pack`.
Expected: production build exits `0`; ZIP starts on Windows without a local Node.js installation.

- [ ] **Step 7: Commit**

```bash
git add index.html src electron vite.client.config.ts electron-builder.yml package.json package-lock.json app lib tests README.md
git add -u .openai vite.config.ts next.config.ts "启动游戏.bat"
git commit -m "build: package Zero Point as a standalone Windows game"
```

### Task 6: End-to-End Multiplayer Release Test

**Files:**
- Create: `tests/e2e-multiplayer.mjs`
- Create: `scripts/package-release.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: built server, built client, and two `GameConnection` instances.
- Produces: repeatable full-match smoke test and final release ZIP checksum.

- [ ] **Step 1: Implement the two-player release scenario**

The script starts the server on an ephemeral port, creates two clients, creates and joins a room, readies both, starts, sends movement, verifies mutual snapshots, fires until one confirmed kill, waits for respawn, forces the score limit, receives identical results, reconnects one client, then closes all handles.

- [ ] **Step 2: Add simulated network impairment**

Wrap one test transport with seeded 100–180 ms delay and 2% dropped snapshot messages. Assert no remote interpolation jump exceeds the server maximum speed times elapsed time plus 0.35 m correction tolerance.

- [ ] **Step 3: Run all automated verification**

Run:

```bash
npm test
npm run test:server
node tests/e2e-multiplayer.mjs
npm run typecheck
npm run client:build
npm run desktop:pack
```

Expected: every command exits `0`; no server/client handles remain open; the Windows ZIP exists.

- [ ] **Step 4: Inspect release contents and checksum**

`scripts/package-release.mjs` must reject archives containing source maps, `.env`, tokens, `.git`, server source, or `.openai`. It writes a SHA-256 checksum beside the ZIP and copies user-facing controls and server status guidance into the release README.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e-multiplayer.mjs scripts/package-release.mjs README.md
git commit -m "test: verify complete internet multiplayer release"
```

### Task 7: Render Deployment and Final Client Build

**Files:**
- Modify: `.env.production`
- Modify: `README.md`
- Generated: `release/zero-point-0.2.0-win-x64.zip`
- Generated: `release/zero-point-0.2.0-win-x64.zip.sha256`

**Interfaces:**
- Consumes: validated `render.yaml`, a user-authorized Git repository, and Render account access.
- Produces: a healthy public Render WebSocket endpoint ending in `/game` and the final Windows share package.

- [ ] **Step 1: Publish the reviewed source to a user-authorized repository**

Create or select the exact repository only after presenting its URL and visibility for approval. Push the verified commit; do not place credentials in Git configuration or remote URLs.

- [ ] **Step 2: Create the Render Blueprint**

Connect that repository in Render, select `render.yaml`, confirm service name `zero-point-game-server`, region `singapore`, plan `free`, and health path `/health`. Start the deployment only after the user approves the Render account action.

- [ ] **Step 3: Verify the deployed server**

Read the exact service URL from the completed Render deployment, append `/health` for the readiness request, replace `https://` with `wss://` and append `/game` for the socket test, then execute the create/join/start/snapshot smoke path.
Expected: health returns HTTP 200 and both clients receive the same room and match IDs.

- [ ] **Step 4: Build the client against the exact endpoint**

Run `node scripts/configure-release.mjs` with the exact successful Render service URL. The script validates HTTPS, converts it to WSS, appends `/game`, and writes the non-secret `VITE_GAME_SERVER_URL` entry to `.env.production`. Then run `npm run client:build`, `npm run desktop:pack`, and `node scripts/package-release.mjs`. The assigned host must be copied verbatim from the successful Render deployment; it must never be guessed.

- [ ] **Step 5: Test from a second external network**

Run two packaged clients on different internet connections. Create a room, share the six-character code, finish one kill/respawn cycle, disconnect one client for 10 seconds, and verify reconnection to the same seat.

- [ ] **Step 6: Deliver the release**

Provide the Windows ZIP and SHA-256 file. State the tested server region, release version, controls, free-service cold-start behavior, and that rooms are lost on server restarts.

## Client Plan Verification

The release is complete only when the full Task 6 command sequence passes and Task 7 verifies two clients against the deployed WebSocket endpoint. A locally built ZIP without a working public server is an intermediate artifact, not the final multiplayer deliverable.
