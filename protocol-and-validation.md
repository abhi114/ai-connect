# Shared protocol, flows, and validation

Status: proposed MVP, 23 October 2026. Companion documents: [overview](./README.md), [server](./backend/server-prd-architecture.md), [client](./frontend/client-prd-architecture.md).

## 1. Core objects

`Network` contains members and a catalog. `Member` has a stable ID and network-unique handle. `Device` is an authenticated client session owned by a member. `Repo` is an advertised local binding owned by one member. `Request` is a question or change request for one repo. `Event` records a state transition. `Lease` gives one owner device temporary execution authority. `Result` is a question answer or a change artifact description.

All externally visible IDs are opaque. Every request carries `network_id`, `repo_id`, `sender_member_id`, `owner_member_id`, and `kind`. Server time orders events; clients track a monotonically increasing cursor. Every mutation includes an idempotency key generated before first send and reused on retries.

## 2. Example wire messages

These are design contracts, not deployed endpoints. Exact field naming may change during implementation, but invariants must not.

```json
{
  "kind": "question",
  "repo_id": "rep_7c4...",
  "recipient_member_id": "mem_2a1...",
  "title": "Where is tax calculated?",
  "body": "Which part of checkout-api calculates tax before order submission?",
  "idempotency_key": "018f..."
}
```

```json
{
  "kind": "change",
  "repo_id": "rep_7c4...",
  "recipient_member_id": "mem_2a1...",
  "title": "Reject negative quantity",
  "body": "Add validation at the cart API boundary and tests for negative quantities.",
  "base_ref": "main",
  "idempotency_key": "0190..."
}
```

```json
{
  "request_id": "req_391...",
  "kind": "change_result",
  "base_commit": "40-character-or-64-character-object-id",
  "commit": "40-character-or-64-character-object-id",
  "branch": "network/req-391",
  "delivery": "local_branch",
  "diff_summary": "Validation and two tests added; 3 files changed.",
  "tests": [{"name":"unit","status":"passed"}],
  "owner_review_required": true
}
```

Use Git's object-format-aware validation for SHA-1 or SHA-256 repositories; the example placeholders are not literal valid hashes. For `pushed_branch`, the owner client verifies the remote advertises the exact commit before it reports that state. The server validates format and transition, but cannot independently prove a private remote's contents.

## 3. Important invariants

1. A repo ID names one owner and one network. Neither a peer nor an LLM can change its local path binding.
2. A question or change request may target only a currently exposed repo with that capability enabled.
3. A change cannot be claimed until the owner approves it. Revocation/pausing prevents new claims.
4. One live lease exists per request. A lease token from an earlier attempt cannot complete a later attempt.
5. A completed answer/result is immutable; corrections create a follow-up request or a new result version with explicit provenance.
6. A local branch is reported as local. A pushed branch is reported only after remote verification. Neither means merged.
7. The owner client independently verifies all server authorization and local policy before running Codex.
8. The relay never receives the owner's repository checkout, Git credentials, or Codex credentials.
9. Raw peer text is never evaluated as a shell command or used as an unvalidated filesystem path.
10. Reconnect and retry may repeat an event, but may not repeat the side effect of creating a request or starting a claimed job.

## 4. End-to-end sequences

### Question

```text
Bob/Codex → find_repos("tax checkout") → catalog candidates
Bob/Codex → ask_repo(repo_id, question) → server stores queued request
Alice client → receives/replays event → checks local binding and policy
Alice client → claims lease → codex exec read-only at recorded HEAD
Alice client → sends answer, source paths, base commit → server stores result
Bob/Codex or dashboard → reads result and timeline
```

### Change

```text
Bob/Codex → request_change(repo_id, goal) → approval_pending
Alice dashboard/CLI → approves exact request → queued
Alice client → claims lease → creates dedicated worktree and branch
Alice client → codex exec workspace-write in that worktree
Alice client → checks diff/tests → commits task branch
Alice client → reports local or verified pushed branch and commit
Bob sees result; Alice reviews/merges separately in Git workflow
```

## 5. Failure handling

| Failure | Required behavior |
|---|---|
| Server temporarily unreachable | Client queues unsent mutations with stable idempotency keys and reconnects; never assumes a timeout means rejection. |
| Recipient offline | Request remains durable; presence shows offline; no fake ETA. |
| Owner repo moved or deleted | Client reports `repo_unavailable`, pauses catalog listing, and cannot run. |
| Codex unavailable/signed out | Request remains blocked with owner-visible diagnostic; no fabricated answer. |
| Client crashes during work | Lease expires; local run record/worktree survives; restart reconciles before retrying. |
| Two devices claim | Server transaction grants one; loser observes current owner/lease expiry. |
| Approval arrives after cancellation | Conditional transition refuses it. |
| Push fails | Result is `local_branch`, never `pushed_branch`; owner can retry later. |
| Changed files exceed scope | Stop and require owner review; report no completed delivery. |
| Member/repo revoked | Server rejects future sends and client prevents new runs; active run is cancelled or held for owner review. |

## 6. Demo and release gates

### Gate 1: protocol with scripted workers

Run server on a cheap test VPS with TLS, one Mac client and one Windows client. Join by code, publish a toy repo, ask a question, and deliver a simulated response. Disconnect/reconnect Windows and prove durable replay. Race two worker processes and prove one lease winner. Restart the server and prove events survive.

### Gate 2: actual local Git and Codex

Bind a toy repository on the Mac. From Windows request a change. Approve on Mac. Verify a new worktree/branch is created, Codex changes only that worktree, the main checkout remains clean, and the reported commit exists. Repeat with the owner on Windows and requester on Mac. Reject a change and prove no Codex run starts.

### Gate 3: usability and operations

Use Codex MCP tools to discover a repo from a vague description, select the stable repo ID, send a request, and inspect its result. View the same timeline in CLI and dashboard. Restore the server database from backup. Revoke a member and verify their existing credential loses access. Confirm a server outage leaves local repos usable and queued requests recover afterward.

## 7. Cost-conscious deployment

One VPS process, SQLite on persistent disk, TLS reverse proxy, and daily backups are enough for the proposed small cohort. The expensive work—Codex inference and Git operations—happens on members' own machines and accounts. The backend does not need GPUs, a job runner, Git storage, Redis, or a vector database for MVP. Move to PostgreSQL and horizontal fan-out only after measured concurrency or reliability needs justify it.
