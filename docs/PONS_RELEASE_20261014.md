# Production release: Pons servicing, 2026-10-14

Status: **activated**. Runtime, collector and both public APIs use
`/opt/crypto-launchpad/releases/pons-c75fdb9-20261014`.
Manifest SHA256: `886f68deb69f441462894440aa1318697696af9002f0c5ff03339516ba059b56`.
The earlier staging report below is historical, superseded by this section.

## Deployment and preserved state

- Owner authorized release. Both project inspections qualified at 13:27 UTC
  using free Alchemy, chain4663; no request was sent to QuickNode.
- QIANQI retained cutoff reconciled as history-only. Original journals remain
  unchanged. Migration preserves old credited purchases, consumed draws and payouts.
- Shared runtime owns servicing for both projects. Old automation/indexer/draw
  services remain disabled with their disabling overrides intact.
- Pons collector refreshes both accounting reports every five minutes, without RPC.
  Quiet runtime ticks perform local checks; contract control is scheduled every
  30 minutes or earlier when purchases/obligations require it.
- RPC budget persists across restarts: 2000 requests/hour, minimum 150ms spacing.
  Diagnostic limit was raised from 250 without resetting the used count/window.
  This is a request ceiling, not a provider CU estimate or free-tier guarantee.
- QIANQI API registry now uses pons-api-v1 and a separate readable public snapshot;
  IGW keeps its existing projection table with Pons accounting. APIs do not make
  RPC calls for visitors. Source and contract verification timestamps stay separate.
- Encrypted credentials remain server-owned. No keys or live journals entered Git.

## Verification

- Initial qualification, first financial-service passes and public projection
  succeeded for both tokens. Subsequent idle checks kept RPC usage at 1130
  through 13:43 UTC (includes preflight and initial startup, not steady-state cost).
- HTTPS sites return 200. Both public APIs are fresh. QIANQI reserves total
  226.915834 USDG, with two historical draws preserved. IGW fund 26.966887 USDG;
  38 tickets from six eligible purchases across five wallets.
- Fixed API service freshness to match five-minute Pons heartbeat instead of the
  old two-minute threshold; contract freshness remains independently enforced.
- Existing operational monitor now checks shared runtime/collector, both APIs and
  verified Pons backup age. Disabled legacy workers are no longer false incidents.
  No manual Telegram test message was sent.
- Backup includes PostgreSQL, shared journals/public snapshots/config, legacy
  journal evidence, transactional SQLite copy and the persistent RPC budget.
  Checksums and archive/database listings verified. Live backup drained the worker
  and restarted it with preserved state. Daily timer enabled. Not a full restore drill.
- Changed-path tests: handoff/binding/inspection/migration (11), credential access,
  monitoring (7) and freshness/heartbeat (2) passed. Pinned adapter/upstream source
  checks passed. Contract artifact built once; later ops release reused identical
  verified artifact only after byte comparison of all runtime sources.

## Operational limits and next checks

No new raffle was forced during release; both tokens currently await funding.
Measure an ordinary day of provider usage before promising a monthly cost.
First-migration inspector must not be rerun over the new state. Never delete
journals, reset quota or enable an old financial worker to recover a failure.
See [release procedure and rollback](PONS_RELEASE.md).

---

# Release attempt: 2026-10-14

Owner authorized release. Candidate: `394adb9927c5533b9cc8999046b103c1859bfb20`.
Status: **staged, NOT activated**. First-migration preparation found retained
legacy QIANQI cutoff; do not bypass the handoff gate or delete the old state.

Follow-up at 13:16 UTC: finalized88384176; both SHORT proposal statuses4,
settlement phases3, canonical terminal blocks, awarded=paid (6963644 and
53115936 raw USDG). Retained cutoff82251661 is canonical and checkpointed;
activeProposal/pendingDatasetDraw are zero. A tested explicit history-only
checkpoint handoff now supports this case without modifying the native journal.
Also fixed the production binding to the pinned legacy 90/5/5 profile: the
original automation config does not contain a bps field. Not a universal default.

## Verified on server

- SSH host ams-1-vm-wjus, 201.51.22.244; checks around 13:09–13:15 UTC.
- Both existing public API services active. Old financial/indexer services disabled;
  their disabling overrides retained. No old service restarted.
- Backup `/var/backups/pons-release-394adb9-20261014`: database.dump and
  state-config.tar.gz, SHA256SUMS verified, pg_restore listing and tar listing
  succeeded, COMPLETE marker present. This is not a full restore drill.
- Source staged at `/opt/crypto-launchpad/releases/pons-394adb9-20261014`.
  Archive SHA256 `983de4403b140ba15a089170e7971489da4132cd63950f80798e1ab86379aab7`
  matches local archive. 184 adapter and 174 upstream sources verified there.
  Active release symlinks were not switched. Existing node_modules reused by link;
  full production artifact build/configuration remains pending.
- Free Alchemy hostname robinhood-mainnet.g.alchemy.com: chain4663, latest88391271,
  finalized88380252, latest/pending nonce and eth_call/getCode/getBalance succeeded.
  Initial responses about 0.2–0.32 seconds. Finality lag at this observation about
  1106 seconds. This does not qualify every runtime method or sustained free limits.
- Shared diagnostic quota `/var/lib/crypto-launchpad/pons-preflight/budget.json`:
  250 requests/hour, 23 reserved after these checks. It is a diagnostic cap, not
  a selected production allowance. Preserve the file; do not reset for retry.
- IGW: no pending sender intent, runtime operation or publisher intent; latest and
  pending executor nonce both13. Executor 0x6A20332b8936D172aBcD783a2D4d0C243864dAfc
  had 3967386321242000 wei on chain4663. Saved ledger checkpoint87394382.
- QIANQI: parent/RNG/scheduler pending intents absent; latest/pending nonce both93.
  activeProposal and pendingDatasetDraw zero. Two old SHORT jobs have
  terminalChecked entries; their historical terminal receipts were not reverified.

## Blocking legacy state

`/var/lib/qianqi-public/automation.json.scheduler` retains cutoffs.SHORT:
number82251661, hash `0xb39d16d646e0f4bfcd7f4286f3954922e0835651e43863b072250c740a626c34`.
The first-handoff inspector deliberately rejects any retained cutoff. A zero
current activeProposal is not permission to erase this journal or assume all
historical work was imported. Full inspector qualification was not run: server
migration/handoff configuration is not yet complete.

Next required work: explicit read-only reconciliation of this cutoff and the two
terminal jobs, preserving the original journals and accounting; implement/test
the corresponding handoff evidence if safe. Then fresh Pons reports, actual
migration/config/permissions, complete free-RPC qualification and inspector.
No financial signatures or sends occurred. QuickNode was never queried.

Operational note: initial root DB connection was rejected by peer authentication;
read-only IGW inspection succeeded as the existing launchpad-draw service user.
Backup list verification initially lacked postgres-user access to root-only backup;
it was rerun as root successfully without changing backup permissions.
