# AIConnect local companion

Runnable MVP for Node.js **24 or newer**, macOS and Windows. No npm runtime dependencies or build step. Git must be installed; answering real requests additionally requires an installed, signed-in Codex CLI. Windows paths and named pipes are implemented, but this implementation has only been tested on macOS.

The companion is the single local process for the CLI, Codex stdio MCP shim, and localhost dashboard. It polls the authenticated relay every three seconds, replays the durable event cursor, and retains outgoing request mutations with their original idempotency keys when connectivity fails. The relay's WebSocket stream is not used yet.

## Start and join

### Per-repository request queue

Within one companion, different repositories can run workers concurrently, but
each underlying Git repository runs only one request at a time, across all
senders. Approved/otherwise authorized queued requests run oldest-created first
(request ID breaks timestamp ties). Unapproved requests do not block eligible work.
Aliases of the same folder and linked worktrees sharing a Git common directory
use the same queue. This applies to both questions and changes.

A change awaiting owner review, or a result awaiting delivery, keeps its queue
occupied. Review and deliver or cancel the current request before the next one
starts. After cancellation/authority loss, the runner must actually exit before
another request starts. Other repositories remain independent. Waiting requests
retain their existing `Queued` dashboard status and are not claimed early.

This is a local companion rule, not a cross-process filesystem lock: do not run
multiple independent AIConnect profiles against the same local repository.

### Connect Codex desktop

From this folder run `npm run cli -- setup`. It checks Node, Git and Codex,
starts or reuses the companion, registers `aiconnect` using `codex mcp add`,
and exercises the real stdio handshake, tool discovery and `network_status`.
An existing registration with different settings is preserved; choose another
`--name` if needed. Repeating setup with matching settings is safe.

For a new network with a running backend:

```sh
npm run cli -- setup --team "Demo team" --handle alice --server http://127.0.0.1:8787
```

The equivalent entry points are `sh ./setup.sh` on macOS/Linux and
`powershell -NoProfile -File ./setup.ps1` on Windows, followed by the same flags.
These use this checkout; they do not download an installer or install Node/Git/Codex.
Keep the checkout and Node executable at their registered locations. Rerun with
a new server name or remove the old registration if you move them.

In Codex desktop, open Settings > MCP servers and restart `aiconnect`, then
open a new chat. Ask: "Use AIConnect to list members and find repositories."
Once you have exposed a repo and a teammate has joined, ask: "Ask alice about
tax calculation in checkout-api." Codex resolves the repo and submits the request;
use its returned request ID to retrieve the answer. Asynchronous completion does
not automatically wake an idle desktop chat. The owner approves changes and
reviews/delivers them in the CLI or dashboard.

`npm run cli -- codex check` independently verifies the MCP process and companion.
It reports relay connectivity separately from MCP health. Setup without `--team`
or `--invite` leaves an unenrolled profile; enroll using the commands below.
The daemon starts automatically when Codex launches this MCP server, including
after reboot. It keeps running after that chat exits; `service stop` stops it,
but another MCP launch starts it again. There is no login service installer yet.

Codex account sign-in is separate: use `codex login` on each owner's machine.
The relay never needs that account's credentials. On Windows, if `codex` is only
an npm `.cmd` wrapper, set `RN_CODEX_BIN` to the actual Codex `.exe` before starting
the daemon; the worker uses shell-free process execution.

`npm run cli -- connect` shows the AIConnect ASCII banner, starts the companion
if needed, and prints its current connection/identity. The dashboard uses the
same product name with a live connection indicator. Human banners go to stderr;
MCP stdout contains only JSON-RPC messages.

Start the backend first using its README, then open a terminal in `frontend/`:

```sh
npm run cli -- service run
```

Keep that terminal running; in a second terminal:

```sh
npm run cli -- create "My team" --handle alice --server http://127.0.0.1:8787
npm run cli -- invite
npm run cli -- repo expose /absolute/path/to/repo --name checkout-api --description "Carts, tax and checkout" --questions ask --changes
npm run cli -- status
npm run cli -- dashboard
```

The last command prints the authenticated dashboard URL. Open it in your browser. The token is carried in a fragment and stored in that tab's session storage; do not share the URL or local daemon log. The dashboard shows members, catalog, requests, approval controls, timelines, and local diff review. Publication and policy scope configuration use the CLI.

On a teammate's machine, start their companion and join:

```sh
npm run cli -- join INVITE_CODE --handle bob --server https://your-relay.example
npm run cli -- repos search checkout
npm run cli -- ask @alice/checkout-api "Where is tax calculated?"
npm run cli -- change @alice/checkout-api "Reject negative quantities and add a regression test"
npm run cli -- inbox
```

Use HTTPS for remote servers; HTTP is accepted only for loopback development. No deployment or remote publication is performed by these commands beyond the explicitly selected relay.

For two local profiles, set `RN_HOME` and use distinct `RN_PORT` values. These variables must be present in **every** CLI/MCP invocation for that profile. POSIX example: `RN_HOME=/tmp/rn-alice RN_PORT=4319 npm run cli -- service run`. PowerShell: `$env:RN_HOME='C:\Users\you\rn-alice'; $env:RN_PORT='4319'`. Run each profile in its own terminal.

## Dashboard workspace and general chat

The local dashboard organizes shared repositories as projects, with network
members nested under each project. Select a person to see the requests and agent
replies involving you and that person for the project. Selecting a person does
not change repository ownership: work always executes on the selected repository
owner's computer after their local approval.

The network view combines general messages with request activity visible to you.
Filters distinguish Everything, Directed to me, and Sent by me. General messages
are visible to every current member of the network; request bodies, results, and
approval controls remain restricted to their existing participants. The dashboard
does not reveal other members' private requests, even to the network admin.
General messages do not automatically invoke an AI worker. A question or change
request explicitly targets a repository and uses the normal approval workflow.

Use **Add project** to choose a local repository with the native macOS or Windows
folder dialog, or enter its absolute path manually. This opens the folder picker
on the companion's computer, not on a remote peer. Selecting a folder does not
publish it: review its name, question policy, and change permission, then confirm
sharing. The Git repository must already have a commit. Repository source files
are not uploaded. Browser file uploads cannot reliably reveal an absolute local
folder path, so a native picker is used instead of pretending a dropped file is
a repository binding. Unsupported or headless systems can use the path field.

The new general-chat routes require an updated backend. After upgrading, restart
the backend in its existing terminal (same database path), restart each updated
companion when idle, and reload the dashboard. You do not need to restart a healthy
Cloudflare tunnel. Keep existing profile files and membership credentials.
Copy updated frontend/shared code to Windows as well; never copy your Mac profile
or backend database to another person. Native Windows picker behavior has automated
mock coverage but still needs a real Windows desktop check.

## Owner policy and review

### Per-request model and reasoning

On an incoming request's approval panel, click **Refresh available models**.
The companion queries the owner's authenticated Codex CLI using the read-only
app-server `model/list` API (including pagination). No inference or new Codex
chat is started. Select a model, then one of its supported reasoning efforts,
and approve. The catalog is account/client-specific, not a guarantee of remaining
quota. Discovery errors are shown; no hard-coded model list is substituted.

The selection is stored locally with the exact request approval, copied to the
run record, and displayed in the owner's dashboard. It cannot be edited after
a run starts. It is not a sender-controlled setting and is not sent to the relay
or the other person's dashboard. Existing approvals remain compatible. Questions
configured for automatic approval use default execution; use `--questions ask`
if you want to choose settings for every question.

**Codex default (isolated worker)** means no explicit model/effort overrides.
The worker still ignores user config for isolation, so this does not inherit
the selected desktop chat model or custom config defaults. Explicit selections
use `--model` and `-c model_reasoning_effort=...` without relaxing sandbox rules.
If execution fails, there is no automatic retry with a different model.

CLI equivalents (replace the model and effort using your catalog):

```sh
npm run cli -- models
npm run cli -- request approve REQUEST_ID --model MODEL_FROM_CATALOG --effort SUPPORTED_EFFORT
```

Restart the local companion after updating these files, when no workers are
running or awaiting review, and reload the dashboard. Windows owners must also
copy the updated frontend source files and restart their companion; Windows
senders can keep using the existing protocol without updating the relay.

Reference: https://learn.chatgpt.com/docs/app-server#list-models-modellist

Question policy defaults to `ask`. Use `--questions auto` only for repositories and network peers you trust. Changes always require local approval of the exact sender, repo, title, body, constraints and base reference, even when another device approved the server-side request.

```sh
npm run cli -- request show REQUEST_ID
npm run cli -- request approve REQUEST_ID
npm run cli -- request reject REQUEST_ID
npm run cli -- repo policy REPO_ID --paths src,test --questions ask --changes true
npm run cli -- repo policy REPO_ID --paused true
```

The worker records the current HEAD and makes a separate Git worktree for every request. Questions use `read-only`; changes use `workspace-write` with network disabled and noninteractive approval set to `never`. Peer text is sent on stdin, not evaluated by a shell. The owner-selected repo binding is never supplied by a peer.

For changes, the worker checks modified paths and diff size, then waits in local `awaiting_review`. The server remains `running` while the daemon renews the lease. Inspect the actual diff and worktree before delivering:

```sh
npm run cli -- request diff REQUEST_ID
npm run cli -- request show REQUEST_ID
# Inspect the shown local worktree and run the tests you trust.
npm run cli -- request deliver REQUEST_ID
```

`deliver` explicitly authorizes committing the worktree's current changes. It validates paths again, checks the original task branch/base, creates a commit with a local companion identity, and reports its verified branch and object ID. No merge or push occurs. `local_branch` cannot be fetched from another machine. Test status is conservatively `skipped`: Codex's prose is not treated as independently verified test evidence. The sender may acknowledge the result with `request accept`; the owner may close it with `request close`.

`request cancel` stops an active local process and asks the relay to cancel the request. A lost lease, revoked membership, changed policy, or unavailable connection stops active work. Worktrees are retained for inspection. After a daemon crash, unfinished local records become `interrupted`; execution is **never automatically retried**. Inspect the recorded worktree, then cancel/create a new request if needed. A locally completed result awaiting delivery retries the same result and idempotency key. A rejected delivery remains visible as `delivery_failed`.

## Codex MCP

The shim implements newline-delimited JSON-RPC stdio, the MCP initialize handshake,
workflow instructions, and eight typed tools. It starts the companion if needed;
the companion owns workers. Setup registers absolute paths automatically. The
manual equivalent is:

```toml
[mcp_servers.aiconnect]
command = "node"
args = ["/absolute/path/to/pantheon/frontend/src/mcp.ts"]

[mcp_servers.aiconnect.env]
RN_HOME = "/absolute/path/to/your/profile"
```

Omit `RN_HOME` to use the default `.repo-network` folder in your user profile. The tools are `network_status`, `list_members`, `find_repos`, `ask_repo`, `request_change`, `get_request`, `wait_for_result`, and `list_my_requests`. Approval, filesystem binding and delivery are deliberately available only through the owner CLI/dashboard.

MCP responses are concise views; the CLI and dashboard still receive their full
existing records. No message, result, timeline, or local worker detail is deleted.

- Lists return 10 summaries by default. Use `limit` (1–25) and `offset`; follow
  `next_offset` when present. Request lists show the newest first and reflect the
  companion's cached request window, not an unlimited historical archive.
- Sending a request returns its ID and state, without echoing the message body.
  An offline submission instead returns `pending` and an `operation_id`; it does
  not yet have a server request ID and must not be resubmitted just to get one.
- `get_request` returns status and an answer/summary preview (up to 2,000
  characters and five source references). Truncation is explicitly marked.
  Use `get_request` with `detail:true` for the full request and answer, all sources,
  diff summary, test details, and a timeline page. Timeline pages contain 20 event
  headers; supply `event_offset` using the returned `timeline.next_offset`.
  Repeated event payloads and internal lease credentials/worktree paths are not
  sent to the model. The dashboard retains its full event payloads and local data.
- `wait_for_result` takes `request_id` and optional `seconds` (1–25; default 20).
  It checks internally every three seconds and returns a single response. It
  returns early on completion, failure, cancellation, or required owner action.
  A timeout is labeled `wait_status:timeout` and never implies completion.
  This is ordinary program polling, not repeated LLM turns. The wait can be
  cancelled through MCP and does not block ping or other tool calls. Cancelling
  a wait does not cancel the actual repository job.

Example tool arguments:

```json
{"request_id":"REQUEST_ID","seconds":20}
```

Use those with `wait_for_result`; if the result is truncated, call `get_request`
with `{"request_id":"REQUEST_ID","detail":true}`. Restart AIConnect's MCP
server in Codex settings after upgrading so the eight-tool catalog is refreshed.

Codex integration follows [official MCP configuration](https://learn.chatgpt.com/docs/extend/mcp#stdio-servers) and [noninteractive execution](https://learn.chatgpt.com/docs/non-interactive-mode). The worker flags were also checked against the installed CLI's `codex exec --help`. Older Codex releases that lack these flags will fail visibly; they will not silently fall back to unrestricted execution.

## Storage, diagnostics and limits

- `RN_HOME/state.json` stores credentials, repo bindings, exact approvals, outgoing mutations, event cursor and run recovery records. It is atomically replaced with mode `0600`; the profile directory is created with mode `0700`. Windows relies on the user directory's ACLs. OS keychain integration is deferred, so protect this directory and its backups.
- The local API uses a Unix socket on macOS or named pipe on Windows and a per-profile random token. The dashboard binds only `127.0.0.1`, validates Host/Origin, requires the token for every RPC and serves a restrictive CSP. Local clients with access to your user account can still control your companion.
- `service start` launches a detached per-user process; `service stop` stops it. `service run` is the supported foreground/debugging mode. Startup-at-login installers, service supervisors, rotation, auto-updates and packaged Node runtimes are deferred.
- `doctor` checks Node, Git, Codex and relay connectivity. Authentication errors from Codex remain local; the relay receives a generic failure and no raw Codex transcript or local path. `RN_CODEX_BIN` can select an owner-controlled executable path.
- The current worker always uses the bound checkout's HEAD; requested non-default base references are rejected. Fetch, push, PR creation, merge, remote test runners, test-result verification, secret scanning and automated worktree cleanup are deferred.
- Codex's standard read-only/workspace-write sandbox is **not a claim of strict read confinement to one repository**. Approvals, scope checks and prompts do not fully defend against malicious repository instructions or adversarial peers. Use this MVP only with trusted network members and repositories; stronger OS-level read isolation and malicious-repo testing are release gates.

## Tests

```sh
npm test
```

The regular suite starts an actual temporary relay and Git repositories, using a
scripted worker. It covers requests, worktrees, approval, delivery (including the
AI change summary), recovery and localhost security. A separate subprocess test
checks MCP startup, tool discovery and reconnection.

Live Codex question and change execution passed on macOS on 23 October 2026.
Repeat explicitly with `RN_LIVE_CODEX=1 node --test test/live.test.ts` (PowerShell:
`$env:RN_LIVE_CODEX='1'; node --test test/live.test.ts`). This uses your signed-in
Codex account and consumes usage. The temporary worktrees are retained for review.
Real Windows execution and hosted deployment remain untested.

## Activity dashboard

The dashboard shows companion/relay connectivity, incoming request senders,
active local workers with their repositories, and request/reply conversations.
Select a request to read the peer's original message and the AI answer. Local
answers awaiting owner review are labeled as not delivered. Delivered changes
include the AI summary, branch location and test status. Members online are
network presence, not direct socket connections. Only request messages and final
AI responses are recorded here; it is not a live token stream or terminal log.
