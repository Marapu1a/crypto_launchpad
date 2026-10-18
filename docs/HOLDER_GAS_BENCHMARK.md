# Holder gas benchmark — 2026-10-19

Local managed vault benchmark, PASS. Synthetic allocations; all transfers on Hardhat only.

Source: HEAD `2b5d3d191cef969ed6c2e5a3107227b714273fdd` plus current working package; compiler/settings/source hashes in the report.
Build hash: `0x5cc2d5573abc20668a762116b9a5f140252880b77ade3027cbb8b20eb6675a4d`.
Report: `.local/test-results/holder-gas-2026-10-18T21-16-08-153Z/report.json` (ignored local evidence).
Reproduce: `npm run benchmark:holder-gas`.

| Holders | Measured allocation gas | Publication transactions | Estimated allocation + all existing-EOA payouts | ETH at hypothetical 0.01 gwei |
|---:|---:|---:|---:|---:|
| 10 | 623,554 | 3 | 1,420,467 | 0.00001420 |
| 100 | 3,120,681 | 3 | 10,964,042 | 0.00010964 |
| 500 | 14,424,665 | 7 | 53,585,638 | 0.00053586 |
| 1000 | 28,554,888 | 12 | 106,852,859 | 0.00106853 |
| 5000 | 141,596,876 | 52 | 533,030,847 | 0.00533031 |

Allocation was executed in full for every size, chunks of at most 100. Payout totals are extrapolated from three measured samples per size, not 5,000 executed transfers. Small calldata byte differences can change estimates. First round includes initial storage costs; subsequent sealing is cheaper.

## Interpretation

- One recurring payout to an existing EOA measured about 78,300 gas; a never-funded EOA about 100,150. Contract recipients were not benchmarked and may require more gas or reject payment.
- Positive dust allocations still write an entitlement per wallet every period. Waiting avoids transfers and does not require monthly consolidate calls, but does not eliminate publication costs.
- Twelve allocations of 0.00005 ETH accumulated to 0.0006 ETH per wallet. Payment below the 0.0005 minimum reverted without losing debt. Combined settlement of 12 periods measured 418,601 gas; separate consolidation and payment measured 374,832 + 70,761 gas (samples differ in first-payment state).
- Numbers in ETH are arithmetic scenarios, not a current network quote. Multiply by ten at 0.1 gwei. Deployment, Pons snapshot collection, RPC charges and any network-specific fee components are excluded. Do not derive a production spending limit from these local figures.

## Operational limit found

`reconcileHolderExecution` currently reads the entire transaction journal with default budget 200 and maximum 2,000, then rejects overflow. This is a cumulative history limit, not a per-month holder cap. A 5,000-wallet all-paid round requires 52 publication transactions + 5,000 payments and cannot be fully reconciled by that path. Multiple smaller rounds eventually hit the same limit. This limitation was subsequently addressed by the paged reconciliation path described in [PW_OPERATOR](PW_OPERATOR.md). The benchmark itself predates that change.

Contract technical limits remain 5,000 recipients per round, 100 per append, 100 periods per claim; these are not a prize/fund ceiling. This benchmark does not validate PostgreSQL throughput or snapshot completeness.

## Next step

Keep approved monthly periods and minimum payout unchanged. Add bounded resumable reconciliation and an owner-visible cost preview using actual network estimates before production execution. Display publication cost and eligible-payment cost separately; do not consolidate dust eagerly. No spending threshold was approved or introduced.
