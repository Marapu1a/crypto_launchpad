# Event-driven servicing: 2026-10-14

Implemented locally after production release c75fdb9; not deployed by this change.
Applies to both QIANQI and draw-v2 (IGW and future tokens).

## Wake policy

Pons accounting collection continues every five minutes. After a successful pass
proves there are no executable obligations, the shared supervisor sleeps without
an elapsed-time RPC deadline. No 30-minute reconciliation remains.

A changed Pons business report wakes one service pass. The report batches all
new trades; twenty small purchases in one report cause one wake, not twenty.
Sales also count as activity because they can generate creator fees. A source
heartbeat alone does not wake the executor. There is no arbitrary minimum volume,
wallet count or hype threshold in this first policy: eligible purchases are not
held back waiting for a popularity signal. Financial accounting continues in the
existing guarded pass on each changed report.

Concrete draw deadlines are retained only after funding checks succeed. An
underfunded draw does not wake merely because its scheduled time arrives.
Unfinished transactions, RNG, claims, uncertain jobs and failed publication never
receive permission to sleep. A restart discards in-memory idle permission and
reconciles durable state once. This is also the current manual wake mechanism.

An unavailable/stale/corrupt Pons report does not trigger RPC for a proven-idle
project; it reports source-unavailable and stops refreshing the public heartbeat.
When the same fresh report returns, sleep continues. Pending work and due
obligations retain their normal recovery path even during a source outage.

## Public data

An eventIdle proof is attached only to a successful, classified idle pass.
Fresh Pons heartbeat plus this proof permits an old saved contract observation to
remain usable while waiting for activity. The original contractVerifiedAt is
never advanced by a Pons heartbeat. contractStale separately exposes its age;
awaitingActivity explains the service state. Missing source, invalid observation,
expired concrete deadline or absence of an idle proof retains stale behaviour.
Neither API performs RPC for visitors.

## Boundaries

A direct treasury transfer or other outside contract change without Pons activity
will not be discovered automatically. This includes operator-side settlement of
post-graduation Pons fees without a changed trade report. Request a manual service restart after such
an operation. The existing collector supplies trade reports, not a separate
graduation-status feed: this change does not claim graduation-only wake detection.
No contracts, payout proportions, entry thresholds or historical tickets changed.
Threshold-based suppression across multiple reports would additionally require
separating immediate public ticket updates from financial execution; it is not
silently introduced here.

Tests cover two days of quiet operation, batched small trades, source outage and
recovery, due deadlines, independent projects, pending/unknown work, publication
failure and restart, and honest public timestamps. Full controller-cycle results are recorded below.

## Validation evidence

- 26 targeted unit/operational checks passed across service wake decisions,
  freshness/public rendering, host loop, runtime admission/budget, API registry
  and existing monitoring.
- QIANQI controller rehearsal passed: Short and Monthly publication, RNG,
  settlement, payouts, crash recovery, preserved late/unused tickets and explicit
  outside-epoch reconciliation. Result:
  `.local/test-results/qianqi-pons-2026-10-14T15-10-19-633Z/report.json`.
- These are local modeled-chain checks; they do not measure live free-tier usage.

- Draw-v2 rehearsal passed in Short-only, Monthly-only and combined modes: fee
  collection, persistent signed-intent recovery, late purchases outside frozen
  sets, settlement and payouts during Pons outage, no duplicate payouts on restart.
  Result: .local/test-results/pons-draw-worker-2026-10-14T15-10-19-590Z/report.json .
