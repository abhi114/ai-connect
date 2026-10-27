# AIConnect VPS setup and operations record

Deployment date: **27 October 2026**. This document records the completed initial
deployment and its decisions. It is reconstructed from the deployment record and
checked-in configuration, not a verbatim shell transcript or a fresh server audit.
Commands under Operations are for future use; they are not all commands run during
this documentation update. No credentials or private keys belong in this file.

## 1. What is hosted

| Item | Value |
| --- | --- |
| Provider / purpose | InterServer VPS; small-team testing relay |
| Public IPv4 | `162.35.104.181` |
| OS observed during deployment | Ubuntu 26.04.1 LTS, x86_64 |
| Resources observed | Approximately 1.6 GiB usable RAM, 1 GB swap, 38 GB disk |
| Public base URL | `https://aiconnect.162-35-104-181.sslip.io` |
| Readiness URL | `https://aiconnect.162-35-104-181.sslip.io/health/ready` |
| Relay runtime | Node.js 24.22.1 |
| Reverse proxy / HTTPS | Caddy 2.11.7 |
| Persistence | SQLite on the VPS filesystem |
| Process manager | systemd |

The VPS runs only the relay, HTTPS proxy and database backup job. It does **not**
run the browser dashboard, Codex, users' repository workers or their local project
chats. A request cannot execute on a user's computer while its companion is off.
The root URL may return 404: this is an API, not a public website.

## 2. Architecture and exposed ports

```text
Mac / Windows browser dashboard or Codex MCP
                  |
          local AIConnect companion
          local profile, keys, repos,
          approvals, queue and Codex workers
                  |
             HTTPS / WSS :443
                  |
       sslip.io hostname -> 162.35.104.181
                  |
            Caddy reverse proxy
                  |
         HTTP to 127.0.0.1:8787
                  |
        Node relay (user: aiconnect)
                  |
     /var/lib/aiconnect/pantheon.sqlite
                  |
        daily SQLite backup API
                  |
          /var/backups/aiconnect/
```

| Port | Binding / exposure | Purpose |
| --- | --- | --- |
| TCP 22 | Public; permitted by UFW | SSH administration |
| TCP 80 | Public; permitted by UFW | Caddy HTTP redirect and certificate-related HTTP traffic |
| TCP 443 | Public; permitted by UFW | HTTPS API and secure WebSocket traffic |
| TCP 8787 | VPS loopback only | Node relay, reachable through Caddy rather than directly |
| TCP 2019 | VPS loopback only | Caddy administrative API |
| Client port 4319 | Local companion on each client, not exposed on VPS | Dashboard/local RPC |

UFW allows TCP 22/80/443 for IPv4 and IPv6 and denies other unsolicited incoming
traffic. UDP 443 was not opened; HTTP/3 is not a requirement of this deployment.
An allowed IPv6 firewall rule does not itself establish a public IPv6 endpoint.

HTTPS encrypts transport between the client and Caddy. Caddy terminates TLS and
forwards over loopback HTTP. **This is not end-to-end message encryption.** Existing
AIConnect signatures and trust controls remain application-level protections;
they do not make message contents unreadable to the relay operator.

## 3. Initial deployment, step by step

### Step 1 — Establish SSH key access

The user configured a dedicated SSH key and verified noninteractive access:

```sh
ssh -i ~/.ssh/aiconnect_vps -o IdentitiesOnly=yes -o BatchMode=yes root@162.35.104.181 'whoami; cat /etc/os-release'
```

The result identified `root` and Ubuntu. Subsequent deployment used this SSH
connection, not the already-open Terminal UI. The key remains on the Mac; it was
not copied to the server or committed. Host-key checking was not disabled.
Root/password login settings were **not** changed during this deployment.

### Step 2 — Inspect the host and source

Checked host architecture/resources and the application's runtime needs. The
backend uses Node's built-in SQLite and TypeScript execution and has no production
npm dependencies to install. Backend/shared source matched Git commit `01ac56b`.
The local relay was not listening on port 8787 when migration was performed.

### Step 3 — Download and install Node

Downloaded the official Linux x64 release from:

`https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz`

Verified the archive against Node's HTTPS-published checksum list:

`https://nodejs.org/dist/v24.22.1/SHASUMS256.txt`

Archive SHA-256:

```text
6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
```

Installed under `/opt/node-v24.22.1-linux-x64`, with `/usr/local/bin/node` pointing
to its executable. This was checksum verification, not a claim of separate GPG
verification. The explicit runtime avoids relying on an older OS Node package.

### Step 4 — Install Caddy and choose a hostname

Installed Caddy 2.11.7 using its official stable Cloudsmith APT repository
(`https://dl.cloudsmith.io/public/caddy/stable/`), following the official package
installation instructions. The repository signing-key/source configuration lets
APT manage the package. An older distribution Caddy package was not selected.

Because no domain had been purchased, used the IP-based hostname
`aiconnect.162-35-104-181.sslip.io`. sslip.io resolves the embedded IP, so no
Cloudflare tunnel or personal DNS-zone configuration was required. This is a
third-party DNS dependency, not a domain we own or a permanent DNS guarantee.

Installed this configuration at `/etc/caddy/Caddyfile`:

```caddyfile
aiconnect.162-35-104-181.sslip.io {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8787
}
```

The previous config was saved as `/etc/caddy/Caddyfile.pre-aiconnect`. Caddy manages
public TLS certificates and renewal. Public HTTPS was verified without disabling
certificate validation; HTTP redirected to HTTPS.

### Step 5 — Create an isolated service identity and directories

Created the system account `aiconnect`, with home `/var/lib/aiconnect` and login
shell `/usr/sbin/nologin`. Application execution is not performed as SSH root.

| Path | Role |
| --- | --- |
| `/opt/aiconnect/releases/20261027-initial` | Initial uploaded code release |
| `/opt/aiconnect/current` | Symlink to active release |
| `/var/lib/aiconnect` | Private live database directory, mode 0700 |
| `/var/lib/aiconnect/pantheon.sqlite` | Live database, owner aiconnect, mode 0600 |
| `/var/backups/aiconnect` | Private backup directory, mode 0700 |
| `/root/backend-release.tgz` | Retained uploaded code staging archive |
| `/root/pantheon.sqlite` | Retained migration snapshot; sensitive |

Uploaded a release archive containing backend source/package metadata, shared
code and VPS deployment files. No frontend runtime, node_modules, client profile,
Codex credentials or signing private keys were deployed. GitHub auto-deployment
was not configured. A Git push alone does not update the VPS.

### Step 6 — Back up and migrate the existing database

Source on the Mac:

`/Users/abhisheknigam/Desktop/projects/frontend-backend/backend/data/pantheon.sqlite`

Used the existing `backend/src/backup.ts` SQLite backup API to produce a consistent
snapshot, including committed WAL contents. Did not copy a live `.sqlite` file
alone and hope its WAL was unnecessary. Preserved the original database.

Local migration artifacts were stored in:

`backups/vps-migration-20261027/`

The folder is Git-ignored and private (0700 directory / 0600 files). Uploaded the
snapshot over SSH and compared its checksum before starting the VPS backend:

```text
e977973a4b8d643aa0ed91d987de3f69b4c102ecf1cf7d65b00a5a97ccc4b26e
```

Installed it as the live database with the service ownership/permissions above.
SQLite `quick_check` returned `ok`. Preserved counts were:

| Record type | At migration |
| --- | ---: |
| Networks | 1 |
| Members / devices | 2 / 2 |
| Repositories | 1 |
| Requests / results | 7 / 6 |
| General network messages | 0 |
| Device public keys / signed records | 2 / 4 |
| Events | 36 |

These are historical verification counts, not today's expected totals. Database
copies contain sensitive membership/authentication material and message history;
keep them private even though client signing private keys are not in them.

### Step 7 — Install the relay systemd service

Installed and enabled `aiconnect.service` from
[`backend/deploy/vps/aiconnect.service`](backend/deploy/vps/aiconnect.service).

Important settings:

- Runs as `aiconnect:aiconnect`, working directory `/opt/aiconnect/current/backend`.
- `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=8787`.
- `DATABASE_PATH=/var/lib/aiconnect/pantheon.sqlite`.
- Executes `/usr/local/bin/node /opt/aiconnect/current/backend/src/main.ts`.
- Restarts on failure after three seconds, allows 30 seconds for shutdown.
- `UMask=0077`, `NoNewPrivileges`, private temporary directory, protected home,
  strict read-only system view and writable `/var/lib/aiconnect` only.
- No capability grants; permitted address families are UNIX, IPv4 and IPv6.

Enabled Caddy and the relay at boot. This removes the need for an open SSH terminal
or a separate process manager such as PM2. No Docker layer was introduced.

### Step 8 — Configure firewall and verify service access

Permitted SSH before enabling UFW, then allowed TCP 80 and 443. Confirmed SSH still
worked. Verified the relay bound to loopback and public requests passed via Caddy.
No dashboard, database port or Node port was opened to the internet.

### Step 9 — Install consistent daily backups

Installed `aiconnect-backup.service` and `aiconnect-backup.timer`. The service runs
[`backup.ts`](backend/deploy/vps/backup.ts) as the unprivileged service user and uses
Node's SQLite backup API. It refuses a missing source, creates a timestamped fresh
file and applies mode 0600.

Schedule: **03:00 UTC / 08:30 IST daily**, with up to five minutes of randomized
delay. `Persistent=true` lets systemd catch up a missed timer after downtime.
A manual run successfully created:

`/var/backups/aiconnect/pantheon-2026-10-27T05-57-42.858Z.sqlite`

There is no automatic deletion/retention policy or off-server replication yet.
These backups protect against some application mistakes, **not loss of the VPS**.

### Step 10 — Verify continuity and hand over client cutover

Verified public readiness returned HTTP 200 with `{"ok":true}`, HTTP redirected
with 308, and unauthenticated `/v1/me` returned 401. Using the existing Mac credential
without printing it, verified the same member/network/device identity, own signing
public key and all seven cached request IDs. No new membership or keypair was made.

A backend service restart was tested successfully. All 17 backend tests passed
locally. The VPS was **not** rebooted as a test, and this deployment verification
did not prove a live post-cutover Mac-to-Windows AI execution.

## 4. Client cutover and what must stay running

On each Mac/Windows dashboard: **Settings → Server URL**, enter the HTTPS base URL,
confirm the credential/trust consent, then **Check & reconnect**. Keep the existing
profile. Do not run a new team setup, rejoin, delete state or rotate signing keys.
Client URL changes were not automatically performed during initial deployment.

The local companion must remain running for the dashboard and AI workers. The
VPS keeps the relay running independently of the Mac. Keep the old Mac relay and
tunnel stopped: two writable database copies produce divergent histories, and a
later URL switch does not merge them. Local private chats/worktrees remain local.

## 5. Operations runbook

Connect from the Mac:

```sh
ssh -i ~/.ssh/aiconnect_vps -o IdentitiesOnly=yes -o BatchMode=yes root@162.35.104.181
```

Read-only checks on the VPS:

```sh
systemctl status aiconnect caddy --no-pager
journalctl -u aiconnect -n 100 --no-pager
journalctl -u caddy -n 50 --no-pager
curl -fsS http://127.0.0.1:8787/health/ready
systemctl list-timers aiconnect-backup.timer
ufw status verbose
ss -lntp
df -h
```

Check public HTTPS from either client:

```sh
curl -fsS https://aiconnect.162-35-104-181.sslip.io/health/ready
```

On Windows PowerShell, use `curl.exe` for that command. Review logs privately;
do not publish credentials or request contents copied from them.

Actions on the VPS when needed:

```sh
# Restart relay: briefly interrupts connections; avoid important active work.
systemctl restart aiconnect

# Make a fresh consistent backup and inspect its outcome.
systemctl start aiconnect-backup.service
journalctl -u aiconnect-backup.service -n 20 --no-pager

# After intentionally editing Caddy's configuration:
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

If loopback readiness succeeds but public HTTPS fails, inspect Caddy, DNS and
firewall. If both fail, inspect the relay service/logs and available disk space.
If HTTPS succeeds but a client fails authentication, inspect its selected server
and membership continuity; do not solve it by deleting the profile.

## 6. Updating code and recovering data

### Future backend deployment (procedure, not automatic)

1. Test the desired backend/shared revision and note its Git commit.
2. Take and verify a fresh consistent server backup.
3. Upload a new versioned release under `/opt/aiconnect/releases/`, including
   backend source, shared code and deployment scripts. Never upload a development
   database over `/var/lib/aiconnect`.
4. Review schema/runtime compatibility; preserve the previous code release.
5. Switch `/opt/aiconnect/current`, restart the relay, and verify loopback/public
   readiness plus authenticated membership/history.
6. Roll back code only if database changes remain compatible. Never automatically
   restore an old database just because a code release failed.

Frontend-only updates require updating/restarting each local companion, not
deploying a dashboard to this server. Initial server application code came from
`01ac56b`; later commit `fee1782` published the deployment files and client features
to GitHub. Publishing that commit did not perform another server deployment.

### Database restore (deliberate maintenance operation)

Stop the relay first. Preserve the current database **and its WAL/SHM together**
in a separate recovery location. Choose and integrity-check a consistent backup,
restore with service ownership/mode 0600, ensure stale WAL/SHM cannot be mixed with
it, then restart and verify. Restoring an older snapshot loses subsequent writes.
No destructive copy/paste restore command is provided because the chosen snapshot
and current database state must be inspected before replacing anything.

## 7. Decisions, limitations and follow-up work

| Decision | Reason / consequence |
| --- | --- |
| Single VPS and SQLite | Small deployment, low operational overhead; one server is a failure domain |
| Local Codex workers | Repositories and model credentials stay on owner devices; owners must be online |
| Caddy-managed TLS | Avoid manual certificate renewal; protect public transport |
| IP-based sslip.io hostname | Enables HTTPS testing without buying a domain; replace with owned DNS later |
| systemd, no Docker/PM2 | Native restart/boot management with fewer moving parts |
| Separate code and data directories | Code releases do not replace the membership/history database |
| Unprivileged relay and loopback bind | Reduce exposure and writable filesystem scope |
| SQLite backup API | Preserve database consistency instead of unsafe live-file copying |

Not completed: recurring encrypted off-server backups, backup retention/alerts,
owned domain, full reboot validation, non-root administration/password-login
hardening, production enrollment controls and end-to-end encryption. Current MVP
limits include public network creation, 30-day device credentials and indefinite
metadata retention. No claim of production security certification or measured
10–15-user capacity is made. Disk usage must be monitored as history/backups grow.

## 8. Configuration sources

- [Short deployment runbook](backend/deploy/vps/README.md)
- [Relay service](backend/deploy/vps/aiconnect.service)
- [Caddy configuration](backend/deploy/vps/Caddyfile)
- [Backup service](backend/deploy/vps/aiconnect-backup.service)
- [Backup timer](backend/deploy/vps/aiconnect-backup.timer)
- [Backup implementation](backend/deploy/vps/backup.ts)
- [Application architecture](ARCHITECTURE.md)
- [Feature inventory and boundaries](FEATURE-INVENTORY.md)

Keep this document updated when the hostname, runtime, service paths, backup
policy or deployment method changes. Keep secrets in private state, never here.

## 9. Update on 28 October 2026 (IST)

Deployed application commit `5397606` to `/opt/aiconnect/releases/20261028-request-controls` and switched `/opt/aiconnect/current` to it. The release contains backend source, package metadata, shared protocol code, and the VPS backup scripts. The original release remains available for rollback. HTTPS hostname, ports, Node version, service account, and database path are unchanged.

This adds manual retry of failed requests: either participant may request a retry, but execution always returns to owner approval. The request and signed content remain the same; a new worker claim invalidates the previous lease token. No database schema migration was required. Client-side model/effort/owner-note controls and fresh retry worktrees require updated clients.

The existing SQLite backup service completed before deployment and again using the new release after deployment. During the maintenance window, quick_check returned `ok`; counts were 2 networks, 4 members, 4 devices, 2 repositories, 9 requests and 7 results. Live database files were not replaced. Public HTTPS and loopback readiness passed, backend/Caddy were active, and server source hashes matched the committed code. The current Mac profile authenticated with unchanged membership and all cached request IDs still present.

Built Apple Silicon and Intel installers from the same application commit under `frontend/dist/macos-arm64-1793131573633/` and `frontend/dist/macos-x64-1793131573633/`. Both DMGs and app signatures verified; the Apple Silicon package passed isolated first-run startup and dashboard-authentication checks. These are ad-hoc development builds, not notarized releases. Installers remain local and Git-ignored; they were not uploaded to GitHub. End-to-end model execution and native approval interaction remain manual two-device tests.
