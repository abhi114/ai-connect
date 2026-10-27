# Fresh-user testing without deleting existing profiles

Use this to test a new AIConnect identity on Mac and Windows against the VPS.
This is **not** a factory reset, account deletion, or a new Codex subscription.
Your current server membership/history remain on the VPS. The old local profile
is temporarily moved aside, retaining its credentials, signing keys and history.
Only one default-profile companion should run per computer during this test.

## Before either device switches

- Finish or cancel active work first. Stop the companion, quit AIConnect and the
  AIConnect notification menu, and close existing dashboard tabs.
- Close Codex chats using AIConnect (or quit Codex desktop) so MCP cannot restart
  the old companion while the profile is being moved.
- Do not edit/delete the VPS database, revoke existing members, log out of Codex,
  delete `.codex`, or delete `state.json`.
- The commands refuse to overwrite an existing saved-profile folder. If a guard
  fails, stop and inspect; do not force the rename.
- Local Git worktrees can contain absolute paths. Do not use worktrees belonging
  to the detached profile while it is renamed. Restoration returns the exact path.
- These saved profiles contain credentials. Keep them private; never upload them.

## Mac: fresh installed-app test

Stop the existing development companion before quitting its windows:

```sh
cd /Users/abhisheknigam/Desktop/projects/frontend-backend/frontend
npm run cli -- service stop
```

Then quit Codex/AIConnect/menu helper and run:

```sh
if [ -d "$HOME/.repo-network" ] && [ ! -e "$HOME/.repo-network-before-fresh-test" ]; then
  mv "$HOME/.repo-network" "$HOME/.repo-network-before-fresh-test"
else
  echo "STOP: original profile missing or saved profile already exists. Nothing moved."
fi
```

Only continue if the move succeeded. Mount the correct architecture DMG, drag
AIConnect.app to Applications, eject the image and launch the installed app.
It must be in `/Applications` or `~/Applications`, not on the mounted DMG.
Default development DMGs are ad-hoc signed, not notarized; macOS may block them.
For a trusted build, use the per-app Privacy & Security Open Anyway flow if your
organization permits it. Do not disable Gatekeeper globally.

Use **AIConnect → Setup & connection** if the app opens the dashboard directly:

1. Check this Mac; install Apple Git tools only if missing.
2. Codex may already report signed in: its account is separate from AIConnect.
   No need to sign out to test fresh AIConnect enrollment. A genuinely clean Git/
   OAuth install needs a separate macOS user or another Mac.
3. Open dashboard. Settings should say the computer has not joined a network.
4. Server should be `https://aiconnect.162-35-104-181.sslip.io`.
5. Expand **Starting your own team instead?** and create a test team, for example
   `AIConnect Installer Test`, username `mac-test`.
6. Create a single-use invite under **Invite a friend**. Save the new code for
   Windows. Do not reuse old invitation codes.
7. Share a disposable Git repository with a commit through **Share repository**.
   Start with questions set to Ask and changes enabled only if you intend to test
   edits. Do not expose real sensitive work for a smoke test.
8. Optional: use **Connect / repair Codex desktop integration**, review and confirm
   the installed app's MCP path, then reopen Codex in a new chat.

New teammates joining your real existing team would instead use an invite created
by its current admin. Creating a new team is deliberately separate from joining.

## Windows: fresh source-code test

PowerShell, assuming the checkout remains at `C:\AIConnect`:

```powershell
cd C:\AIConnect\frontend
npm.cmd run cli -- service stop
git pull --ff-only
npm.cmd install
node --version
codex --version
```

Node must be 24+. If Codex is not on PATH, retain the working `RN_CODEX_BIN`
configuration from your earlier installation. Then quit Codex desktop and close
old dashboard tabs. Use the default profile for this walkthrough:

```powershell
Remove-Item Env:RN_HOME -ErrorAction SilentlyContinue
$oldProfile = Join-Path $env:USERPROFILE '.repo-network'
$savedProfile = Join-Path $env:USERPROFILE '.repo-network-before-fresh-test'
if (!(Test-Path -LiteralPath $oldProfile) -or (Test-Path -LiteralPath $savedProfile)) {
  throw 'STOP: original profile missing or saved profile already exists. Nothing moved.'
}
Move-Item -LiteralPath $oldProfile -Destination $savedProfile
$env:RN_SERVER = 'https://aiconnect.162-35-104-181.sslip.io'
$env:RN_PORT = '4319'
npm.cmd run cli -- service start
npm.cmd run cli -- dashboard
```

If you were using a custom RN_HOME before this walkthrough, stop that profile
first and adapt the paths rather than assuming the default folder is the active
one. Removing the environment variable above does not remove any files.

Open the printed dashboard URL. In Settings join using the **new Mac-created
invite** and username `windows-test`. Do not create another team on Windows if
you want the two test identities to see each other. Review and register/repair
the MCP entry in Settings if you want to test requests from Codex desktop.
No `setup --team` is needed; enrollment is through the dashboard.

## Test checklist

- Both test usernames appear online in the same new team.
- The Mac's exposed test repository appears on Windows.
- From Windows send a Question to agent: the Mac must ask for approval under Ask.
- In the Mac app open the notification menu, choose Enable notifications and
  allow macOS notifications. Keep the helper and companion running. Check Focus/
  Do Not Disturb if no banner appears.
- Send another new request after enabling notifications. The menu should show it;
  Review & allow opens confirmation, then uses existing trust/approval validation.
  Full model/effort choice remains in the dashboard. Reject/cancel are available
  only while the request's current state and permissions allow them.
- Change questions to Auto for the repo and select the model. A new question can
  run automatically; a new change request must still require approval. Verify
  results on both devices. Previously pending questions do not become approved.
- Confirm change work is isolated in a worktree and reviewed before delivery.
- Restart the companion/app and verify the new test identity/history persist.
- Test local project chats, linked requests, file review and a read-only routine.

Native notifications are **Mac-only**. The precompiled menu helper is inside the
DMG; recipients do not compile Swift. It is opened explicitly and notification
permission is opt-in. No automatic permission grant or helper login item is added.

## Restore the old Mac identity

Finish test tasks, use **Stop companion**, quit AIConnect/menu/Codex and close
dashboard tabs. Then:

```sh
if [ -d "$HOME/.repo-network-before-fresh-test" ] && [ -d "$HOME/.repo-network" ] && [ ! -e "$HOME/.repo-network-fresh-test" ]; then
  mv "$HOME/.repo-network" "$HOME/.repo-network-fresh-test" &&
  mv "$HOME/.repo-network-before-fresh-test" "$HOME/.repo-network"
else
  echo "STOP: inspect the profile folders; nothing moved."
fi
```

Reopen AIConnect. The original profile is back at its original path. Existing
server URL is preserved; if it still points at a dead tunnel, switch to the VPS
using Settings → Server URL with consent. Do not rejoin the old membership.

## Restore the old Windows identity

Finish test tasks and quit Codex after stopping the companion:

```powershell
cd C:\AIConnect\frontend
npm.cmd run cli -- service stop
$liveProfile = Join-Path $env:USERPROFILE '.repo-network'
$savedProfile = Join-Path $env:USERPROFILE '.repo-network-before-fresh-test'
$testProfile = Join-Path $env:USERPROFILE '.repo-network-fresh-test'
if (!(Test-Path -LiteralPath $savedProfile) -or !(Test-Path -LiteralPath $liveProfile) -or (Test-Path -LiteralPath $testProfile)) {
  throw 'STOP: inspect the profile folders; nothing moved.'
}
Move-Item -LiteralPath $liveProfile -Destination $testProfile
Move-Item -LiteralPath $savedProfile -Destination $liveProfile
npm.cmd run cli -- service start
npm.cmd run cli -- dashboard
```

Both identities now remain available: the original is active and the new test
profile is saved as `.repo-network-fresh-test`. A future switch requires stopping
all companion/MCP clients and swapping directories back deliberately, never
merging their JSON or copying one identity's keys into another. No test memberships
are automatically removed from the VPS.

## What has and has not been tested here

The developer machine is macOS. Automated tests include mocked Windows startup
and folder-picker behavior, but they are not native Windows execution. The package
smoke test uses an isolated profile and does not create VPS accounts or invoke a
paid model. Real Windows first-user setup and cross-device requests must be run on
the Windows PC with the steps above; no remote Windows access is assumed.
