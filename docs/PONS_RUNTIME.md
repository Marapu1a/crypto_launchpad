# Shared Pons runtime

2026-10-14: local release candidate. Not deployed; no QuickNode requests.
Release procedure: [PONS_RELEASE](PONS_RELEASE.md).

`node scripts/run-pons-runtime.mjs CONFIG` uses the fixed bootstrap in
server/shared/pons-bootstrap.mjs. Both QIANQI and draw-v2 use the Pons journal,
without block scanning, getLogs, traces or purchase recognition transactions.
Their contracts remain different; the service model is shared.

Configuration schema: pons-runtime-config-v1. Required: mode, absolute lockFile,
healthFile, persistent rpcBudget {file,maxRequests,windowMs}, projects.
pollMs defaults to 15000. Production requires allowPublicTransactions=true and
allowedRpcHosts: exact HTTPS hostnames, no QuickNode. Chain must be 4663.
Rehearsal is restricted to local Hardhat. The example is disabled by default.

Each project requires id, adapter and reportFile. draw-v2 requires runtimeConfigFile
with existing policy/DB/executor/publisher bindings; additional read/trace RPC
endpoints are rejected. qianqi requires schedulerFile, migrationFile, rpcFile,
keyFile, passwordFile, executorAddress, stateFile, publicFile. Production additionally
requires bindingFile, databaseFile, publicConfigFile, publicProfileFile.
Scheduler JSON contains scheduler, funding, deliveryJob. Paths are absolute;
keys are encrypted keystores, credentials are referenced files, never inline.

Original production guards, pinned policies/profiles, DB leases and isolated signer
roles remain. QIANQI reuses its original executor binding/advisory lock. The new
journal does not replace the legacy journal. Host lock precedes key loading;
SIGTERM drains the current pass. Never automatically remove crash locks.

After positively verified idle, the supervisor makes no RPC calls until Pons changes,
a deadline arrives or the control interval expires (at most 30 minutes). Restart
always checks state first. Failure backoff is per project. The persistent RPC quota
survives restart; HTTP retries and redirects are disabled. It counts requests, not
provider CU. Successful policy verification is reused only for the same canonical
block; nonce, receipts and payouts are not cached this way.

Signed bytes are persisted before broadcast. Recovery reuses the same raw transaction
and hash; nonce conflict blocks execution. Pons outage prevents new freezes but allows
already frozen obligations to complete. QIANQI captures a fresh cutoff checkpoint
before waiting for finality, preserving the hash beyond 256 blocks. Late purchases
cannot alter frozen participants.

Public API uses local projections, no RPC. QIANQI registry source=pons-api-v1 needs
ponsConfigFile, publicFile, ponsConfigHash (digest of manifest+lifecycle); existing
configHash remains the DB pin. Separate contractVerifiedAt/sourceCheckedAt preserve
honest Last verified: source heartbeat never changes contract time or balances.
Freshness bounds: 31 minutes for contracts, 11 minutes for Pons.

## Validation and limits

Full financial cycles passed through the shared host over local HTTP RPC:

- QIANQI: .local/test-results/qianqi-pons-2026-10-14T11-36-12-476Z/report.json
- v2: .local/test-results/pons-draw-worker-2026-10-14T11-26-07-898Z/report.json
- PostgreSQL projection/heartbeat: .local/test-results/short-projection-2026-10-14T11-31-07-406Z/report.json

Covered both draw kinds, RNG, claims, late purchases, signed-intent recovery,
source outage and no duplicate payout; QIANQI also ages a checkpoint past 256 blocks.
62 imported-runtime tests and targeted budget/guard/API/freshness tests passed.
After the cycles, HTTP 429/30x tests separately verified bounded transport.
Contract harnesses use fixture bootstraps; production configuration and the real
free endpoint have NOT been qualified. This remains a mandatory release check.
