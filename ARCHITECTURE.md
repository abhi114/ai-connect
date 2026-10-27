# AIConnect — implementation architecture and maintainer guide

Snapshot: **26 October 2026**, **`6c06138`**. This is an implementation-oriented guide, not a production security assessment. Read with [feature inventory](FEATURE-INVENTORY.md), [conversation log](CHAT-HISTORY.md), and [signed-message details](SIGNED-MESSAGES.md).

## 1. System model

AIConnect has two independent execution environments: a small shared relay, and one local companion per user profile. The relay coordinates; the companion owns filesystem access and Codex execution.

```text
Owner's computer                                 Teammate's computer
Codex Desktop -- stdio MCP --+                    Codex Desktop / CLI / dashboard
CLI ------------------------+                                  |
localhost browser ----------+                                  v
                            v                              Companion
                       Companion                               |
                    Core / Store / Worker                       |
                      |             |                           |
                 Git worktrees   Codex CLI                      |
                            |                                   |
                            +----- outbound HTTPS --------------+
                                           |
                                        Relay
                           membership / repo catalog / requests
                             messages / leases / events / keys
                                           |
                                      SQLite + WAL
```

The browser talks only to its local companion. Participants do not need inbound public ports. The owner's machine must be awake and the companion available for remote execution. Local turns can be scheduled while relay connectivity is down, but model-provider connectivity/authentication remains independently necessary.

## 2. Repository, stack, and naming

One Git repository contains independently runnable components:

| Location | Responsibility |
| --- | --- |
| `backend/` | Node HTTP relay, SQLite storage, REST/event transport, deployment assets |
| `frontend/` | Local daemon, CLI, MCP adapter, browser UI, Git/Codex integration |
| `shared/` | Protocol types, schemas, canonical signing helpers |
| `SIGNED-MESSAGES.md` | Trust model, upgrade compatibility, cryptographic limitations |
| `backend/server-prd-architecture.md`, `frontend/client-prd-architecture.md` | Historical product/design specifications; may describe future behavior |
| `protocol-and-validation.md` | Earlier protocol/test plan; compare against live source |

Runtime is Node.js **24+**, directly executing TypeScript, with built-in APIs rather than runtime npm dependencies. Development dependencies include TypeScript and Node types. Backend uses native SQLite. Dashboard is generated HTML/CSS/JavaScript, not React/Electron. Existing package/profile names still include `pantheon`, `repo-network`, and `RN_*`; these are historical identifiers, not external product dependencies.

Keep all three directories when distributing source: imports such as `../../shared/signing.ts` cross component boundaries. Separate Git repositories would require a versioned shared package and compatibility discipline; that complexity was intentionally avoided.

## 3. Source map

### Local companion

| Module (`frontend/src/`) | Role |
| --- | --- |
| `cli.ts`, `brand.ts` | Command parsing, human-facing entry points/banner |
| `setup.ts`, `service.ts`, `integration.ts` | Setup, bounded lifecycle/readiness, own MCP registration and repair |
| `daemon.ts` | Single-profile ownership lock, local IPC HTTP, localhost UI/RPC, sync timer, shutdown |
| `ipc.ts` | CLI/MCP authenticated local RPC client |
| `core.ts` | Dispatch, authorization-sensitive operations, sync, model selection, component orchestration |
| `store.ts` | Profile persistence, local bindings/runs/settings/chat records and IPC location |
| `remote.ts` | HTTPS bearer transport, key registration, durable outbox, mutation idempotency |
| `worker.ts` | Shared repo scheduler, remote lease/execution/review/delivery, recovery state |
| `policy.ts` | Local approval and repository capability enforcement |
| `git.ts` | Canonical repo identity, worktree creation, Git safety and diff inspection |
| `codex.ts`, `process.ts` | Remote-task trusted prompt, subprocess handling and result parsing |
| `models.ts` | Read-only app-server catalog discovery, supported-effort validation, execution flags |
| `trust.ts` | Local identity/pins, signing, signature/trust verification |
| `mcp.ts`, `mcp-view.ts` | Stdio network tools, concise views and bounded result waiting |
| `dashboard.ts`, `workspace-layout.ts`, `home-model.ts` | Network UI, navigation/layout and Home classification |
| `onboarding.ts`, `folder-picker.ts` | Settings/onboarding UI, native folder chooser |
| `server-switch.ts` | Temporary membership-preserving tunnel URL change |
| `local-chats.ts` | Private chat persistence, local work/review, linked request lifecycle |
| `local-codex.ts` | Local-turn prompt/context construction contract and Codex invocation |
| `local-dashboard.ts` | My agent view and explicit delegation/review controls |

### Relay and shared contracts

`backend/src/server.ts` handles HTTP/WebSocket routing, identity/role checks, mutation validation, request lifecycle, events and signatures. `db.ts` owns schema/storage; `config.ts` configuration; `main.ts` startup/shutdown; `backup.ts` consistent backups. `shared/protocol.ts` defines wire statuses/entities, `signing.ts` canonical envelope/payload functions, and `schemas.json` documents schemas. Runtime handlers remain authoritative; TypeScript types alone do not validate incoming JSON.

## 4. Storage and privacy boundaries

| Data | Stored where | Who can receive it |
| --- | --- | --- |
| Git source and task worktrees | Owner machine | Codex execution can read allowed worktree; not automatically uploaded to relay |
| Repository catalog | Relay + local cache | Same-network members |
| Local absolute repo paths/bindings | Owner profile | Local dashboard/process only |
| General messages | Relay + UI caches | Active network members, including later joiners |
| Remote request/result/event | Relay + participant profiles | Request sender and owner; not unrelated members/admins |
| Local chat transcript/links | Owner profile | Local UI/runner; no private-chat network MCP API |
| Explicit delegation brief | Relay | Target request participants |
| Device private signing key/bearer/session token | Local profile | Must not appear in normal snapshots/MCP responses |
| Device public keys | Relay + local trust cache | Network identity verification |
| Codex authentication | Managed separately by Codex CLI | Not copied to relay |
| Backend database/backups | Relay host | Operator access; sensitive, not a public artifact |

“Metadata-only relay” means it is not a repository-file host. Messages, model answers and diff summaries can still contain source snippets or secrets; relay can read them because E2EE is absent. “Private local chat” does not mean offline inference: its selected context is sent through the local Codex CLI to the configured model service.

Default local profile is `~/.repo-network`, overridable by `RN_HOME`. It contains `state.json`, companion bookkeeping/dashboard URL, and retained worktrees. State includes identity/token, server, bindings, cached network records, run records, approvals/execution choices, outbox, trust/signing keys, and optional `local_chats`. The optional field preserves compatibility with existing profiles. Do not share profiles between people.

Default backend is `127.0.0.1:8787`, database `backend/data/pantheon.sqlite` unless configured. Default dashboard is `127.0.0.1:4319` (`RN_PORT` override). `RN_CODEX_BIN` selects the Codex executable when PATH discovery is insufficient.

## 5. Interfaces and transport

### Local interface

CLI and MCP use HTTP RPC over a Unix-domain socket on macOS/Linux or a Windows named pipe. Browser uses loopback HTTP RPC with a local session bearer token. Dashboard entry URL carries the token in its fragment, not a relay credential. Daemon enforces Host/Origin restrictions, session-token comparison, JSON request bounds and CSP. Treat the dashboard URL/profile as sensitive; local malware with user-level access is outside this isolation boundary.

Daemon sync is scheduled every three seconds; dashboard polls every five seconds. Backend offers WebSocket event streaming, but current companion synchronization uses REST polling. Do not describe current behavior as a fully streaming WebSocket chat engine.

### MCP surface

Tools: `network_status`, `list_members`, `find_repos`, `ask_repo`, `request_change`, `get_request`, `wait_for_result`, `list_my_requests`.

They resolve explicit targets, submit asynchronous work and return concise previews. Detailed retrieval remains available. Waiting is bounded: timeout is not completion, and owner approval/review may require leaving the wait. MCP cannot approve requests, change trust, operate private local chats, or bypass filesystem policy. The calling Codex agent chooses question/change according to user intent; the relay does not infer permission from arbitrary prose.

### Relay interface

REST under `/v1`: network/create/join/invites; membership/devices/presence/keys; repos; messages; requests and lifecycle actions; events/stream; admin metrics. Health endpoints `/health/live` and `/health/ready` are unauthenticated probes. See [backend README](backend/README.md) for the route table, supplemented by `/v1/keys` signing support in source and [SIGNED-MESSAGES.md](SIGNED-MESSAGES.md).

Bearer credentials identify devices/members. Mutation idempotency keys must be retained for retry; identical retry returns the original result, conflicting reuse is rejected. Errors use an error envelope. HTTPS is required except loopback; client rejects redirects. Server JSON body cap is 32 KiB.

## 6. Remote request execution

1. Sender resolves target owner/repo and selects question or change.
2. Companion signs routing/content and persists the operation in its outbox before transport.
3. Relay validates identity, capability, signature and idempotency; stores immutable task content.
4. Questions enter approval-pending or queue per repo policy; changes require approval.
5. Owner verifies signature/trust and local binding. Explicit approval binds task content and model/effort, not an open-ended permission for future text.
6. Scheduler waits for the canonical repository lane, claims a lease, and creates a worktree.
7. Codex runs in read-only or workspace-write mode under separate trusted instructions and restricted network access.
8. Question returns answer/source references. A change stops at local diff review; owner delivery commits on the isolated branch and builds the result.
9. Result is signed against the original request and delivered with a stable retry key. Recipient verifies it; acceptance/closure acknowledges workflow, not a Git merge.

Relay statuses include `approval_pending`, `queued`, `claimed`, `running`, `answered`, `review_ready`, `accepted`, `closed`, `rejected`, `cancelled`, `failed`. Local runs additionally use `claiming`, `awaiting_review`, `delivery_pending`, `delivery_failed`, `complete`, `interrupted`. Never assume a local label is a relay status.

Leases last 120 seconds; renewals preserve authority. Expiry/reclaim uses new tokens/attempts so stale completion is rejected. The companion must abort on lost authority. This fences accepted results, not physical CPU execution. Delivery retry must never rerun Codex. A result's structured test field may say skipped even when the model summary reports tests: the companion has no separately trusted configured test runner.

## 7. Local project conversations and cross-repo links

### Persistent records

`LocalChat` stores ID, binding ID, title, creation time, turns, links, worktree, branch, initial base, current head and archived flag. `LocalTurn` stores ID, text, kind, creation time, execution selection, answer and optional delegation proposals. A normal run record points back through `local_chat_id`. `LocalLink` stores the signed request ID, target repo, kind, exact brief, cached response and error.

### Turn lifecycle

Private attachment validates an absolute local Git path and canonical identity without publishing it. On the first turn, a persistent isolated branch/worktree is created. Subsequent turns verify original binding, canonical worktree/common Git directory, branch and HEAD; externally changed identity/head or dirty worktree is held for inspection.

Each turn constructs JSON with current owner message, prior answered conversation, verified linked results, exposed-repo directory, and worktree metadata. `codex exec --ephemeral` receives fresh trusted instructions and selected sandbox/model every time. The application replays conversation; it does not use native session resume and cannot preserve native tool-call history. Input above 180,000 bytes fails explicitly. Runner timeout is twenty minutes, subprocess output cap four million bytes.

Read-only dirty worktrees fail inspection. Edit turns with changes enter `awaiting_review`, retaining the repo lane. Review rechecks identity/diff, commits locally and advances chat HEAD. No merge or push. Closing retains the worktree and cancels queued/review-held turns; active work must stop first. Restart marks active local turns interrupted but preserves local review-pending state. Interrupted chats do not auto-continue.

### Cross-repo example

```text
My agent: local demo-frontend chat
  -> owner reviews “What is your checkout API schema?”
  -> signed request targets @nabhi/demo-backend
  -> target owner's ordinary approval/queue/Codex/result flow
  -> result linked back into demo-frontend chat
  -> owner sends “Use that schema to update this client”
  -> new local edit turn runs against demo-frontend worktree
```

Only the reviewed brief leaves the chat—not transcript, local path or a server-visible origin-chat record. The link is saved before durable send with a stable signed ID. Pending links are polled in rotating batches of up to eight. On context construction, request identity/content/signature and result signature/current trust are checked again. Invalid/blocked results must not become model context. Even verified peer text remains untrusted data.

Agent proposals cannot send themselves. Remote workers cannot recursively delegate. Arriving replies do not automatically start a paid turn or hold a repository lane while waiting. This deliberately avoids cross-repo deadlock and silent disclosure/authorization chains.

## 8. Unified queue and concurrency

`Worker` computes lanes from canonical Git common-directory identity, falling back to binding path/ID only when needed; Windows paths are normalized case-insensitively. Different aliases/worktrees of the same Git repository share a lane.

Remote eligible requests and the earliest queued turn of each eligible local chat compete by creation time. Active/claiming/running/review-held/delivery-pending runs block that lane. Other repositories can proceed. Unapproved remote work does not block approved eligible work. This is a per-companion guarantee, not a global distributed lock against independent OS processes or separate profiles checking out the same files.

There is no promise of unlimited safe parallelism: independent repos can consume CPU/model quota concurrently. Global concurrency/resource quotas are not a delivered feature.

## 9. Security model and limitations

Ed25519 envelopes bind domain/version, message ID/type, network/member/device/key/time and canonical payload. Request signatures bind routing and content; result signatures bind original request digest and result. Relay verification is repeated locally against pinned keys. First observed device uses TOFU; changed/additional device keys need explicit confirmation. Local block/revocation state prevents execution; old unsigned history remains readable but cannot run on upgraded companions.

Trusted policy is passed separately as developer instructions; peer request JSON and repository content cannot authorize changes to that policy. Workers disable inherited configuration/rules and network access using current CLI flags. Compatibility with installed Codex versions must be tested; merely having a binary named `codex` is insufficient.

Remaining limits: no E2EE, key transparency, independently authenticated first roster, OS keychain storage, fully signed administrative state transitions, or automated lost-key recovery. Relay controls availability/status metadata and can withhold roster updates. A signed malicious instruction is still malicious. Worktrees do not replace sandboxes/review. Sensitive text may leak if the owner approves a brief containing it.

Backend credentials expire after thirty days; invite codes are hashed, one-use and expire within seven days. Bearer/lease tokens are hashed; idempotency responses need recoverable encrypted blobs, with their encryption key in the same database. Protect database and backups as credentials; this is not protection from the database operator.

## 10. Operations, updating, and recovery

### Routine source update

Finish/review active work first. From `frontend/`: stop service, pull the whole repo with `git pull --ff-only`, start service, refresh browser. Use `npm.cmd` on Windows. Do not run setup/join again or copy profiles as an upgrade strategy. MCP re-registration is needed only if its installation path/config changes, not each ordinary code pull.

Restart relay when backend changes; retain its existing database. Restart companion when its source changes. Tunnel only needs restarting if disconnected or its forwarding configuration changes. Local-chat release `6c06138` required companion restart only. Browser refresh alone cannot reload an old daemon's imported modules.

### Connectivity troubleshooting

- “Endpoint not found”: verify the relay version and requested route, not merely that a process is running.
- “fetch failed”: inspect backend reachability, tunnel, configured URL and local logs; do not assume a signature problem.
- `spawn codex ENOENT`: fix executable discovery/`RN_CODEX_BIN` and CLI installation; Desktop and CLI roles are distinct.
- First startup may bind local listeners before remote connection succeeds; local readiness is not relay readiness.
- Key mismatch: preserve profile, compare fingerprints and inspect server identity; never silently replace a key.
- Interrupted work: inspect retained worktree/run record before issuing a new task. Do not force-delete locks or kill unknown PIDs.

### Hosting/backup

Use a single relay instance with persistent disk and TLS reverse proxy/tunnel. SQLite WAL is not a drop-in horizontally replicated database. `backend/src/backup.ts` uses the consistent backup API; avoid copying only the DB file during active WAL writes. Restore while stopped, preserve permissions, and protect snapshots. Templates in `backend/deploy/` are not evidence of a current hosted deployment.

Rate limits are in-memory per sixty-second window: default 300 authenticated requests per member across devices and 300 anonymous requests per socket-peer IP. Forwarded IP headers are not trusted. Health probes bypass budgets; 429 includes retry guidance. Process restart resets counters; these are not network-level DDoS protection.

## 11. Packaging direction — proposal, not current behavior

For macOS, prefer a guided installer with the current dashboard. Install a pinned private Node runtime and frontend/shared release in a stable per-user directory, with stable CLI/MCP wrappers and versioned releases. Reuse compatible Git/Codex CLI or guide installation and browser sign-in. Codex model authentication and project-specific build tools cannot be magically bundled as AIConnect credentials.

Optional launchd user service would own companion lifecycle/start-at-login. Integrate service commands and MCP startup with that owner to prevent duplicate daemons. Use explicit environment/paths, signed release verification, graceful drain, protected backup, atomic updates and rollback. Keep `~/.repo-network` membership/history/keys by default on upgrade/uninstall. A small menu-bar shell could follow later; an Electron/Tauri rewrite is not required for the first installer.

## 12. Validation and handoff checklist

### Interactive chat implementation added after the baseline

`process.ts` incrementally decodes stdout JSONL using UTF-8-safe buffering and an
optional event sink. `activity.ts` projects supported public events into capped
local run activity; it discards reasoning, raw command text/output and tool payloads.
Both local and network runners use this sink. The relay/result signature contract
is unchanged: activity stays in local runs, not signed remote results. Public notes
are untrusted model prose; pattern redaction is defense in depth, not secret-proofing.

`chat-interactions.ts` renders expandable activity, draft-only next actions and the
workspace review dialog. `local-codex.ts` optionally returns validated `next_steps`
alongside the answer/delegation proposals. Suggestions confer no authorization.

`workspace-review.ts` validates a run's managed local worktree and canonical Git
identity, enumerates scoped changes, and disables Git external diff/textconv for
previews. File selection uses literal pathspecs, not shell interpolation. Folder
reveal rejects traversal/protected paths/symlinks and opens only a directory using
argument-array process calls. The `diff` RPC now returns file/context metadata in
addition to its compatible `diff` field; `workspace_reveal` is local RPC only, not
an MCP tool. A comparison is against the recorded turn base and current worktree,
not an immutable historical per-turn file snapshot. Later edits can appear in it.

At baseline frontend tests: 65 pass, one live-Codex test skipped. Type-check passed. Coverage includes real temporary relay/Git flows, signing/tampering/trust, queue aliases/concurrency, approval, transport retries, model catalog substitutes, lifecycle, local persistence/review and linked context. UI preview uses mock agents. Historical user-confirmed remote Mac/Windows operation does not certify latest local-runner behavior.

Before changing a subsystem:

1. Read this guide and component source; check Git status and preserve unrelated edits.
2. Preserve shared protocol/signature compatibility; never change canonical signing payload casually.
3. Add tests for happy path, denial path, restart, ambiguous network delivery and duplicate action.
4. Keep private local history outside relay/MCP responses and treat linked results as untrusted.
5. Keep one canonical repo lane across local/remote execution and review/delivery holds.
6. Do not claim live model tests when using substitutes; record OS/CLI version for real runs.
7. Document migration, backup, restart and rollback requirements; keep credentials/data out of Git.
8. Update these three handoff files when product behavior or decisions change.

Open follow-ups include installer/updater, native Windows lifecycle CI, retention, credential recovery/storage, E2EE, stable hosting and deletion of temporary URL-switch UI. See [FEATURE-INVENTORY.md](FEATURE-INVENTORY.md) for status and [frontend/IMPROVEMENTS.md](frontend/IMPROVEMENTS.md) for concrete removal targets.

## Local routine scheduling

`frontend/src/routines.ts` owns validated schedules and persisted `State.routines`; `routines-dashboard.ts` supplies the sidebar panel/editor. Local authenticated RPC exposes list/save/toggle/remove/run; these controls are not exposed through MCP or the relay. Core sync ticks the scheduler even without network enrollment, then dispatches through the existing local worker queue. Save validates configured model/effort; later account availability changes can fail execution and appear in the linked chat.

The scheduler advances and saves next_at before enqueueing a fresh read-only LocalChat turn. This favors no duplicate scheduled execution over automatic replay after crashes. Reservations and failures are recorded; manual Run now is available after inspection. Active-turn tracking plus recovery from saved chat turns prevents overlap after an interrupted pointer save. UTC-minute scanning uses Intl named timezones; nonexistent DST times are skipped and daily advancement avoids the ordinary repeated-hour duplicate. First missed due occurrence older than 12 hours is skipped. State is local per profile, not relay-synced. History stores up to 30 entries, while chats/worktrees remain retained. Pausing/deleting schedules does not cancel work already queued. No new edit authority or outbound-message authority is granted.

## Native macOS notification client (2026-10-26)

`frontend/native/macos/main.swift` implements an AppKit accessory app with NSStatusItem and UserNotifications categories. `mac-menubar.ts` compiles it and generates a per-profile bundle identifier/Info.plist; `cli.ts` exposes menubar build/install. It reads the local dashboard endpoint/session token and polls `notification_status` every four seconds. The compact participant-only projection in `notifications.ts` excludes full bodies, paths and keys. The helper fetches full request content only for an action confirmation; `notification_action` revalidates availability and delegates to existing approve/reject/cancel logic. Approval uses explicit empty execution options (Codex defaults) and existing signature checks. Bounded notification fingerprints persist in per-profile macOS preferences, baseline old history, and coalesce state changes. No relay or MCP protocol changes. See frontend/MAC-NOTIFICATIONS.md for deployment and manual QA limitations.

## Hosted testing relay (27 October 2026)

The relay now runs on VPS 162.35.104.181 behind Caddy at `https://aiconnect.162-35-104-181.sslip.io`; Node listens only on 127.0.0.1:8787. Systemd executes as a dedicated unprivileged user, code is versioned under /opt/aiconnect and persistent SQLite is under /var/lib/aiconnect. Daily consistent snapshots are under /var/backups/aiconnect. Only SSH and HTTP/HTTPS are allowed inbound. TLS terminates at Caddy; sslip.io supplies temporary third-party DNS. This changes deployment, not application authorization or local execution. Membership/history migration was checksum/integrity/auth verified. No E2EE or production signup hardening was added. See backend/deploy/vps/README.md for cutover, recovery and verification limits.
