# Pons holder source: bounded live probe

18 October 2026, 08:31–08:33 UTC. Source checkout `a5cd33d`.
Read-only public HTTP; no RPC, signing, payouts or production changes.

## Confirmed observations

Current Pons frontend uses
`https://balancesapi.ponsfamily.com/v1/tokens/{token}/holders?limit=50`
and follows `next_cursor` using the `cursor` query parameter.

- IGW `0x341849f168833f7578c6e03a7b3ee9ebc471082f`: HTTP 200,
  one terminal page, 3 distinct addresses, reported holder count 3.
  Includes one address labelled `curve`, so holder count is not participant count.
  Integer balances sum exactly to reported supply `1000000000000000000000000000`.
- PONS `0x39dbed3a2bd333467115de45665cc57f813c4571`: 12 pages of
  50 rows, 600 distinct addresses, continuing cursor. Reported count 103,598.
  All sampled pages have the same reported count and `as_of` values.
  Stopped at the explicit 12-page budget; this is NOT full enumeration.
  Labels include burn, Uniswap v3 pool and v4 pool manager.
- Observed response: token, holders, supply, as_of, page, next_cursor, cached.
  Rows include wallet, exact integer balance string, floating-point share, label.
  Calculations should use integer balance, never rounded share.
- `as_of` was `{rollup_bucket:91620000,tail_from_block:91630000}`.
  These names do NOT prove a precise snapshot block or finality. No block hash,
  final indexed tail height or documented atomic multi-page snapshot was established.
- A separate `limit=1` request using the Python default user agent returned 403;
  stopped that probe. Subsequent normal `limit=50` requests used the same browser
  user agent as the successful initial probe. Both query and user agent changed:
  the cause of the 403 is therefore UNKNOWN. No credential/cookie bypass used.

## Evidence

Private original responses and request URLs/time/SHA-256:
- `.local/research/holder-source-20261018T083131Z/`
- `.local/research/holder-pages-20261018T083249Z/`

Current frontend scripts saved with hashes in the first directory. Research
scripts are private `.local/probe-holder-source.py` and `.local/holder-pagination.py`.
Earlier portfolio 403 does not prove this holder endpoint is unavailable.

## Design implication, not activation

Pons can supply a paginated holder inventory; no need to begin by rebuilding
all transfers ourselves. For small tokens, an inventory costs roughly
ceil(holder count / 50) HTTP requests, plus any validation/retry work. This is
not a claim that all token sizes or snapshots have been fully tested.

Candidate collector should enforce a request budget, unique addresses/cursors,
matching token and metadata, terminal cursor, integer values and count/supply
reconciliation before claiming complete coverage. Preserve the original pages;
if checks fail, do not calculate rewards for only the visible subset.

Still unresolved: exact snapshot semantics during active transfers, API freshness,
stable pagination under changing balances, documented excluded addresses, and
historical snapshot access. Stable as_of alone is insufficient evidence.
API labels are useful hints, not the final eligibility policy. Excluding all
contracts would also exclude legitimate smart wallets.

Next research: confirm the source's snapshot semantics and observe a complete
multi-page, moderately sized token. If exact chain-block snapshots are required,
evaluate bounded free-RPC balance checks plus a complete address universe; checking
known balances alone cannot discover omitted holders. Financial rules remain open.

Observed first PONS cursor is a decimal balance followed by an address, separated by an underscore. It contains no visible snapshot identifier. This suggests balance/address pagination, but server-side snapshot behavior is not established by cursor shape alone.
