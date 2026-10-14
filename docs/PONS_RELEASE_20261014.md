# Release attempt: 2026-10-14

Owner authorized release. Candidate: `394adb9927c5533b9cc8999046b103c1859bfb20`.
Status: **staged, NOT activated**. First-migration preparation found retained
legacy QIANQI cutoff; do not bypass the handoff gate or delete the old state.

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
