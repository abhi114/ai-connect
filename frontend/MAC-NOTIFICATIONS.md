# macOS menu bar and notifications

## Scope

AIConnect now has a small native Swift/AppKit menu-bar helper. It is independent of the browser and polls the local companion every four seconds. No Electron runtime or backend change is needed. The browser may be closed; the companion and menu helper must remain running on an awake Mac.

The menu shows connectivity, an approval count, and up to 20 recent/attention-first network requests. Each request shows its sender, repository, state and signature status. Actions are derived from local ownership, trust, current state and repository settings. Open dashboard is always available. Model/effort selection, diffs, delivery/commit review, local chat input and trust changes remain in the dashboard.

## Install for development

From `frontend`, with Node 24+ and Apple's Xcode Command Line Tools installed:

```sh
npm run cli -- service stop
npm run cli -- service start
npm run cli -- menubar install
```

Do not restart during work you need to finish uninterrupted. The CLI builds an ad-hoc-signed local app at `~/.repo-network/AIConnect Menu.app` (or under RN_HOME), then opens it. `menubar build` only builds. The build requires `xcrun swiftc`; a future release should ship a signed/notarized prebuilt app instead. No Xcode installation is needed to run a prebuilt helper.

Click **AI◈** in the macOS menu bar, then **Enable notifications**. Allow the macOS permission prompt. If banners do not appear, check System Settings → Notifications and Focus/Do Not Disturb. Notification action buttons may appear only after expanding/hovering the notification. Enabling notifications is never automatic.

For launch at login, manually add the generated app to macOS Login Items. This is optional and not configured by the installer. The helper does not start the companion by itself after reboot. Quit the menu helper before rebuilding it on updates. Quitting it does not stop workers. To remove it, quit it, remove any Login Item you added, and move only the generated `.app` to Trash; retain the profile and database.

## Request flows

- Ask mode: a new incoming request triggers an approval notification. **Review & allow** fetches the full request into a native confirmation dialog. Confirming uses the Mac account's Codex-default model/reasoning, then the usual queue. Choose a different model in the dashboard instead.
- Auto question mode: the request still appears and state changes notify, but the helper does not add an approval step or override the repository policy.
- Reject/cancel: offered only when applicable; a native confirmation is required. The server remains authoritative, so stale actions may fail with an explanation. Existing worktrees are retained.
- Finished/review-needed/failed: state transitions notify. A click opens the dashboard; it does not automatically commit, deliver or retry work.
- Initial launch: establishes a baseline without notifying for old history; existing requests are still in the menu. Subsequent observed changes notify. At most 100 participant requests are tracked, not an exhaustive event ledger. Very fast intermediate states between polls may be coalesced.

## Safety and limitations

Notifications omit full request text from lock-screen previews but include sender/repository metadata. Mute notifications if that metadata is sensitive. The menu contains request titles. The helper reads only `dashboard.json` for the local HTTP address/session token, not signing private keys or remote credentials. It restricts requests to loopback and authenticates each RPC. New notification RPCs are not included in the MCP tool list. Approval reuses existing signed approval digests, trust checks, worktree protections and the shared repo queue. Changed/untrusted keys cannot be accepted from this menu.

No arbitrary shell execution, inline free-text agent replies, global pause, OS wake, Windows support, automatic login installation, or one-click commit/delivery is included. Only network requests are monitored in this version, not private local turns/routines or general network chat. The utility opens the main dashboard, not a specific request deep link.

## Verification

TypeScript checks, native Swift compilation/ad-hoc bundle build, tests for trust/ownership/offline/stale-action gating and delegation to the existing approval path pass. The full frontend suite passed before the final additional approval-path regression test. An isolated helper process launched with a mock companion; native UI inspection timed out for the menu-only app. Banner permission/delivery and native action-click behavior still need manual testing; no live model was invoked and no real request was approved during testing.

Manual test: enable notifications, send a new signed ask-mode request from Windows, expand its notification and inspect the full request with Review & allow. Test Reject on a second request. Set the repo's questions to auto and send a third question: expect progress/result notifications without an approval gate. Test an old notification after resolving the request elsewhere; it must not execute again. Keep changes in ask mode and verify delivery still requires dashboard review.
