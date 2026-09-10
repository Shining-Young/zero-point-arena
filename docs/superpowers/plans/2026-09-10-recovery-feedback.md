# 2026-09-10 multiplayer recovery and feedback

Approved design: fix stale movement/Shift, visible sensitivity, persistent room rounds, training exit, hit/shield feedback, player/NPC labels.

- Network: real ping, stale socket watchdog, explicit throttle error, input reset handshake invalidates old commands/actions without respawning.
- Input: shared left/right Shift policy, moving sprint cancels ADS, crouch prevents sprint.
- UI: shared native sensitivity control, training exit, retain finished view and return same room; isolated UI implementer.
- Presentation: reusable occluded nameplates, identity bands, authoritative hit and spawn shield feedback in both modes.
- Verification: regression tests, typecheck, build, desktop package. Real multiplayer visual acceptance delegated to user as requested.

Progress: implementation in working tree; integration tests and review in progress. No deployment yet.
Ruling: use existing workspace on codex/multiplayer-recovery-feedback to preserve user launch paths; main unchanged.
Ruling: no durable database; existing room lifetime and reconnect grace unchanged.

Verification complete: 105 tests passed, typecheck and desktop build passed. Review findings (sequence recovery, asynchronous socket close, old-connection ownership, unknown finished result) resolved and regression-tested. Packaged Windows x64 0.2.5, protocol 4. Visual acceptance still requires the user's desktop test; no browser automation performed.
