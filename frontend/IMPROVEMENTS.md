# Onboarding and distribution follow-ups

## Implemented

- Dashboard admin invite generation, copyable server/code/expiry, and new-user join.
- Membership-preserving Codex registration inspection and explicit same-profile repair.
- Longer bounded startup, no duplicate launch against a live owner, readiness after
  listeners are bound, and stop/start shutdown synchronization.
- Persisted idempotent enrollment recovery, per-repository queues, and local-only UI.

## Next priorities (not implemented)

1. Reproduce lifecycle tests on native Windows CI (named pipes, slow disk/antivirus,
   port conflicts, concurrent CLI/MCP startup, long paths, and stopping active workers).
   Capture the original failing Windows log before claiming its exact cause is fixed.
2. Signed Windows/macOS installer or small desktop/tray launcher: bundle a supported
   runtime, check Git/Codex prerequisites, use a stable install path, open the local
   dashboard, and optionally install a user-approved login service. The current
   browser dashboard can remain the main UI; a full desktop rewrite is unnecessary.
3. Signed release artifacts and safe auto-update/rollback: drain workers, back up
   profile/database, update compatible client/server protocol versions, then restart.
4. Stable hosted relay URL and invite links/deep links. Preview destination/network
   and require confirmation; do not send existing credentials to arbitrary URLs.
5. Invite revoke/list UI, richer device management, OS credential storage, and
   redacted diagnostics/support export. Current invites are admin-only and single-use.
6. Cross-process startup mutex with ownership metadata and an explicit stopping
   state; the current PID lock cannot reliably distinguish recycled PIDs. Avoid
   automatic lock deletion/force-killing unknown processes.
7. Better executable discovery and Codex login handoff on Windows without requiring
   RN_CODEX_BIN, plus fully tested config-preserving repairs across Codex versions.

Do not replace credentials or recreate memberships as an update strategy. Keep
CLI commands as a recovery path even after installers and dashboard onboarding.
