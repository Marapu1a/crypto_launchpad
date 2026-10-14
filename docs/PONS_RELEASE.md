# Pons release procedure

2026-10-14. Local candidate only; activation is a separate owner-approved release.
Implementation and evidence: [PONS_RUNTIME](PONS_RUNTIME.md).

Latest deployment: [2026-10-14 activated release, verification and limits](PONS_RELEASE_20261014.md).

1. Pin release files/checksums. Back up server DB, journals, bindings and registry.
   Keep legacy indexer/automation/draw/sandbox-check disabled, including existing
   zzzz-rpc-disabled.conf overrides. Never probe QuickNode.
2. Fill ops/pons-runtime templates with server-owned paths and actual project IDs.
   Do not copy keys or production journals into the repo. One OS user owns the
   shared budget (0600). API can read only a separate public directory and the
   non-secret scheduler config, never signer journals/keystores. Keep DB roles.
3. Select a free HTTPS RPC and exact hostname allowlist. Set a conservative request
   quota from its actual limits (not CU, not a guarantee of free capacity).
   Initialize once: node scripts/init-rpc-budget.mjs FILE MAX_REQUESTS WINDOW_MS.
   Runtime and inspection share this file; never reset it to recover a worker.
4. Start only the Pons collector. Check both reports for freshness/completeness.
   Reconcile migration against latest legacy journal and controller state. Preserve
   all old credits and consumed tickets; never replace live state with test fixtures.
   For QIANQI, prepare a server-local evidence file with {lifecycle,legacyCredits,
   rewards,legacyRpcIdentity}; the first three are the exact migration inputs.
   legacyRpcIdentity contains the original RPC origin and endpointHash (ethers.id
   of the original URL), never its credential-bearing URL. No request to that
   endpoint is made. Pin journals offline using:
   node scripts/prepare-pons-handoff.mjs ABS_CONFIG PROJECT_ID ABS_EVIDENCE ABS_NEW_OUTPUT
   Set the QIANQI entry.handoffFile to that output. This does not qualify the state.
5. With executors stopped, run as service user:
   node scripts/inspect-pons-runtime.mjs CONFIG NEW_REPORT
   This read-only command loads no keys, sends no transactions, uses the shared
   budget and checks chain/finality, profile/policy, state, source and leases.
   blocked forbids activation. Pending/frozen legacy jobs require explicit import.
   QIANQI inspection is for the FIRST migration from migrationFile, not re-migration
   over an existing new journal. Qualify the real endpoint before enabling sends.
   New state/.rng/.scheduler paths and their locks/temp files must be absent.
   Legacy parent/RNG/scheduler identities and checksums must match the handoff
   pins and original config/profile; active jobs/cutoffs/intents block migration.
   Completed planner jobs need matching consumed draws and canonical terminal
   checkpoints. Pending nonce, controller jobs or unpaid vault rewards also block.
   Any existing new journal requires a separate resume/reconciliation procedure;
   never delete it to make first-migration inspection pass.
   A retained scheduler checkpoint may be explicitly listed in evidence as
   retainedCheckpoints: [{kind,candidate:{number,hash},disposition:'preserve-history-only'}].
   Inspector accepts it only when canonical, checkpointed, covered by the migration
   boundary, later than all terminal jobs of that kind, with no active/pending
   controllers or unpaid rewards. It is kept in handoff evidence, never resumed
   as a job and never removed from the original journal. Unknown cutoffs still block.
6. After qualification and config review, set allowPublicTransactions=true and
   create the runtime activation marker. Verify both first passes, journals,
   receipts, quota and public snapshots. Switch QIANQI API registry to pons-api-v1;
   v2 retains its existing projection table. Check sites, tickets, balance and
   Last verified. Never re-enable old financial workers alongside the new host.
7. Observe idle control: no scan/trace/recognition, no RPC on sleeping ticks,
   periodic control still runs. Source outage and exhausted quota remain visible
   in health; heartbeat cannot make stale contract data look newly verified.

Rollback: stop the new runtime and preserve its latest DB/journals. Reverting API
or web code is not a financial-state rollback. Do not restart an old worker against
an old snapshot after new transactions. Reconcile receipts and nonce first. Do not
clear intents or budget. Remove a crash lock only after proving no owner remains.

Templates are NOT installed VPS configuration. Replace every @...@ placeholder.
The example quota is illustrative, not a provider recommendation. Existing secrets
stay on the server. No paid service or automatic gas top-up is introduced.
