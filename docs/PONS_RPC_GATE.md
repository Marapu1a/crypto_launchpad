# RPC gate and Pons service loop

**2026-10-14 release candidate:** shared production composition and persistent RPC gate implemented locally; both host financial cycles passed. Not deployed. Current scope, test limits and next release procedure: [PONS_RUNTIME](PONS_RUNTIME.md), [PONS_RELEASE](PONS_RELEASE.md). Earlier pending/rehearsal-only statuses below describe previous checkpoints and are superseded by this paragraph. QuickNode and old production workers remain disabled.

Local implementation, 2026-10-14. No production restart or QuickNode requests.

`server/shared/rpc-gate.cjs` provides a shared request queue and optional request
quota. `short-runtime/start.mjs` shares it across primary/read/trace transports,
including startup checks and projection. Failed requests consume quota; rejected
requests never reach HTTP. Batches consume one unit per element. No send retries.

Optional runtime configuration (format example, not a recommended budget):

```json
{"rpcBudget":{"file":"/var/lib/launchpad/rpc-budget.json","maxRequests":1000,"windowMs":3600000}}
```

Without this setting existing pacing remains unchanged. Exhaustion throws
`RPC_BUDGET_EXHAUSTED`. Health exposes `rpcBudget` counters. Windows start at gate
creation and reset on the first request after expiry. Clock rollback cannot reset
the counter. **This is an in-memory per-process request limit, not a persistent
account-wide CU allowance when `file` is omitted. Restart resets that in-memory
variant; other processes are not included.**

With `file`, `server/shared/rpc-budget.cjs` reserves quota under an exclusive file
lock before HTTP dispatch. All participating processes must use the SAME absolute
file and policy. Both short-runtime and the QIANQI public entrypoint accept
`rpcBudget`; QIANQI gates `_send`, including network detection and batch elements.
File reservations survive restart; failed sends are not refunded. Missing,
corrupt or mismatched state refuses requests. This counts requests, not provider CU.
Unconfigured processes and other machines are outside this limit.

Initialize once, while services are stopped (example values only):

```sh
node scripts/init-rpc-budget.mjs /var/lib/launchpad/rpc-budget.json 1000 3600000
```

The parent directory must exist and be writable by the service user; initialization
refuses an existing file. Use local storage, not a network filesystem. Writes use
fsync and atomic rename; POSIX additionally fsyncs the directory. A crash after
reservation may waste quota but cannot refund a potentially sent request. An
abandoned `.lock` is never automatically removed: stop all consumers, verify no
owner remains, retain the budget file, then remove only the lock. Never delete or
reinitialize a budget to recover a worker. Snapshot counters are the last locally
observed reservation, not a live global view. Pending transaction journals are
untouched; quota exhaustion does not cancel or prove failure of a sent transaction.

`server/shared/pons-service-loop.mjs` accepts per-token supervisors as `{id,tick}`,
polls them sequentially and writes a local heartbeat. Projection belongs inside
the supervisor, so sleeping ticks do not refresh contract snapshots. One failed
token does not stop another; when all fail, polling backs off. Heartbeat must use
local I/O only and must not update contract Last verified timestamps.

The loop hosts both createPonsDrawService and createPonsSchedulerSupervisor through
[PONS_RUNTIME](PONS_RUNTIME.md). Per-project failure backoff prevents one active
token from accelerating a failed token. HTTP retries and redirects are disabled
in the shared runtime transport: each reservation permits one HTTP attempt.
All budget consumers must use the same OS user (budget files are mode 0600).
The legacy entrypoint is not a substitute for the new host; its independent readers
are outside the new-host guarantee. Old production services remain disabled.

Validation includes concurrent child-process quota reservations, exhausted-budget
restarts, missing/corrupt state, lock collisions, policy mismatch, clock rollback,
failed requests and HTTP 429/301/302/307/308 without hidden network retries.
Full host transaction recovery and both financial cycles passed; evidence and
production qualification limits are recorded in PONS_RUNTIME.md.
