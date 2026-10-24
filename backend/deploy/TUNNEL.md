# Temporary HTTPS relay on your Mac

This setup runs the backend on this Mac and exposes only its HTTP port through
a Cloudflare Quick Tunnel. The companion/dashboard stays local. No Railway
account, Cloudflare account, paid server, or router port forwarding is needed.

## Start (two terminals)

Terminal 1:

```sh
cd /Users/abhisheknigam/Desktop/projects/pantheon/backend
npm start
```

Terminal 2 (cloudflared is installed on this Mac):

```sh
cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
```

Use the HTTPS URL printed by cloudflared as the clients' `--server` value.
The root URL is an API, not a dashboard; use `/health/ready` to check it:

```sh
curl --fail https://YOUR-TUNNEL.trycloudflare.com/health/ready
```

Expected: `{"ok":true}`. Private endpoints such as `/v1/members` require a
bearer credential and return 401 without one.

Do not start duplicate processes if the relay and tunnel are already running.
For processes started in your own terminals, Ctrl+C stops each one. The tunnel
URL stops working when cloudflared stops. Keep the Mac awake and online.

## Connect Mac and Windows

On the Mac, in `frontend/`, create a test network if the profile is unenrolled:

```sh
npm run cli -- setup --team "AIConnect Test" --handle abhishek --server https://YOUR-TUNNEL.trycloudflare.com
npm run cli -- invite
```

On Windows, keep the `frontend/` and `shared/` folders next to each other.
Install Node 24+, Git, and a working signed-in Codex CLI, then from `frontend/`:

```powershell
npm run cli -- setup --invite INVITE_CODE --handle teammate --server https://YOUR-TUNNEL.trycloudflare.com
npm run cli -- members
npm run cli -- doctor
```

Choose distinct handles. An invite is single-use: send it privately. Do not
share profile/state files, which contain credentials. Existing enrolled profiles
are not overwritten by setup; use a separate RN_HOME, RN_PORT and MCP --name
for a separate test network. See the frontend README for the full profile and
Windows executable-path instructions.

Once both members are online, explicitly expose a committed Git test repository
on its owner's machine, with questions requiring approval:

```sh
npm run cli -- repo expose /absolute/path/to/test-repo --name demo --questions ask --changes
npm run cli -- dashboard
```

The teammate can then ask `@abhishek/demo` a question. The owner approves it
in their local dashboard. Change requests also require approval and subsequent
diff review/delivery. Nothing is merged or pushed automatically.

## Persistence and limits

- SQLite data stays in `backend/data/pantheon.sqlite` (including its WAL files).
  Stopping the tunnel does not delete your network or request history.
- Quick Tunnel hostnames change on restart. This MVP has no enrolled-profile
  server-switch command yet. Do not recreate/join accounts or manually replace
  credential files just to change URLs; keep this tunnel alive for the test,
  or arrange a verified server-URL update before continuing an existing network.
- The public URL is not access control. Private network records require tokens,
  but network creation and invitation redemption are publicly reachable. This
  MVP is for trusted testers, not an unattended public service.
- Cloudflare terminates HTTPS and proxies to loopback HTTP. This is transport
  encryption, not end-to-end encryption of messages from the tunnel provider.
- There is no uptime guarantee. Quick Tunnels allow 200 concurrent in-flight
  requests and do not support SSE; AIConnect currently uses ordinary HTTP polling.
- Do not tunnel the localhost dashboard on port 4319 or expose its token URL.

Reference: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/
