# AIConnect: architecture and implementation

Status: initial runnable MVP, 23 October 2026. The architecture below also records proposed features that are not yet implemented; see the component READMEs for current behavior.

## Implementation status

Codex desktop setup is available in `frontend/`: `npm run cli -- setup`
registers the `aiconnect` MCP server and checks the real protocol connection.
`npm run cli -- connect` shows the AIConnect banner and companion status.
The companion starts when Codex launches the MCP server. See the frontend
README for network enrollment, repository exposure and owner review.

An initial runnable implementation now lives in [backend](./backend/README.md) and [frontend](./frontend/README.md), with shared wire types in [shared/protocol.ts](./shared/protocol.ts). The design sections below record the intended product; the component READMEs describe what the code currently does and its known limits. Use Node.js 24 or newer.

For a local smoke test, start the relay with `cd backend && npm start`, then in another terminal use `cd frontend && npm run cli -- setup`. The frontend README has the create/join/repo/request commands. `npm test` in each component runs its integration suite. Live Codex read and isolated edit tests passed on macOS; deployment and real Windows execution remain untested.

## Product in one sentence

People join a private network, advertise selected local Git repositories, and ask named members' Codex agents questions or request changes. The repository owner's machine performs the work and returns a traceable result.

## Chosen shape

```text
 Codex chat ── stdio MCP ─┐
 CLI ─────────────────────┼── local companion (Mac or Windows)
 localhost dashboard ─────┘       │ Git + Codex CLI + local policy
                                  │ outbound HTTPS/WSS
                                  ▼
                     small hosted coordination server
                     memberships, catalog, jobs, events
                                  ▲
                                  │ outbound HTTPS/WSS
                     teammate's local companion
                                  │
                          teammate's Git repo
```

The client is a local companion service, exposed through a CLI, a localhost browser dashboard, and an MCP server for Codex. This is the best first client form: one cross-platform codebase can access local repositories, run Codex, and show a useful UI. A pure web app cannot safely operate a user's local Git checkout. A native desktop shell adds packaging and update work without adding a core capability. The hosted web UI is deferred; the localhost dashboard is the frontend.

The server is a relay and state store, **not a Git host**. “Attach a repo” means registering its name, owner, description, capabilities, and local binding. Source files, repository credentials, and Codex authentication never go to the coordination server. A change executes on the owner's machine in a fresh branch/worktree; the result names the commit and, when configured, the Git remote branch. A later Git-hosting option would be a separate product decision.

## MVP user journey

1. Alice creates a network and receives a short, single-use invitation code.
2. Bob joins, chooses a unique handle such as `@bob`, and sees Alice online.
3. Alice exposes `checkout-api`, with a plain-language description and `questions` and `change requests` enabled.
4. Bob asks `@alice` a question about `checkout-api`, or describes a symptom and selects from the matching repos. The request waits when Alice is offline.
5. Alice's companion receives the request, checks its local repo binding and policy, and runs Codex locally. For a question, it sends back a cited answer with file references and base commit. For a change, Alice approves the requested scope, then Codex edits a dedicated worktree. The companion returns a diff summary, test result, branch, and commit. Alice's main checkout is untouched; nothing merges automatically.
6. Bob can follow status in Codex, the CLI, or the dashboard. Alice can reject, cancel, or review a requested change.

## Product boundaries

MVP includes: one network per user initially, join code, unique handles, live presence, owner-published repo catalog, explicit question/change modes, asynchronous delivery, approvals, Codex execution on the owner host, worktree isolation, audit events, and a dashboard.

MVP excludes: cloning or storing full repositories on the relay, arbitrary remote shell, automatic merge, GitHub PR creation, cross-repo code search on the server, multiple owners for one repo, mobile apps, and server-side LLM calls. “PR” in the UI means a change request until a Git provider integration is added; the MVP returns a reviewable Git branch/commit, not a hosted pull request.

## Documents

- [Server PRD and architecture](./backend/server-prd-architecture.md)
- [Client PRD and architecture](./frontend/client-prd-architecture.md)
- [Shared protocol and test plan](./protocol-and-validation.md)

## Codex basis

Official OpenAI documentation describes local stdio MCP servers as a supported Codex integration, and `codex exec` as the non-interactive CLI path with explicit sandbox settings. This design uses MCP for the interactive Codex chat and `codex exec` for owner-side background work. Verify exact CLI flags against the installed Codex version when implementing.

- [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp#stdio-servers)
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
