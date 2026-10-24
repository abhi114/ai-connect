# Hosted server: PRD and architecture

Status: proposed MVP, 23 October 2026. Companion documents: [overview](../README.md), [client](../frontend/client-prd-architecture.md), [protocol](../protocol-and-validation.md).

## 1. Purpose and success criteria

Operate a small, inexpensive coordination service for private networks of people and their local coding agents. It authenticates members, shows presence and advertised repositories, durably routes questions and change requests, and enforces the request lifecycle. It never executes Codex or Git and never stores a repository checkout.

The MVP succeeds when two users on different operating systems can join the same network, see unique handles and online state, discover a shared repo, complete a question while the recipient was initially offline, and complete a branch-based change request with a durable event history. A duplicate worker must not run the same job concurrently.

## 2. Actors and permissions

| Actor | Rights |
|---|---|
| Network creator/admin | Mint/revoke invitation codes; remove members; view network activity; cannot read a member's local files through the server. |
| Member | View network directory/catalog; ask an exposed repo's owner a question or request a change; view requests they sent/received. |
| Repo owner | Bind/unbind a local repo; publish metadata; set question/change policy; approve or reject incoming work. |
| Device/companion | Authenticate as a member device; maintain presence; claim and update work for locally bound repos. |

Handles are unique within a network, case-insensitively. A stable member ID is authoritative; a handle can change later without invalidating history. Repo names are unique per owner, not globally; show `@alice/checkout-api` in all requests and UI. Use a stable repo ID for all protocol messages.

## 3. Functional requirements

| ID | Requirement | Acceptance |
|---|---|---|
| S1 | Create and join a private network using a short invitation code | Code expires, can be redeemed once, is stored hashed, and is bound to the intended network. |
| S2 | Register member identity and device | Unique handle; device has an independent credential; server can revoke device without deleting member history. |
| S3 | Presence and directory | Online means at least one authenticated device heartbeat within 45 seconds; offline is displayed accurately after timeout. |
| S4 | Repo catalog | Owner publishes name, description, optional tags, capabilities, and availability. No local absolute path or credential is returned to peers. |
| S5 | Ask/question request | Sender chooses recipient and repo ID, or uses a catalog search result. Request is durable when recipient is offline. |
| S6 | Change request | Request has goal, constraints, optional base ref, and owner approval state. It cannot start before owner policy allows it. |
| S7 | Exclusive work lease | One recipient device claims a request at a time using a transaction and expiring lease; stale work is recoverable. |
| S8 | Event log and statuses | Request history is ordered, durable, queryable after reconnect, and idempotent on client retries. |
| S9 | Result delivery | Question result includes answer and source references. Change result includes diff summary, base/commit SHA, branch, tests, and verification status. |
| S10 | Access control | Every read and write checks network membership, repo visibility, sender/recipient relationship, and device identity. |
| S11 | Notifications | Connected devices receive WebSocket events; disconnected devices catch up by cursor on reconnect. |

## 4. Nonfunctional requirements and operating limits

- Deploy as one Node.js server behind a TLS reverse proxy on a small VPS. Use SQLite in WAL mode on a persistent volume. A single writer process is sufficient for the first network cohort; keep migrations and daily database backups. Do not put SQLite on an ephemeral container filesystem.
- Serve HTTPS API and WSS events on one public domain. The companion only makes outbound connections, so neither user's home router needs port forwarding.
- Target fewer than 100 members and fewer than 1,000 requests per day for the MVP. Treat these as design targets, not claimed benchmarks. Measure before scaling.
- Keep request bodies small (for example 32 KiB) and metadata-only. Do not accept Git packs, arbitrary files, credentials, full diffs, or unlimited logs. Redact secrets from logs. Retain audit events for a configurable period; document retention to users.
- A server restart must preserve all requests and statuses. WebSocket delivery is at least once; client event IDs and cursors make repeats harmless.
- Health checks, structured logs, and simple metrics expose active connections, queue depth, claim failures, request latency, and failed deliveries.

## 5. Trust and safety model

The network invitation proves permission to join, not permission to execute code. A member can only request work on explicitly exposed repos. Only the owner-side companion can bind a repo path and run Codex. The server cannot cause execution by itself: the local companion independently checks the authenticated sender, repo ID, local binding, capability, policy, and approval before a run.

Default policy: questions may run automatically only when the owner explicitly enables that capability for a repo; otherwise they wait for approval. Every change request requires owner approval in the MVP. A later per-member auto-approval policy is possible, but is out of scope. No automatic merge, push to protected branch, or arbitrary peer-provided command.

Server-side controls: TLS, passwordless device enrollment through a confirmed local login flow, short-lived access tokens plus rotating refresh tokens, hashed one-use invite codes, rate limits by member/network/IP, authorization on every endpoint and WebSocket subscription, idempotency keys, finite event size, and audit events for membership and policy changes. A device credential is stored in the OS credential store by the client where available. Do not make a short join code a long-lived API token.

The server can see request text, repo descriptions, answers, and summaries, so the UI must tell users that network members and the server operator can read their relevant messages. End-to-end encryption is a possible later feature, not an MVP claim.

## 6. Runtime components

```text
TLS reverse proxy
   └─ HTTP/WebSocket API (Fastify, TypeScript)
        ├─ authentication and network membership
        ├─ invitation and directory service
        ├─ repository catalog and search
        ├─ request state machine and authorization
        ├─ lease/heartbeat and event fan-out
        └─ SQLite WAL + backup job
```

Use server-side deterministic catalog search for MVP: normalized handles, repo names, descriptions, and tags. Return ranked candidates; the requesting Codex agent can reason over these results and confirm the chosen repo ID. Never let a model-generated name substitute for a stable repo ID in an execution request. Server-side embeddings or AI routing are unnecessary for this first version.

## 7. Data model

| Table | Core columns and constraints |
|---|---|
| `networks` | `id`, `name`, `creator_member_id`, `created_at` |
| `members` | `id`, `network_id`, `handle_normalized`, `display_name`, `role`, `joined_at`, `revoked_at`; unique `(network_id, handle_normalized)` |
| `devices` | `id`, `member_id`, `public_label`, `credential_hash`, `last_seen_at`, `revoked_at`; credential never returned again |
| `invites` | `id`, `network_id`, `code_hash`, `created_by`, `expires_at`, `redeemed_by`, `redeemed_at`; one redemption transaction |
| `repos` | `id`, `network_id`, `owner_member_id`, `slug`, `description`, `tags_json`, `questions_enabled`, `changes_enabled`, `visibility`, `published_at`, `revoked_at`; unique owner/slug |
| `requests` | `id`, `network_id`, `repo_id`, `sender_id`, `owner_id`, `kind`, `status`, `title`, `body`, `base_ref`, `created_at`, `updated_at`, `version` |
| `approvals` | `request_id`, `owner_id`, `decision`, `decided_at`, `scope_json`; one active decision |
| `leases` | `request_id`, `device_id`, `lease_token_hash`, `expires_at`, `heartbeat_at`, `attempt`; unique `request_id` |
| `events` | `id` (monotonic cursor), `network_id`, `request_id`, `actor_member_id`, `type`, `payload_json`, `created_at`, `idempotency_key`; unique actor/key |
| `results` | `request_id`, `kind`, `payload_json`, `created_at`; immutable after completion, supersede through a new request |

Store status and event append in one database transaction. Use optimistic `version` or conditional updates to reject stale transitions. An expired lease returns the request to `queued` or `approval_pending` according to its prior authorization state; a new worker receives a fresh attempt number. Late results from old lease tokens are rejected.

## 8. API and event surface

Version all routes under `/v1`. Responses carry stable IDs, server timestamps, and a machine-readable error code.

| Method/path | Purpose |
|---|---|
| `POST /v1/networks` | Create network and initial admin. |
| `POST /v1/networks/{id}/invites` | Admin mints one-use, expiring join code. |
| `POST /v1/join` | Redeem code, reserve unique handle, enroll device. |
| `GET /v1/me`, `GET /v1/members` | Identity, directory, presence. |
| `GET /v1/repos?query=`, `POST /v1/repos`, `PATCH /v1/repos/{id}` | Catalog search and owner-controlled publication. |
| `POST /v1/requests`, `GET /v1/requests`, `GET /v1/requests/{id}` | Create and inspect question/change request. |
| `POST /v1/requests/{id}/approve`, `/reject`, `/cancel` | Owner or sender decisions, checked against status. |
| `POST /v1/requests/{id}/claim`, `/heartbeat`, `/complete`, `/fail` | Owner device worker lease protocol. |
| `GET /v1/events?after={cursor}` | Reconnect/catch-up. |
| `GET /v1/stream?after={cursor}` | Authenticated WebSocket stream with ping/pong and cursor replay. |
| `GET /health/live`, `GET /health/ready` | Process and database checks. |

The server broadcasts metadata and state transitions only to authorized network members; request body/result visibility is limited to sender, owner, and network admins only if policy explicitly grants admin audit access. A repo catalog entry alone does not grant access to unrelated requests.

## 9. State machines

Question: `queued → claimed → running → answered` or `failed/cancelled`. If approval is required: `approval_pending → queued` after approval, or `rejected`.

Change: `approval_pending → queued → claimed → running → review_ready → accepted/closed`, with `rejected`, `cancelled`, and `failed` alternatives. `review_ready` means the owner-side companion has a branch and recorded diff/test result. It does not mean the code is merged. A requester can acknowledge receipt; only the owner decides whether to merge outside this system.

The server validates transitions, actor roles, request/repo IDs, lease ownership, and idempotency. All authoritative status changes create an event. Events are replayable and carry no executable instructions.

## 10. Suggested server project structure

```text
repo-network-server/
  package.json
  tsconfig.json
  migrations/
    001_initial.sql
  src/
    main.ts                 # startup and graceful shutdown
    config.ts               # validated environment settings
    http/app.ts             # Fastify composition, error envelope
    http/routes/{auth,networks,invites,members,repos,requests,events}.ts
    ws/stream.ts            # authenticated subscription and replay
    db/{connection,migrate,transactions}.ts
    domain/{identity,invite,presence,catalog,request-machine,lease}.ts
    services/{authz,rate-limit,event-publisher,backup-metadata}.ts
    protocol/{schemas,errors}.ts
    observability/{logger,metrics}.ts
  test/
    invite.test.ts
    authorization.test.ts
    claim-race.test.ts
    restart-replay.test.ts
    state-machine.test.ts
  deploy/
    Dockerfile
    compose.yaml
    reverse-proxy.example
    backup.example
  README.md
```

The server and client may share a versioned protocol package, but should remain separately deployable projects. Publish protocol schemas independently or copy generated types into both builds; never make the server import client runtime code.

## 11. Rollout and acceptance tests

Milestone A: invitations, directory, presence, catalog. Milestone B: durable questions and answer loop. Milestone C: approval and exclusive change jobs. Milestone D: TLS deployment, backup restore drill, Mac/Windows end-to-end test.

Required tests: expired/reused invite refused; duplicate handle refused; unexposed repo cannot be targeted; offline recipient catches up; two devices racing for a claim yield one winner; expired lease is safely reassigned; old worker cannot complete after reassignment; retry with same idempotency key produces one request; unauthorized member cannot read request contents; restart preserves queue/events; invalid state transition is refused; backup restores complete request history.
