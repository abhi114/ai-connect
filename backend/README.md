# Pantheon relay MVP

Runnable metadata-only coordination server using Node.js 24 native TypeScript, HTTP, and SQLite. No runtime packages are required. Repository files, absolute local bindings, Git credentials, and Codex credentials stay on the companion. Preserve `server-prd-architecture.md` as the design; this README describes the implementation.

```sh
cd backend
npm start
# Separate terminal:
npm test
# Optional static type check:
npm install
npm run check
```

Defaults: `HOST=127.0.0.1`, `PORT=8787`, `DATABASE_PATH=data/pantheon.sqlite`. Use Node 24 or newer. Startup creates the schema (version 1), WAL database, and directory. Graceful SIGINT/SIGTERM closes the server and database. No Git or Codex process runs on this server.

## Protocol

Use `Content-Type: application/json` on mutations and `Authorization: Bearer TOKEN` except enrollment. Every mutation requires an unpredictable `idempotency_key` of at least eight characters (UUID recommended). Reuse it with the identical payload after a transport failure; changed payload under the same key returns 409. Keys are scoped to device and include a method/path fingerprint. Enrollment keys are public-route scoped. Error envelope: `{ "error": { "code": "...", "message": "..." } }`. Times are epoch milliseconds. IDs are opaque.

| Route | Input and response |
| --- | --- |
| `POST /v1/networks` | `{name,handle,display_name?,device_label?,idempotency_key}` → `{token,member,device,network}` |
| `POST /v1/networks/:id/invites` | Admin; `{expires_in_seconds?,idempotency_key}` → `{id,code,expires_at}` |
| `POST /v1/join` | `{code,handle,display_name?,device_label?,idempotency_key}` → enrollment response |
| `GET /v1/me` | `{member,device,network}` |
| `POST /v1/devices` | Authenticated self-enrollment; `{device_label,idempotency_key}` → enrollment response |
| `POST /v1/presence` | `{idempotency_key}`; heartbeat at least every 30 seconds |
| `GET /v1/members` | `{members}`, with `online` from a non-revoked device heartbeat within 45 seconds |
| `GET /v1/messages?before=123&limit=50` | `{messages,next_before}`; latest page returned chronologically, exclusive integer `before`, limit 1–100 (default 50); use `next_before` for older history, null when exhausted |
| `POST /v1/messages` | `{body,idempotency_key}` → `{message}` (201); network-visible human message, nonempty body up to 8,000 characters |
| `POST /v1/{members,devices,invites}/:id/revoke` | Admin revokes member/invite; member revokes own device; `{idempotency_key}` |
| `GET /v1/repos?query=tax` | `{repos}`; deterministic token matching in name, description, tags, owner handle |
| `POST /v1/repos`, `PATCH /v1/repos/:id` | `{slug,description?,tags?,questions_enabled?,changes_enabled?,questions_require_approval?,availability?,idempotency_key}` → `{repo}`; PATCH fields optional |
| `POST /v1/requests` | `{repo_id,recipient_member_id?,kind,title,body,base_ref?,constraints?,idempotency_key}` → `{request}` |
| `GET /v1/requests?status=queued` | `{requests}` (latest 1,000 visible requests) |
| `GET /v1/requests/:id` | `{request,result,events}` |
| `POST /v1/requests/:id/approve`, `/reject`, `/cancel` | `{reason?,idempotency_key}` → `{request}` |
| `POST /v1/requests/:id/claim` | `{idempotency_key}` → `{request,lease_token,expires_at,attempt}` |
| `POST /v1/requests/:id/heartbeat` | `{lease_token,idempotency_key}` → `{request,expires_at,attempt}`; also moves claimed to running |
| `POST /v1/requests/:id/complete` | `{lease_token,result,idempotency_key}` → `{request,result}` |
| `POST /v1/requests/:id/fail` | `{lease_token,code,message,idempotency_key}` → `{request}` |
| `POST /v1/requests/:id/accept`, `/close` | `{idempotency_key}`; sender acknowledges receipt or owner closes review-ready change; neither merges code |
| `GET /v1/events?after=0` | `{events,cursor}`; up to 500 authorized events; keep fetching until empty |
| `GET /v1/stream?after=0` | Authenticated WebSocket upgrade, individual `{type:"event",event,cursor}` messages, ping/pong |
| `GET /v1/metrics` | Admin-only network queue depth |
| `GET /health/live`, `/health/ready` | Process/database health |

Types and constants live in `../shared/protocol.ts`; schemas in `../shared/schemas.json`. `constraints` is an array of strings. `slug` is owner-unique and lowercase. Capabilities default off, and enabled questions default to requiring approval; set `questions_require_approval:false` explicitly to automate questions. Every change requires approval. Empty descriptions may be omitted on creation. Pause a repo by setting `availability:"paused"`; its owner still sees it in the catalog to resume it. Pausing/capability removal cancels active runs server-side, and owner companions must observe cancellation and stop. Approval records freeze the original request text, constraints and base ref; requests cannot be edited after submission.

Leases last 120 seconds. Renew every 20–30 seconds with a new idempotency key per renewal. Expired work becomes queued on the next request or five-second sweep; reclaim produces a fresh token/attempt. A stale device cannot heartbeat or complete. This fences accepted results, not operating-system processes: the companion must stop promptly if renewal fails and reconcile local work before retry. Events are transactionally committed with changes; request events are visible only to sender and owner, never unrelated members or admins. General catalog/membership events are network-visible. Results cannot be overwritten. SHA-1 and SHA-256 object IDs are supported. `pushed_branch` requires the companion to assert remote verification; the relay cannot verify a private remote itself.

## Security and operational limits

General chat is explicitly visible to every active member of the same network, including new members viewing history. Each message contains `{id,network_id,sender_member_id,body,created_at}`; identity and network are inferred from the authenticated device, never accepted from the caller. A transaction adds the durable SQLite message and a `chat.message` event whose payload is `{message}`. Idempotent replay does not duplicate either. Request/result conversations remain sender-and-owner-only; general chat does not broaden their visibility or automatically publish worker output. New message tables are added non-destructively on backend startup; restart the backend to enable these routes. No automated AI execution is triggered by posting a general message.

This is a development MVP, not a finished public service. Device bearer credentials expire after 30 days and can be revoked; short-lived access tokens, rotating refresh credentials, account recovery, and confirmed-login device enrollment remain deferred. Invite codes contain 48 random bits, expire within seven days, are one-use, and are stored hashed. Device credentials and lease tokens are stored hashed. Idempotent response blobs are encrypted because retries need to recover enrollment/lease credentials; the encryption key resides in the same database, so the database and backups remain sensitive credential-bearing material. Restrict file access and encrypt disks/backups.

The relay limits JSON bodies to 32 KiB, rejects unknown mutation fields, and enforces participant/owner/admin boundaries. The public create-network endpoint has no signup allowlist yet. CORS is intentionally absent; a local companion proxies dashboard requests. Credentials must go in headers, not query strings. REST cursor polling is supported for clients without WebSocket header support. The small outbound-only WebSocket implementation supports ping/pong/close, rejects client data frames and closes slow consumers; it is not a general bidirectional RPC channel.

Rate limits use separate in-memory fixed 60-second windows:

- Authenticated HTTP requests and WebSocket upgrade attempts share **300 requests per member per minute**, across that member's devices. Successful authentication selects this budget instead of an IP budget. Users behind the same proxy or office router do not share it.
- Network creation, joining, and missing/invalid/expired/revoked credentials share **300 unauthenticated requests per socket-peer IP per minute**. Forwarded IP headers are ignored. Behind a hosting proxy, only this anonymous budget is shared; exhausting it does not block valid members.
- GET health checks are outside both budgets so hosting probes do not trigger or inherit user throttling. A rejected request returns HTTP 429 and a `Retry-After` header with seconds until its window resets, including rejected WebSocket handshakes.

The `createApp` options `rateLimit` and `unauthenticatedRateLimit` customize these budgets (the latter defaults to the former). Restarting the process resets counters. These are single-instance application limits, not network-level denial-of-service protection. A proxy/hosting edge should handle connection floods. Anonymous throttling does not claim to distinguish individual clients behind that proxy.

For example, ten companions each make six sync requests every three seconds:
120 requests per member per minute, or 1,200 total. This fits the separate member
budgets; the old shared proxy-IP budget incorrectly rejected traffic after 300.
Regression tests reproduce those 1,200 HTTP requests from one IP in one window.

Metadata and audit history are retained indefinitely in this MVP, including encrypted idempotency replies. Configurable retention, cleanup, per-network quotas, detailed latency/delivery metrics, database migration tooling beyond schema version 1, provider PRs, and a hosted dashboard remain deferred. Metadata descriptions and messages can contain secrets even when binary/source uploads are prohibited; users must avoid sharing them. The server operator can read relevant messages. No end-to-end encryption is claimed.

## Backup and deployment

```sh
# In backend/, produce a transactionally consistent SQLite snapshot:
node src/backup.ts /safe/backup/pantheon-2026-10-23.sqlite
# Restore while server is stopped by starting against a restored snapshot:
DATABASE_PATH=/safe/backup/pantheon-2026-10-23.sqlite npm start
# Optional local Docker deployment, run from project root:
docker compose -f backend/deploy/compose.yaml up --build
```

Schedule snapshots outside this process and protect them like credentials. Never copy only the database file while WAL writes are active. The test suite exercises the native SQLite backup API and restart/restore replay. Docker binds the published port to localhost with a persistent volume. Place TLS reverse proxy in front (Caddy example supplied); no deployment has been performed. A real Mac/Windows transport run and live Codex execution are release gates outside this server's tests.
