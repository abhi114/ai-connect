# AIConnect — feature inventory and roadmap

Snapshot: **26 October 2026**, source baseline **`6c06138`**. This describes implementation, not a promise of production readiness. See [conversation log](CHAT-HISTORY.md) for rationale and [architecture](ARCHITECTURE.md) for mechanics.

## 1. Product definition

AIConnect connects people's local coding agents through a shared relay. People expose selected Git repositories, ask their owners' agents questions, request reviewed changes, and work with their own agent in private local project chats. Code executes on the repository owner's computer, not on the relay.

It is **not** a Git hosting service, remote shell, shared Codex Desktop transcript, or fully autonomous network-wide coding agent.

## 2. Implemented capabilities

| Area | Current behavior | Important boundary |
| --- | --- | --- |
| Network creation/join | Create network; join with one-use expiring invite; unique handles; member/admin roles | One enrolled network per profile; not a multi-account workspace switcher |
| Dashboard onboarding | Admin generates invites; new profile joins; existing identity retained on repairs | Browser dashboard requires a running local companion |
| Presence | Member online status from relay heartbeats | Online does not prove Codex login, available quota, or idle repo |
| Local client | CLI, browser dashboard, stdio MCP over one companion | Not a packaged native app or managed OS service yet |
| Codex setup | Register/check/repair AIConnect's own MCP entry with consent | Does not replace unrelated MCP config or sign into Codex automatically |
| Repo sharing | Expose named repo, description/tags, question/change capability, availability | Source isn't cloned/uploaded by exposure; metadata is network-visible |
| Folder selection | Native macOS/Windows folder picker with absolute-path fallback | Pick a local Git repo with a committed base; no claimed universal browser drag/drop path support |
| Private attachment | Attach local Git folder only for My agent | Attachment does not expose it to teammates |
| Discovery | Catalog search/name/owner resolution | Deterministic metadata matching, not relay-side semantic source indexing |
| General messages | Signed network-wide human chat with history | Visible to active members including new members; does not launch AI |
| Remote questions | Signed asynchronous read-only repo analysis and sourced answer | Repo off/ask/auto policy and trust checks apply |
| Remote changes | Approve scope/model, run isolated worktree, review diff, commit/deliver | No automatic push, merge, or hosted PR |
| Model/effort | Local Codex catalog discovery and validated per-request selection | Catalog visibility isn't a guarantee of quota/access at execution time |
| Automatic questions | Per-repo ask/auto controls and stored model/effort defaults | Changes stay approval-gated; existing pending requests stay pending |
| Repository scheduling | Shared local/remote FIFO eligibility, canonical Git-dir lanes | One active task per repo including aliases; independent repos concurrent |
| Review holds | Unreviewed edits and pending remote delivery hold a repo lane | Idle chats and awaiting linked replies do not reserve execution capacity |
| Persistence | Profile state, outbox, approvals, runs, bindings, trust, local chats | Local file storage is sensitive and not an encrypted vault |
| Retry behavior | Durable outgoing writes and stable idempotency/signature IDs | Retry transport, not arbitrary agent execution; permanent rejection is distinct |
| Lease handling | Claim, heartbeat, expiry, fenced result acceptance | Lease cannot forcibly kill an OS process; companion must stop it |
| Home | Latest activity, approvals/reviews, working/queued/waiting, today's changes, issues | No invented goals/calendar/task-management subsystem |
| Network UI | Project/person navigation, chat history, filters, request detail and signatures | Participant-only requests remain private even in “Everything” |
| Layout | Warm light palette, sidebar tabs/collapse, compact chat chrome, Settings view | Local browser UI, not a hosted web dashboard |
| Concise MCP | Eight network tools, bounded wait, paginated/short previews, detailed fetch | Full dashboard detail retained; no private chat or approval tools in MCP |
| Signatures | Ed25519 requests, messages, results; client and server verification | Authenticity/integrity, not E2EE |
| Trust | First-use pins, fingerprint confirm, local blocking, changed/new device hold | First contact depends on relay roster; compare fingerprints independently |
| Prompt separation | Trusted worker policy separate from peer message JSON | Defense in depth, not immunity to malicious input |
| Isolation | Worktrees, sandbox modes, network disabled for workers, diff/path checks | External programs are outside queue; review remains necessary |
| Operations | Health routes, SQLite backup helper, deployment templates, rate budgets | Single-instance development MVP; no production audit/SLA |
| Development URL switch | Settings validates new origin and continuity before reconnect | Temporary; explicit removal planned below |

## 3. Persistent local chats: exactly what shipped

### Owner experience

1. Open **My agent**, select an attached repository, name a chat.
2. Send a **Discuss / read only** turn or explicitly authorize **Edit isolated worktree**.
3. Select a model/effort for the turn, or use Codex defaults.
4. The chat keeps its isolated branch/worktree and owner/assistant transcript across turns and restarts.
5. Edits wait for review. Inspect the diff and commit on that branch; no automatic integration into the original checkout.
6. Close a chat to retain its files but stop future queued work. Interrupted work requires inspection; it is not silently re-executed.

### Cross-repository experience

Click **Ask another repo…**, or review an agent-generated proposal. Choose the exact owner/repo, request kind, and text. Only that task brief is submitted. Existing remote approvals/trust apply. The result is linked back to the originating chat and verified again before being used as untrusted context on a later turn. The owner sends the next local message to continue; there is no automatic continuation or onward remote delegation.

### Persistence limits

- Application-managed replay of saved conversation, not native Codex session resume or tool-call history.
- 180 KB serialized context limit; explicit error instead of silent history truncation.
- Answer limit 24,000 characters, maximum five proposed delegations per response, local prompt/brief limit 16,000 characters, up to twenty queued turns per chat.
- Private means not published to teammates/relay. The local Codex process still uses its model provider for inference.
- The local project must exist on this machine. Merely seeing a remote catalog entry does not provide a local checkout.
- Closed/interrupted worktrees are retained; there is no automatic cleanup/merge workflow.

## 4. Planned / discussed, not implemented

| Item | Intent / value | Status and design caution |
| --- | --- | --- |
| Minimal macOS installer | One guided setup, bundled private Node, stable launcher paths | Researched; no shipped installer |
| User login service | Optional launchd-managed companion; no routine service commands | Proposed; must avoid duplicate CLI/MCP daemons and preserve pause/stop intent |
| Release/update pipeline | Signed artifacts, compatibility checks, drain workers, atomic update/rollback | Proposed; migrations and backup/recovery require design |
| Small menu-bar launcher | Open dashboard, pause/resume, update, quit | Later option, not prerequisite; full desktop rewrite not selected |
| Better Windows distribution | Stable runtime/executable discovery and native lifecycle CI | Current Windows support exists, installation polish remains |
| Stable hosted relay | Eliminate temporary tunnel URL changes | Deployment destination not finalized here; persistent SQLite disk required |
| Invite links/deep links | Easier sharing and guided join | Invite codes/dashboard join exist; deep links and richer invite-management UI deferred |
| E2EE | Hide message/result content from relay operator | Explicitly deferred; must design key distribution/recovery, not just add encryption calls |
| OS credential storage | Keychain/Windows protected storage | Deferred; profile currently stores sensitive material |
| Stronger enrollment trust | Independently verified first contact/key transparency | Deferred; TOFU is not independent identity assurance |
| Device recovery/rotation UX | Safe lost-device/key replacement flows | Deferred; never fix by silently generating/replacing keys |
| Auth hardening | Short-lived access/refresh rotation, account recovery, controlled signup | Deferred; existing bearer lifetime is finite |
| Retention/quotas/observability | Bounded history, operational metrics, support exports | Basic metrics exist; richer management and redacted export deferred |
| Better lifecycle lock | Cross-process ownership metadata/recycled PID handling | Current bounded startup improvements are not a complete process-manager solution |

## 5. Explicit removal, rejected assumptions, and non-goals

### Remove after local development

The user corrected “disable” to **remove completely** for temporary server switching. Remove `frontend/src/server-switch.ts`, its test, `change_server` coordination, Settings controls in `onboarding.ts`, and corresponding documentation once stable hosting replaces tunnels. See [frontend/IMPROVEMENTS.md](frontend/IMPROVEMENTS.md) for identifiers. Preserve memberships/keys through the migration.

### Not part of the current plan

- Do not copy Pantheon wholesale or claim its internal security guarantees.
- No relay-hosted Git source, server-side AI workers, arbitrary peer shell commands, or credential sharing.
- No auto-merge, auto-push, automatic GitHub PRs, or automatic recursive cross-repo delegation.
- No universal general AI chat silently working across every repository. General network messages remain human communication.
- No access to the user's existing Codex Desktop conversation; no claim that local chats reproduce all native Codex chat behavior.
- Calendar, goals, nudges, and unrelated reference-image features were not requested for implementation.

## 6. Validation status

At the baseline commit: frontend suite **66 tests: 65 pass, 1 skipped live-Codex test**, plus successful TypeScript check. Local-chat tests use temporary Git repositories, deterministic agent substitutes, and a real test relay. UI was checked with isolated synthetic profiles, not user credentials.

The user previously demonstrated Mac/Windows remote question/change flows and reported model catalog/selection working. That is not equivalent to live validation of the newest local-chat runner on Windows. Before calling the new flow release-ready, test local follow-up context, model flags, edit/review, cross-repo reply verification, same-repo serialization, restart persistence, offline recovery, and both operating systems.

## 7. Maintenance rule

For each change update its status here, architecture implications, tests actually run, and any migration/restart requirements. “Implemented”, “tested with mocks”, “tested live”, and “proposed” must remain separate claims. Do not convert a user suggestion into a shipped capability without evidence.
