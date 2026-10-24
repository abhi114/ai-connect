# Local client: PRD and architecture

Status: proposed MVP, 23 October 2026. Companion documents: [overview](../README.md), [server](../backend/server-prd-architecture.md), [protocol](../protocol-and-validation.md).

## 1. Client form and objective

Build a cross-platform **local companion** for macOS and Windows. It runs as a background process, connects outbound to the hosted server, binds selected local Git repos, and starts owner-side Codex jobs. Three thin interfaces use the same local core:

- **Codex MCP server (stdio):** the primary interactive interface. Codex can list members/repos, ask questions, request changes, and inspect outcomes.
- **CLI:** setup, sign-in, repo publication, status, inbox, approval, service control, and diagnostics.
- **Local dashboard:** a browser UI served at `127.0.0.1` for people to see the network, repo catalog, inbox, approvals, progress, and results. It is a UI for the local companion, not a public website or server-side file browser.

This is one client project and one local policy/execution engine. Avoid a native Electron/Tauri wrapper in MVP; add one later only if installation or notifications justify it. The owner machine must be on and the companion running to answer or modify its repos. Offline requests stay queued on the server.

## 2. User stories and acceptance

| ID | User story | Acceptance |
|---|---|---|
| C1 | Join a private network | Paste code, choose unique handle, enroll this device, see member list. |
| C2 | Expose a repo | Select an existing Git checkout, publish name/description/capabilities; local path stays on this device. |
| C3 | See who and what is available | Dashboard and CLI show online/offline members, owner-qualified repo names, capability flags, and pending requests. |
| C4 | Ask a specific person | Codex can target `@handle/repo`, or find catalog candidates by context, then use the stable repo ID. |
| C5 | Answer a question | Owner-side Codex reads the bound repo in a read-only run; answer includes relevant paths, base commit, and uncertainty. |
| C6 | Request code changes | Owner sees scope and approves/rejects. Approved job runs in an isolated worktree/branch and returns a reviewable result. |
| C7 | Follow work | Sender and owner see queued/approval/running/result states and a stable request ID across reconnects. |
| C8 | Control exposure | Owner can pause a repo, revoke it, cancel a job, and stop the companion. Revocation blocks new work immediately. |

## 3. Local architecture

```text
 Codex ── stdio MCP shim ─┐
 CLI ─────────────────────┼── local companion API / domain core
 browser 127.0.0.1 ───────┘    ├── credential + repo binding store
                               ├── persistent outbound WSS client
                               ├── inbox and policy engine
                               ├── job runner / Codex adapter
                               └── Git worktree + result collector
```

The MCP shim should be short-lived and connect to the already-running companion over a local named pipe on Windows or Unix socket on macOS. If the companion is down, tools return a clear diagnostic rather than silently starting a worker. The dashboard talks only to the loopback listener and uses a local session token plus origin/CSRF checks; a remote web page must not be able to invoke it. One daemon owns the server connection and local jobs, preventing each Codex window from starting duplicate work.

Use TypeScript/Node.js for the client, matching server protocol schemas. Package a runtime or provide a clear Node prerequisite; support Git for Windows and system/installed Git on macOS. Invoke `git` and `codex` as executable plus argument array with a controlled working directory, never with shell-interpolated peer text. Normalize paths with the platform path library; do not transmit path strings to other members.

## 4. Codex integration contract

Register a local stdio MCP server in Codex with a `command` and `args` that launch the shim. The shim exposes small, typed tools:

| Tool | Result |
|---|---|
| `network_status` | Current network, signed-in handle, connectivity, pending count. |
| `list_members` | Stable IDs, unique handles, presence, public profile. |
| `find_repos` | Candidate repo IDs, `@owner/name`, descriptions and capabilities. |
| `ask_repo` | Create a question request with recipient and stable repo ID; return request ID. |
| `request_change` | Create a change request; return request ID and approval status. |
| `get_request` | State, event history, owner response/result, permitted links. |
| `list_my_requests` | Inbox and sent requests. |

The tools create and inspect coordination requests; they do not grant Codex direct remote filesystem access. For ambiguous natural-language repo references, `find_repos` returns candidates and Codex asks the human to choose if confidence is low. A request requires an explicit repo ID. Tool descriptions should clearly distinguish “ask a question” from “request a change that needs the owner's approval.”

Owner-side execution uses the installed Codex CLI in a child process. Official documentation supports `codex exec` for non-interactive runs and explicit sandbox settings. For questions, run against a pinned repo commit in read-only mode and capture a structured answer. For changes, create a worktree first, run `codex exec` with workspace-write restricted to that worktree, capture JSONL progress, then independently inspect Git status/diff/test output. The companion, not Codex's final prose, decides whether a branch and commit exist. Do not use unrestricted access flags. A failed or interrupted run remains visible and recoverable.

The background worker uses the owner's local Codex authentication; it never transfers that authentication to the server or requester. If Codex is absent or signed out, the job stays queued/blocked with a readable diagnostic. The interactive MCP path can still show messages and status.

## 5. Repository binding and discovery

The user selects an existing local Git checkout. The companion records `repo_id → canonical local path`, remote name, default branch, allowed question/change capability, and owner policy in a local database. It verifies the path still resolves to the same Git repository before every run. The server receives only a repo ID, owner, public slug, description, tags, capabilities, and availability.

Descriptions should explain purpose and vocabulary: e.g. `checkout-api: payments, carts, promo codes, order submission`. This permits catalog matching without uploading source code. Searching private code stays on the owner machine after a request is authorized. Repo references in requests use `@owner/slug` for readability and immutable `repo_id` for routing. Rename changes display text, not identity.

For v1, a repo needs no Git remote to answer questions. Change requests can run and create a local branch without a remote; the owner can inspect it locally. To let a different machine inspect the code, a configured Git remote accessible to the reviewer is required. The result explicitly distinguishes `local_branch` from `pushed_branch`; never imply that a local branch is fetchable. A remote push requires the owner to enable it for that repo and uses a new task branch, never the default branch. MVP should default to local branch only; adding a push step is a separate owner action or policy setting.

## 6. Local policy and execution workflow

1. Verify server message authenticity, sender membership, repo ID, current local binding, repo capability, and request state.
2. For questions, check the repo's question policy. For changes, ask owner approval with request title, requester, repo, intended scope, and expected write behavior.
3. Acquire a server lease and a local per-repo execution lock. Questions may run concurrently only if pinned to immutable commits; permit one change job per repo at a time in MVP.
4. For a question, record HEAD SHA and run Codex read-only. For a change, fetch the configured base if allowed, record base SHA, and create `network/<short-request-id>` worktree outside the main checkout.
5. Run Codex with a timeout and bounded output. Peer request text is untrusted task data; compose a fixed local instruction that limits work to the selected repo and approved scope. Do not pass peer-supplied shell commands to the runner.
6. Inspect changed files, path boundaries, diff size, test status, and Git status. Stop for owner review if the output exceeds approved scope, includes secret paths, or modifies the main checkout. Never merge automatically.
7. Commit only reviewed work on the task branch. If push is enabled, push that exact branch and verify the remote contains the commit. Send result metadata and summary to server. On failure, send a reason and preserve the worktree for owner inspection.
8. Release lease/lock. Keep a local recovery record for interrupted runs; only remove a worktree after the owner explicitly finishes or discards it.

An owner approval authorizes this request and repo only. It is not a blanket permission for later peers. The companion must enforce all local checks even if the server labels a request approved.

## 7. Dashboard screens and CLI surface

Dashboard routes: `/network` (members/presence), `/repos` (published/bound repos), `/inbox` (approvals and requests), `/requests/:id` (timeline, answer, diff summary, branch/commit, tests), `/settings` (device and repo policies). Show offline/paused/unavailable distinctly. The dashboard is served by the local companion and makes no direct browser connection to the hosted server.

CLI command shape (illustrative names, not implemented):

```text
rn join <code> --handle <name>
rn status
rn members
rn repos search <words>
rn repo expose <path> --name <slug> --description <text>
rn repo policy <slug> --questions ask|auto --changes approval
rn ask @owner/repo <question>
rn change @owner/repo <goal>
rn inbox
rn request show <id>
rn request approve|reject|cancel <id>
rn service start|stop|logs
rn doctor
```

The CLI talks to the daemon through the local socket. Sign-in/join may start the daemon after enrollment; one process owns reconnect and event cursor persistence.

## 8. Local storage and process boundaries

Local database: device/network IDs, event cursor, repo path bindings, policy, request cache, worktree/run records. Secrets: device refresh credential in OS credential store where available; fallback encrypted or restrictive-permission file with explicit user warning. Never store Codex auth in this app's database. Logs contain IDs, status, and errors, not full prompts by default. Provide a support export that removes paths and secrets.

On Windows, install as a per-user background process with a scheduled task at login for MVP. On macOS, use a per-user LaunchAgent. A foreground `rn service run` mode must remain available for debugging and development. Do not claim to support unattended work when the machine is asleep, offline, or Codex is signed out.

## 9. Suggested client project structure

```text
repo-network-client/
  package.json
  tsconfig.json
  src/
    daemon/main.ts                # single owner of network and jobs
    daemon/local-api.ts           # named pipe/Unix socket + loopback UI API
    daemon/connection.ts          # WSS reconnect, cursor replay, heartbeats
    daemon/inbox.ts               # request handling and idempotency
    daemon/policy.ts              # owner approval and repo capability checks
    daemon/catalog.ts             # local bindings and publication
    daemon/credentials.ts         # OS credential abstraction
    runner/codex.ts               # codex exec child process, JSONL capture
    runner/git.ts                 # worktree/branch/commit/remote checks
    runner/jobs.ts                # lock, lease, timeout, recovery
    mcp/main.ts                   # stdio MCP shim
    mcp/tools.ts                  # typed Codex tool definitions
    cli/main.ts                   # command parser
    cli/commands/{join,status,members,repos,requests,service,doctor}.ts
    ui/                         # small local browser app
      index.html
      src/{app,network,repos,inbox,request,settings}.tsx
    storage/{db,migrations}.ts
    protocol/{schemas,errors}.ts
  test/
    repo-binding.test.ts
    policy.test.ts
    mcp-tools.test.ts
    worktree.test.ts
    reconnect.test.ts
  packaging/{macos-launchagent,windows-task}/
  README.md
```

## 10. Client acceptance tests

Mac and Windows join and see each other; one device disconnects and presence expires; reconnect replays missed requests once; Codex can discover and target a repo by stable ID; questions cannot read an unexposed repo; a change request waits for owner approval; worktree branch starts at recorded base and main checkout remains unchanged; two owner devices do not both execute a request; a failed Codex run does not claim success; a pushed result names a remotely fetchable commit; pause/revoke blocks new runs; daemon restart resumes pending state without duplicate execution.

## 11. Implementation sequence

Build the local daemon, CLI, and server protocol first. Add the stdio MCP shim once the CLI completes the end-to-end flows. Add the localhost dashboard on the same local API after the state and approvals are stable. This preserves one source of truth and keeps the interface work from hiding protocol bugs.
