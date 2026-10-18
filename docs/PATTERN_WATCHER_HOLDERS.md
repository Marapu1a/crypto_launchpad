# Pattern Watcher: holder rewards research

2026-10-17. Read-only research; proposals below are not approved financial terms.

## Evidence

Current Pons create page and its public JS downloaded to
`.local/research/holders-20261017/`; `sources.json` records URLs and SHA-256.

- https://ponsfamily.com/launchpad/create
- https://ponsfamily.com/_next/static/immutable/chunks/32bddvvd6atnl.js
- https://ponsfamily.com/_next/static/immutable/chunks/0be5c-jqjpi48.js
- https://docs.ponsfamily.com/v2

Current UI states that Holders routes all creator fees to holders, weighted by
amount and holding duration, requires two confirmations after launch, and is
permanent. This is a UI statement, not a verified implementation audit.

Current frontend still calls `createFor(token)`, resolves `distributorOf(token)`,
then `transferCreatorFeeRecipient(token, distributor)`. Factory mapping:
`0x70e95CC5f03DB2906081E7a8D16e4C4209291507` on chain 4663 for factory
`0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`.

Read ABI includes unallocated quote/coin balances and epochs with Merkle root,
totals, claimed amounts, expiry and rollover. This indicates round-based claim
accounting; it does not establish an automatic push to every holder.

Exact weighting, exclusions, cadence, thresholds, proof publication and actual
upgrade permissions remain unverified. Earlier [fee-flow research](PONS_FEE_FLOW.md)
found unavailable implementation sources; that historical limitation has not
been resolved here. No live contract storage or source re-audit performed today.

The documented fee recipient is a single address. Choosing Holders cannot also
send the same entire creator stream to our draw collector. A partial allocation
would require proven splitter/distributor compatibility, not an assumed toggle.

## Our implementation options

Keep the common Pons servicing model and claim actual received creator fees into
an isolated token collector. Allocate by an explicitly approved policy between
holder rewards, monthly draw, and operations. Do not distribute anticipated fees
or reuse reserved funds. No percentages decided.

1. Fixed-period holder snapshot: easiest initial implementation. Allocate the
   funded round proportionally to eligible balances at the recorded snapshot.
   Exclude curve/pool/burn and agreed system addresses. Timing can be gamed;
   it rewards holding at the snapshot, not continuous holding.
2. Balance-time weighting: fairer to sustained holders, but needs complete
   transfers/balance history and handling of gaps. Buy/sell history alone cannot
   prove holding duration. Periodic samples are only an approximation and must
   be labelled as such. Do not promise this before data coverage is established.

Pons holder API is a candidate source, not verified complete/available here.
The earlier portfolio endpoint returned 403; do not assume equivalent holder
enumeration is usable. A round must defer on missing pages rather than allocate
only among the visible top holders. For onchain balance checks use bounded free
RPC requests around settlement, not constant empty-block scans.

For few holders, resumable batch payments are simplest. Persist round/address/
amount/transaction status and reconcile pending transactions before retrying.
For many recipients, cumulative claim balances or Merkle claims can avoid paying
gas repeatedly for dust. These require an additional payout contract and explicit
trust/accounting rules. Carry tiny amounts forward; do not silently drop them.

Monthly draws can use the same eligible snapshot but require separate randomness,
fund reservation and probability rules. One address = one chance is vulnerable
to splitting holdings. The existing purchase-ticket rule is not automatically a
holder-based rule. Reuse infrastructure, implement eligibility separately.

Service discount remains a separate check: any positive balance of an approved
token at purchase time, as previously agreed; no balance-time index required.

Recommended next investigation: prove full holder pagination and settlement
balance availability, then compare the cost of snapshots versus historical
tracking. No financial implementation or launch changes yet.
