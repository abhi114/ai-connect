# AIConnect testing VPS — deployed 27 October 2026

For the full step-by-step setup record, software downloads, port map, architectural
decisions and maintenance boundaries, see [SERVER-SETUP.md](../../../SERVER-SETUP.md).

## Endpoint and scope

- Base URL: `https://aiconnect.162-35-104-181.sslip.io`
- Readiness: `https://aiconnect.162-35-104-181.sslip.io/health/ready`
- Host: `162.35.104.181`, Ubuntu 26.04.1 LTS, x86_64.
- Node: official v24.22.1 Linux x64 binary, SHA-256 verified against Node's HTTPS-published checksum.
- Caddy: 2.11.7, official stable package repository; automatically managed public HTTPS.
- This is a testing relay, not a hosted dashboard. `/` may return 404; use the readiness endpoint to check it. Dashboard and workers remain local to each Mac/PC.

The free sslip.io hostname resolves the embedded public IP. It depends on third-party DNS and is not a domain owned by the user. It does not use a tunnel. Move to an owned domain for a longer-term deployment. The code remains a development MVP: public network creation, indefinite metadata retention and 30-day device bearer credentials still have the limits documented in `backend/README.md`.

## Layout

| Item | Location |
| --- | --- |
| Initial code release | `/opt/aiconnect/releases/20261027-initial` |
| Active release symlink | `/opt/aiconnect/current` |
| Runtime | `/opt/node-v24.22.1-linux-x64/bin/node`, linked as `/usr/local/bin/node` |
| Live database | `/var/lib/aiconnect/pantheon.sqlite` |
| Daily snapshots | `/var/backups/aiconnect/` |
| Caddy config | `/etc/caddy/Caddyfile` |
| Systemd units | `aiconnect.service`, `aiconnect-backup.service`, `aiconnect-backup.timer` |

The backend runs as the unprivileged `aiconnect` account with read-only application files, a restrictive umask and writable private data directory. It listens on `127.0.0.1:8787` only. Caddy handles public ports 80/443. UFW allows TCP 22/80/443 and denies other unsolicited incoming traffic. SSH authentication settings were not changed; password/root login were not disabled.

## Migration evidence

A consistent snapshot was generated with the existing SQLite backup API, including WAL contents; source database files were not copied piecemeal. There was no running local relay on port 8787 at migration time. The original database remains on the Mac.

Pre-start uploaded snapshot SHA-256:

`e977973a4b8d643aa0ed91d987de3f69b4c102ecf1cf7d65b00a5a97ccc4b26e`

Verified counts: 1 network, 2 members, 2 devices, 1 repo, 7 requests, 6 results, 0 general network messages, 2 device keys, 4 signed records, 36 events. SQLite quick_check returned `ok`. The existing Mac bearer credential authenticated successfully; network/member/device IDs and own signing public key matched the existing local profile, and every cached request ID remained present. Member handles were `abhishek` and `nabhi`. No signing private key or Codex credential was uploaded. Private local chats/worktrees remain on their original computers.

Local migration backup and code archive: `backups/vps-migration-20261027/` at the repository root (Git-ignored; private file permissions). The uploaded staging snapshot/code archive also remain under `/root` on the VPS. Protect every database copy as sensitive credential-bearing data.

## Switch clients

On **each** Mac/Windows dashboard, open Settings → Server URL, enter the base URL above, tick the trust/credential consent checkbox and select **Check & reconnect**. Do not create a new team, rejoin, delete state.json or rotate signing keys. This change was not performed automatically during deployment. An updated running companion is required for that existing settings control.

Keep the old local relay stopped after cutover. Running two writable copies and sending clients to different copies forks history; switching back later does not merge messages. No local backend or Cloudflare tunnel is required after both clients switch. The local companion still must run for each computer's dashboard and AI workers.

## Operations (run over SSH)

```sh
systemctl status aiconnect --no-pager
journalctl -u aiconnect -n 50 --no-pager
systemctl restart aiconnect
curl -fsS http://127.0.0.1:8787/health/ready
systemctl start aiconnect-backup.service
systemctl list-timers aiconnect-backup.timer
```

Backups run daily around 03:00 UTC (08:30 IST), with up to five minutes of jitter. A manual snapshot was successfully created during deployment. Backups are consistent SQLite snapshots with mode 0600, not live-file copies. Automatic daily backups are on the same VPS: they do **not** protect against loss of the server. Arrange encrypted off-server copies. No automatic backup deletion/retention policy is installed yet; monitor disk usage.

Future deployment: test backend changes, upload a new versioned release containing backend/src and shared, take a backup, switch the active code symlink, restart the service and verify health/authentication. Never overwrite the live database during a code update. This initial release used local source (backend/shared were unchanged from Git HEAD `01ac56b`; the VPS deployment files were new). Uncommitted frontend UI changes were not shipped to the VPS.

Restore requires stopping the relay, preserving the current database **and WAL/SHM files together**, placing a verified consistent backup as the new database with `aiconnect:aiconnect` ownership/mode 0600, and then starting/verifying. Do not restore while requests are being written, and do not mix stale WAL files with a restored snapshot. Keep the displaced database directory for rollback. Restoring an older backup loses changes after its timestamp; review the selected snapshot before proceeding.

## Verification performed

All 17 backend tests passed locally. Public HTTPS readiness returned HTTP 200 with `{"ok":true}` without bypassing TLS validation. HTTP redirects to HTTPS. Unauthenticated `/v1/me` returns 401. Existing membership/key/history checks passed. Both services are enabled at boot and active; a backend process restart preserved service/database access. The VPS itself was not rebooted. Live Mac-to-Windows execution after client URL cutover remains to be tested by the user.
