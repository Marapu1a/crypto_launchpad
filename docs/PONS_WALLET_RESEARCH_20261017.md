# Wallet monitoring: observed Pons surface, 2026-10-17

Read-only research at local HEAD ef1b8fd plus uncommitted monitor review fixes.
No signer, RPC, follow mutation, subscription creation or recurring collector used.
Private evidence: `.local/pons-wallet-research-20261017/` (HTML, bundles,
source hashes, ticks.json and wallet-trades.json). These are point observations,
not a supported API contract or evidence of completeness/latency SLA.

## Confirmed technical surfaces

- `GET https://ponsfamily.com/api/launches/ticks`: public 200 JSON with block,
  at, ticks, swaps. Curve ticks include trader, curve, buy/sell side, raw quote,
  token amount, fee/tax, transaction-derived id, block and logIndex. Sample contains
  buys and sells. Pool swaps in this response lack trader and side, so cannot
  independently power wallet subscriptions. Token/quote mapping is also needed.
- Frontend chunk `3g8aq3mv6o70m.js` polls ticks every 1000ms when active,
  5000ms after errors, maintains a local 90-second merge window. This does NOT
  establish server retention or guarantee lossless polling at any frequency.
- `GET /api/profile/{address}?view=trades`: public 200 for
  0x15d24b87794b22c283138149560136fce2e0aca1; keys items, updatedAt.
  Items include kind, timestamp, token/symbol/name, amountTokens, valueUsd,
  txHash, counterparty. No pagination cursor in this observed response.
  Completeness, row cap, event identity within one tx and venue coverage unverified.
  Another address from ticks timed out after 15 seconds; no load test performed.
- Dynamically loaded chunk `2wm56c_upkyuv.js` polls profile trades every 60s,
  staleTime 30s. Follow counters/list use GET `/api/follows` and `/api/follows/list`;
  changing follows uses POST. No existing follow relationships were changed.
- No market websocket/SSE confirmed in inspected frontend paths. Not proof that
  no such API exists. Own watchlists do not require mirroring Pons follows.

## Permission versus availability

[Terms](https://ponsfamily.com/terms), sections 11/13, prohibit abusive scraping,
infrastructure overload, bypassing access controls and evading rate limits.
No numeric third-party HTTP quota or wallet-stream SLA found on reviewed pages.
Frontend polling intervals are observations, not permission for our deployment.
[Docs](https://docs.ponsfamily.com/#terms-and-attribution) describe onchain data as
public, request lowercase pons attribution/link, prohibit implied endorsement;
this is not an explicit license for unrestricted reuse of their offchain API.
[Builders](https://ponsfamily.com/builders) offers an integration contact path.
No inquiry sent. Ask about supported wallet history, pagination/retention,
allowed aggregate polling, caching/redistribution and a stream/webhook option.

## Proposed architecture, not implemented

Use existing token snapshots for bounded activity rankings and own watchlists.
Explore ONE shared fresh-trades reader for curve buy/sell notifications, plus
less frequent per-address history reconciliation where coverage is established.
Deduplicate subscriptions globally, budget requests, back off on failures,
persist events before delivery, and expose gaps. Do not promise all wallet
activity or instantaneous delivery. Pool wallet attribution remains unresolved.
Before choosing a 5/10/30-second interval, measure event retention, loss and lag
with a bounded experiment and obtain clarity on supported aggregate usage.

## Bounded follow-up experiment — 2026-10-17, 12:02 MSK onward

Evidence: `.local/pons-wallet-research-20261017/probe-20261017T090255Z/`.
Scripts `probe.py`, `compare.py`, `coverage.py` in its parent. 23 GET requests:
12 ticks, 2 initial profiles, 1 launch list, 1 token history, 1 further profile,
2 profile parameter variants, 4 token-history comparisons. No recurring job left.

- Twelve ticks responses over about 27 seconds, 2-second pauses plus request time.
  All HTTP 200, 0.394–0.454s per response. Nineteen distinct curve events observed.
  Included event timestamps were 0–4s behind response `at`. Some adjacent sets
  had no overlap; this alone does not prove missing events between responses.
- Keeping only snapshots 0/4/8 (roughly one every ten seconds) retains 7 of those
  19 events. This is a subsampling result, not a universal loss rate. It directly
  demonstrates that a slow ticks-only collector can miss events in this sample.
  The frontend's 90-second local buffer is not server-side replay retention.
- Four token histories reached before the experiment boundary. Within the
  internal comparison interval they contained 5 events; all 5 matched ticks IDs.
  These few tokens/events do not establish global stream completeness.
- One active address timed out after 18s. Another ordinary observed address,
  `0x24a4d86c8a76b00ee9566ed9c9ff4f0c3faf0da7`, returned 60 rows in 2.68s:
  26 buys and 34 sells. Its observed tick transaction was present in history.
  `limit=1` and `cursor=1` returned the same 60 items, unchanged. Supported
  pagination remains unknown; these particular parameters did not paginate.
- A second successful history (the burn address) also returned 60 rows and
  matched two tick transactions. It is NOT a human-trader example: the appearance
  of a burn address as `trader` requires us to describe addresses as reported by
  Pons, not infer a signer or beneficial owner. The frontend uses
  txHash/token/kind for profile-row keys; multiple same-kind logs in a transaction
  may be aggregated. Wallet event deduplication needs this distinction.

Practical revision: use ticks only as an optional fast hint, with bounded history
reconciliation for watched addresses. A low-rate history-only prototype can show
buys/sells already, but must mark outages and avoid promising full backfill beyond
the returned tail. Request rates, maximum tail size, post-graduation coverage,
webhooks and supported cursor contracts still need provider clarification.
