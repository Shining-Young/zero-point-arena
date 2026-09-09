# Multiplayer experience parity implementation plan

> For agentic workers: use subagent-driven-development for bounded independent components and request final code review.

**Goal:** Execute the six user-approved fixes, preserving identical human and bot weapon damage.

**Architecture:** Share presentation and settings with offline mode. Replace checkpoint-delta reconciliation with duration-bearing command simulation and replay. Server remains authoritative for movement, collision, ammo and damage.

**Tech Stack:** TypeScript, React, Three.js, WebSocket, Electron, Node test runner.

**Spec:** User-approved six-point design in this conversation, with the correction that bots use player damage and headshot multipliers.

## Constraints

- No browser automation. Deliver a fresh Windows ZIP and explicit manual acceptance steps.
- Internet multiplayer; settings overlay stops local controls but not the match.
- Right click toggles aim in both modes. Shared persistent sensitivity and sound.
- Bot difficulty controls reaction, aim error, tracking and firing decisions, never damage.

## Task 1: Deterministic commands and aim geometry

Files: shared/protocol.ts, shared/config.ts, server/simulation.ts, server/gateway.ts, lib/network/motion.ts, lib/game/multiplayer.ts, lib/game/shot-effects.ts, lib/game/rules.ts.

- [ ] Add regression tests demonstrating received input must not be acknowledged before simulation, idle ticks must not repeat finite-duration commands, and replay under jitter reaches the identical stopped position.
- [ ] Commands carry bounded duration; simulate in shared small steps on server and client, acknowledge only after processing; bound server command budget and queue. Record input/state history including vertical state. Flush completed input on key transitions.
- [ ] Replay unacknowledged commands from authoritative state and render only a substep preview. Reset timeline on respawn/reconnect; drop obsolete input.
- [ ] Aim from camera center to cover, draw muzzle-to-target with muzzle obstruction. Update camera before firing. Match ranges and relay authoritative shot endpoints.
- [ ] Run motion, protocol, simulation and shot-effect tests and typecheck.

## Task 2: Presentation and controls

Files: app/multiplayer.tsx, app/game.tsx, shared presentation/settings modules, lib/game/engine.ts, lib/game/multiplayer.ts.

- [ ] Test settings persistence, aim toggle, reload/ADS animation progression and interruption.
- [ ] Reuse offline HUD styling/layout, score semantics, visibility-filtered radar, feed, health/ammo, reload indicator and death/result treatment.
- [ ] Settings overlay handles Esc/pointer unlock, prevents input leakage, clears controls and sends stop. Continue re-locks without firing; saves sensitivity/sound.
- [ ] Use immediate local weapon animation with authoritative correction. Toggle ADS in both modes; preserve intended ADS across reload, cancel on death/switch/menu.
- [ ] Run component/control tests and typecheck.

## Task 3: Bot behavior

Files: server/bots.ts, server/simulation.ts, tests/bots.test.mjs.

- [ ] Test delayed acquisition, aim imperfection, equal player damage, cooldown/reload and cover behavior with seeded randomness.
- [ ] Use per-bot target acquisition/reaction state, bounded angular tracking, distance/movement-sensitive aim error, burst/rest decisions and navigation; same weapon damage path as players.
- [ ] Run simulation and bot tests.

## Task 4: Integration and release

- [ ] Code review of all six requirements, resolve important findings.
- [ ] Full test suite, typecheck, client build, local multiplayer E2E, executable startup.
- [ ] Bump protocol/release coherently, commit, push, deploy and verify public health and multiplayer smoke.
- [ ] Package/checksum/publish ZIP. Document tested automation versus manual visual checks still needed.
