# AIConnect macOS app and installer

This package stays inside the existing repository. It is a small native Swift
AppKit shell with a WKWebView dashboard, bundled Node and Codex, plus the existing
notification helper. It is not an Electron fork or a new backend. macOS **13.5+**
(the bundled Node binary's minimum OS version).

## Recipient setup

1. Choose the DMG for Apple Silicon (`arm64`, M-series) or Intel (`x64`).
2. Drag AIConnect.app to Applications; eject the DMG and open the installed app.
   `~/Applications` is also supported for a non-admin installation.
3. Check this Mac. If Git is missing, the button invokes Apple's official Command
   Line Tools installer. This can be a substantial download; full Xcode is not
   necessary. Git is deliberately not copied from the builder's machine.
4. Sign in to Codex. The bundled CLI opens its normal browser OAuth flow. AIConnect
   does not collect passwords/API keys or create a shared model subscription.
5. Open dashboard. New profiles open Settings with the testing VPS prefilled:
   `https://aiconnect.162-35-104-181.sslip.io`. Enter username and invite code, or
   explicitly create your own separate team. The relay must be reachable.
6. Share a repository with the existing folder picker; it must be a Git repository
   with a commit. Sharing/approval policies are never enabled automatically.
7. Optional: connect Codex desktop after reviewing the exact MCP path; open the
   notification menu and enable notifications; manually add the app to Login Items.

Normal recipient flow requires no Terminal, Node, npm or Homebrew. Codex desktop
is optional and is not bundled. Browser sign-in and Apple's installer remain
interactive OS/account steps. The app doesn't silently install privileged services.

Node's npm/npx are included for Node-based project tasks. Other project-specific
SDKs, Python environments, databases and dependencies are not installed by the app.

The menu **AIConnect → Setup & connection** returns from the dashboard to setup.
After the first dashboard launch, future launches start the companion and reopen
the dashboard. Adding the app to Open at Login therefore starts it on login.
Closing/quitting the app leaves the companion running. **Stop companion** is
explicit and refuses observed active workers. Scheduled work still requires an
awake Mac. No automatic app/runtime updater is implemented.

## Existing profiles and safe upgrades

Data stays in `~/.repo-network`; Codex retains its own standard authentication
storage. No profile is shipped in the DMG. Existing server URLs are not overridden
by the bundled default. Switch the URL with existing Settings consent if needed.

Before replacing an app: finish active work, stop the companion, quit the desktop
and notification apps, then replace the installed app. The desktop bridge rejects
an old/different running companion instead of silently using stale code. After
switching from CLI source checkout to installed app, use **Connect / repair Codex
desktop integration**. Registration reuses existing fingerprint/ownership checks
and updates only AIConnect's MCP entry after confirmation. Never move the app
after registering it. Never delete state to repair an installation.

To uninstall: stop companion, quit both apps, remove optional Login Item and the
AIConnect MCP entry in Codex, then trash the installed app. Membership, keys,
history and worktrees are intentionally retained. App removal is not network
revocation or account deletion.

## Builder commands

Run on macOS with Node 24+ and Xcode Command Line Tools:

```sh
cd frontend
npm run package:mac -- arm64
npm run package:mac -- x64
```

Each build creates a new `frontend/dist/macos-<arch>-<timestamp>/` folder containing
the app, dependency extraction, DMG and SHA-256 file. These and `.cache` downloads
are Git-ignored. Share **only the final DMG**, optionally its checksum, not the
source checkout/profile or intermediate directories.

Downloads are version-pinned and fail closed on checksum mismatch:

- Node 24.22.1 from nodejs.org; pinned SHA-256 per architecture.
- Codex CLI 0.164.0 platform archive from registry.npmjs.org; pinned SHA-512.
- Codex LICENSE/NOTICE from its corresponding GitHub release tag; pinned SHA-256.

The package includes runtime notices/licenses and preserves Codex's vendor layout
and resource files. Source copying uses an explicit frontend/src + shared
allowlist; it does not copy developer home directories, tests, dependencies,
database, backups, `.env`, Git metadata or Codex credentials. Build metadata records
versions and architecture. Review redistribution notices before public release.

## Signing and Gatekeeper

Default builds are **ad-hoc signed development builds, not notarized**. They can be
blocked by Gatekeeper after download. Trusted testers may use the per-app Open
Anyway option in System Settings → Privacy & Security. Organizational policy may
prevent this. Do not disable Gatekeeper or globally remove quarantine.

For proper public distribution, obtain an Apple Developer ID Application signing
identity and set `AICONNECT_SIGN_IDENTITY` for the builder. Optional
`AICONNECT_NOTARY_PROFILE` names an existing notarytool Keychain profile; the build
submits the DMG, waits, then staples it. Neither certificates nor Apple credentials
belong in Git. Signed/notarized distribution is supported by the script but is
not claimed tested without those credentials. Validate on a clean Mac before release.

## Security and implementation boundaries

- Native actions use executable/argument arrays, never shell-interpolated input.
- The webview loads only the loopback dashboard port returned by the authenticated
  companion. It has no JavaScript-to-native command bridge and uses nonpersistent
  website storage. User-clicked HTTPS links can open in the external browser.
- Dashboard RPC retains session-token/origin checks. Tokens are not placed in
  remote URLs; the local fragment is removed after loading into session storage.
- macOS local-network webview exceptions do not authorize remote HTTP navigation.
- The companion runs as the current user. This package adds no root service,
  automatic enrollment, repository sharing, trust approval or model execution.
- Login output is not persisted by the shell; canceling/quitting interrupts the
  login subprocess. Sign-in still depends on browser/network/account availability.
- Profiles with custom RN_HOME/RN_PORT are supported by the CLI, not this first
  graphical package, which uses the default profile and port 4319.

## Verification scope

27 October 2026: both architecture DMGs built; native Swift compiled; deep strict
code-signature verification and DMG integrity verification passed. Apple Silicon
bundled Node/Codex/npm executed; an isolated profile started/stopped the packaged
companion, opened first-run Settings over HTTP and rejected unauthenticated RPC.
The native setup window/install-location guard was visually inspected. Frontend
suite: 85 passed, one live-Codex test skipped; TypeScript check passed. Existing
membership/profile was not used by the smoke test.

Automated bridge/dashboard tests and native compilation cover the new glue. A
fresh-Mac download/quarantine path, Apple Git installer, new-account OAuth, real
cross-device Codex execution and Developer ID notarization require manual testing.
Intel artifacts can be cross-built on Apple Silicon, but must be tested on Intel.
Do not infer those results from a successful build on the developer's Mac.

Official Codex login behavior was checked against
https://learn.chatgpt.com/docs/developer-commands#codex-login:
`codex login` uses browser OAuth; `codex login status` reports credential presence.
