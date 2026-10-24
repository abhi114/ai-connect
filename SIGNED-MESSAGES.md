# Signed messages and local device trust

AIConnect signs new requests, general messages, and delivered results with Ed25519.
This authenticates content and routing; it is **not end-to-end encryption**. HTTPS
remains required outside loopback. The relay can read content and control delivery,
availability, status metadata, and the initial identity roster. Signatures do not
make a teammate's instructions safe.

## Upgrade and use

1. Finish/stop active workers before upgrading. Back up the existing backend database
   and each local profile privately; these contain credentials and signing keys.
2. Update and restart the backend using its existing database. Startup adds two
   tables without replacing memberships or history.
3. Update/restart both companions and refresh their dashboards. A local keypair is
   created on first connection and its public key is registered using the existing
   authenticated device credential plus proof of possession. Do not re-enroll.
4. In **Settings → Message signatures & device trust**, compare your own fingerprint
   with the fingerprint your teammate sees for you over a separate trusted channel.
   Choose **Confirm fingerprint / unblock** only after comparing the complete value.
5. Send a new request. Its signature status appears in the conversation and request
   details; the delivered result has a separate verification status.

The first device observed for a member is pinned using trust-on-first-use (TOFU).
It is signature-verified but not independently identity-verified. A changed key or
an additional device for a known member is held until explicit local confirmation.
Blocking is local, persists across restart, and prevents that device's requests
from executing. Revoked devices are rejected based on the last fetched roster.
The relay can withhold revocation information; this is not key transparency.

CLI equivalents (use `npm.cmd` in Windows PowerShell):

```sh
npm run cli -- trust list
npm run cli -- trust block DEVICE_ID
npm run cli -- trust confirm DEVICE_ID --fingerprint FULL_SHA256 --confirmed true
```

Trust controls are available only through the local dashboard/CLI, not AIConnect's
MCP tools. Unblocking confirms the displayed key; it does not bypass owner approval.

## Compatibility and recovery

- Existing unsigned history remains readable and is labelled unsigned. Updated
  companions never approve or execute unsigned requests, including auto-question
  requests. Ask the sender to create a new signed request when work is still needed.
- For rolling upgrades, the backend still accepts unsigned writes from devices
  that have **never** registered a key. Those writes cannot execute on upgraded
  companions. Once registered, a device cannot downgrade to unsigned writes.
  Update all clients; old companions do not gain these protections automatically.
- Old unsigned outgoing queue entries are retained, not automatically signed or
  resent. Check whether the original reached the recipient before resubmitting.
  Queue management UX is deferred; do not blindly delete profile data.
- Signed retries retain the same envelope and idempotency key. The relay rejects
  reuse of a signature ID with another submission. Request IDs are signed and
  preserved across delivery; local run records prevent duplicate execution.
- Keys and pins live in the existing restricted-permission profile `state.json`.
  They are excluded from dashboard/MCP responses. macOS uses file mode 0600;
  Windows relies on the user's profile-directory ACLs. OS keychain storage is
  deferred. Do not share/copy profiles between people or commit them.
- Do not delete a signing key to fix connectivity. Replacement on the relay requires
  proof from both old and new keys. Automated rotation/recovery UI is deferred;
  losing the profile needs an explicit device/account recovery plan.
- An old backend without `/v1/keys` fails closed for updated companions. Upgrade the
  backend first. Changing a tunnel URL does not change identity or fingerprints.

## Signed fields and trust boundaries

Each signature uses a versioned domain and deterministic JSON encoding. Its header
binds message ID, type, network, member, device, public key and issuance time.
Request payloads bind repository, owner, kind, title, body, constraints and base ref.
Results bind the original request digest, requester, repository and entire result.
General chat bodies are signed; local receipt records detect a relay re-labelling
the same signed message under a different record ID. History is allowed to be old:
issuance time is signed, not treated as a wall-clock expiry for offline delivery.

The relay verifies signatures against registered device keys. The companion repeats
verification against local pins before approval, claim/execution, heartbeats and
delivery. Approval digests include the signature. Unverified results remain visible
with warnings in the dashboard but are withheld from MCP result consumers.
Request state transitions, presence and repository discovery are still relay
metadata, not end-to-end signed transactions.

Worker policy is passed separately through Codex `developer_instructions`; peer
title/body/constraints are JSON data on stdin. Peer text cannot grant local consent
or change developer policy. Worktree isolation, read-only/workspace-write sandbox,
disabled worker network access and local approval checks remain in place. Prompt
separation is defense in depth, not a replacement for these controls.

E2EE, OS-keychain storage, independently authenticated first-contact enrollment,
key transparency, rotation/recovery UI and signed administrative transitions are
future work. No production-security audit is implied by the regression tests.
