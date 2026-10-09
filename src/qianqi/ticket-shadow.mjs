import { Interface, isAddress, isHexString, keccak256, toUtf8Bytes } from 'ethers';

// Accounting shadow only. API admission is an input, never an execution authority.
export const shadowLimits = Object.freeze([
  'API selects purchases and supplies admission, payer and amounts; route proofs are not replayed',
  'Wallet cohort is bounded; missing purchases or wallets are not independently detected',
  'RPC log selection and canonicality are trusted, not consensus proofs',
  'Global snapshot hashes, RNG, payouts and policy scheduling are not recomputed',
  'Epoch 1 only; any policy transition stops this adapter',
  'No database import, signing, financial execution or worker handoff',
]);
export const lifecycleAbi = new Interface([
  'event AttemptsFrozen(bytes32 indexed drawId,uint8 indexed kind,uint256 cutoffBlockNumber,bytes32 cutoffBlockHash,bytes32 rulesHash,bytes32 snapshotHash)',
  'event AttemptsConsumed(bytes32 indexed drawId,uint8 indexed kind,bytes32 snapshotHash,uint8 outcome,bytes32 resultHash)',
  'event ShortRulesAnnounced(uint64 indexed epoch,bytes32 rulesHash,uint256 eligibleAt)',
  'event ShortRulesActivated(uint64 indexed oldEpoch,uint64 indexed newEpoch,uint256 firstNewBlock)',
  'event ShortEpochEmpty(uint64 indexed epoch,uint256 cutoffBlockNumber,bytes32 cutoffBlockHash,bytes32 snapshotHash)',
  'event MonthlyRulesAnnounced(uint64 indexed epoch,bytes32 rulesHash,uint256 eligibleAt)',
  'event MonthlyRulesActivated(uint64 indexed oldEpoch,uint64 indexed newEpoch,uint256 firstNewBlock)',
  'event MonthlyEpochEmpty(uint64 indexed epoch,uint256 cutoffBlockNumber,bytes32 cutoffBlockHash,bytes32 snapshotHash)',
]);
export const recognitionAbi = new Interface([
  'event PurchasesRecognized(bytes32 indexed instanceId,bytes32 indexed bundleHash,uint256 count)',
]);
export function check(ok, message) { if (!ok) throw Error(message); }
export const low = x => String(x).toLowerCase();
export function integer(x) { const n = Number(BigInt(x)); check(Number.isSafeInteger(n) && n >= 0, 'Invalid integer'); return n; }
function raw(x) { check(typeof x === 'string' && /^(0|[1-9][0-9]*)$/.test(x), 'Invalid raw amount'); return BigInt(x); }
export function canonical(x) {
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
  return JSON.stringify(x);
}
export const contentHash = x => keccak256(toUtf8Bytes(canonical(x)));
export function snapshotIdentity(page) {
  const p = page.provenance;
  check(page.schema === 'promo-wallet-status-v1' && page.status === 'observed' && p?.chainId === '4663', 'Wallet API unavailable or wrong chain');
  check(isAddress(page.wallet) && isHexString(p.head?.hash, 32) && isHexString(p.anchor?.hash, 32), 'Invalid API provenance');
  integer(p.head.number); integer(p.anchor.number);
  check(p.anchor.number < p.head.number && isHexString(p.manifestHash, 32) && isHexString(p.ledgerHash, 32), 'Invalid API generation');
  return canonical({ chainId: p.chainId, anchor: p.anchor, head: p.head, manifestHash: p.manifestHash, ledgerHash: p.ledgerHash });
}
export function mergeWalletPages(pages) {
  check(pages.length > 0, 'Missing wallet pages');
  const first = pages[0], identity = snapshotIdentity(first), items = [];
  for (const page of pages) {
    check(snapshotIdentity(page) === identity && low(page.wallet) === low(first.wallet), 'Mixed API generation');
    check(canonical(page.balances) === canonical(first.balances), 'API balance drift');
    const p = page.purchases;
    check(Number.isSafeInteger(p.total) && p.total >= 0 && p.total <= 10000 && p.total === first.purchases.total && p.offset === items.length, 'Invalid pagination');
    check(Array.isArray(p.items) && p.items.length <= p.limit && p.limit <= 100 && p.limit > 0, 'Invalid page size');
    items.push(...p.items);
    check(items.length <= p.total && p.nextOffset === (items.length < p.total ? items.length : null), 'Incomplete pagination');
    check(p.nextOffset === null || p.items.length > 0, 'Non-progressing pagination');
  }
  check(items.length === first.purchases.total && pages.at(-1).purchases.nextOffset === null, 'Missing wallet page');
  return { ...first, purchases: { ...first.purchases, items, nextOffset: null } };
}
const position = x => [integer(x.blockNumber), integer(x.transactionIndex), integer(x.logIndex)];
const order = (a, b) => { const x = position(a), y = position(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
export function checkedLog(log, receipt, header) {
  check(BigInt(receipt.status) === 1n && !log.removed, 'Failed or removed receipt');
  check(low(log.blockHash) === low(header.hash) && integer(log.blockNumber) === integer(header.number), 'Noncanonical log');
  check(low(receipt.blockHash) === low(header.hash) && integer(receipt.blockNumber) === integer(header.number), 'Receipt block mismatch');
  check(low(receipt.transactionHash) === low(log.transactionHash) && integer(receipt.transactionIndex) === integer(log.transactionIndex), 'Receipt transaction mismatch');
  const matches = receipt.logs.filter(x => integer(x.logIndex) === integer(log.logIndex));
  const evidence = x => ({ address: low(x.address), data: low(x.data), topics: x.topics.map(low), blockHash: low(x.blockHash), transactionHash: low(x.transactionHash), ...Object.fromEntries(['blockNumber', 'transactionIndex', 'logIndex'].map(k => [k, integer(x[k])])) });
  check(matches.length === 1 && canonical(evidence(matches[0])) === canonical(evidence(log)), 'Log is not in receipt');
}
function decodeCanonical(abi, log) {
  const event = abi.parseLog(log); check(event, 'Unknown event');
  const encoded = abi.encodeEventLog(event.fragment, event.args);
  check(low(encoded.data) === low(log.data) && canonical(encoded.topics.map(low)) === canonical(log.topics.map(low)), 'Noncanonical event encoding');
  return event;
}
export function lifecycleEvents(logs, profile) {
  const seen = new Map();
  return logs.flatMap(log => {
    check([profile.short, profile.monthly].map(low).includes(low(log.address)), 'Wrong lifecycle emitter');
    const key = `${low(log.blockHash)}:${low(log.transactionHash)}:${integer(log.logIndex)}`;
    if (seen.has(key)) { check(seen.get(key) === canonical(log), 'Conflicting duplicate log'); return []; }
    seen.set(key, canonical(log));
    const e = decodeCanonical(lifecycleAbi, log);
    check(['AttemptsFrozen', 'AttemptsConsumed'].includes(e.name), 'Policy transition unsupported');
    const kind = ['SHORT', 'MONTHLY'][integer(e.args.kind)];
    check(kind && low(log.address) === low(kind === 'SHORT' ? profile.short : profile.monthly), 'Wrong lane emitter');
    check(Number(BigInt(e.args.drawId) >> 255n) === (kind === 'SHORT' ? 0 : 1), 'Wrong draw kind bit');
    check(BigInt(e.args.drawId) !== 0n && BigInt(e.args.snapshotHash) !== 0n, 'Empty draw identity');
    const row = { ...Object.fromEntries(['blockNumber', 'transactionIndex', 'logIndex'].map(k => [k, integer(log[k])])), kind, drawId: low(e.args.drawId), snapshotHash: low(e.args.snapshotHash) };
    if (e.name === 'AttemptsFrozen') return [{ ...row, type: 'FREEZE', cutoff: integer(e.args.cutoffBlockNumber), cutoffHash: low(e.args.cutoffBlockHash) }];
    check(e.args.outcome <= 1n && BigInt(e.args.resultHash) !== 0n, 'Invalid terminal');
    return [{ ...row, type: 'TERMINAL', outcome: integer(e.args.outcome) }];
  }).sort(order);
}
export function verifyRecognition(purchase, bundle, log, profile) {
  const e = decodeCanonical(recognitionAbi, log);
  check(low(log.address) === low(profile.recognition) && low(purchase.recognition.source) === low(profile.recognition), 'Wrong recognition source');
  check(low(e.args.instanceId) === low(profile.instanceId), 'Wrong recognition instance');
  check(contentHash(bundle) === low(e.args.bundleHash) && low(purchase.recognition.bundleHash) === low(e.args.bundleHash), 'Recognition bundle hash mismatch');
  check(bundle.schema === 'purchase-recognition-bundle-v1' && String(bundle.chainId) === '4663' && low(bundle.token) === low(profile.token) && low(bundle.instanceId) === low(profile.instanceId), 'Wrong bundle domain');
  check(e.args.count > 0n && e.args.count <= 50n && bundle.proofs.length === Number(e.args.count), 'Wrong bundle count');
  check(new Set(bundle.proofs.map(p => low(p.transactionHash))).size === bundle.proofs.length, 'Duplicate bundle purchase');
  check(bundle.proofs.some(p => low(p.transactionHash) === low(purchase.transactionHash) && low(p.blockHash) === low(purchase.blockHash)), 'Purchase absent from bundle');
  const c = purchase.creditedAt;
  check(c && ['blockNumber', 'transactionIndex', 'logIndex'].every(k => integer(c[k]) === integer(log[k])) && low(c.blockHash) === low(log.blockHash) && low(c.transactionHash) === low(log.transactionHash), 'Wrong creditedAt');
  check(integer(c.blockNumber) >= integer(purchase.blockNumber), 'Backdated recognition');
  return 'commitment-linked-not-route-verified';
}

export function firstRecognitions(confirmations, profile) {
  const first = new Map();
  for (const { log, bundle } of [...confirmations].sort((a, b) => order(a.log, b.log))) {
    const bundleHash = contentHash(bundle);
    for (const proof of bundle.proofs) {
      const synthetic = { ...proof, blockNumber: 0, recognition: { source: profile.recognition, bundleHash }, creditedAt: log };
      verifyRecognition(synthetic, bundle, log, profile);
      const key = low(proof.transactionHash), prior = first.get(key);
      if (prior) { check(low(prior.proof.blockHash) === low(proof.blockHash), 'Conflicting repeated recognition'); continue; }
      first.set(key, { log, proof, bundleHash });
    }
  }
  return first;
}

export function replayWallet({ wallet, purchases, events, thresholdRaw, anchor, head }) {
  check(isAddress(wallet) && integer(anchor) < integer(head), 'Invalid replay domain');
  const threshold = raw(thresholdRaw); check(threshold > 0n, 'Zero threshold');
  const seen = new Set(), credits = [], entries = {};
  for (const p of purchases) {
    const id = `4663:${low(p.blockHash)}:${low(p.transactionHash)}:${integer(p.logIndex)}`;
    check(!seen.has(id), 'Duplicate purchase'); seen.add(id);
    check(integer(p.blockNumber) > anchor && integer(p.blockNumber) <= head, 'Purchase outside history');
    check(['ELIGIBLE', 'WAITING_RECOGNITION', 'INELIGIBLE', 'UNSUPPORTED_ROUTE', 'AMBIGUOUS'].includes(p.status), 'Unknown purchase status');
    if (p.status !== 'ELIGIBLE') { check(raw(p.entriesMinted ?? '0') === 0n, 'Unadmitted credit'); continue; }
    check(!p.recognition || p.creditedAt, 'Late credit has no confirmation position');
    check(!p.creditedAt || p.recognition, 'Unbound credit position');
    const at = p.creditedAt ?? p;
    check(integer(at.blockNumber) >= integer(p.blockNumber) && integer(at.blockNumber) <= head, 'Credit outside history');
    check(order(at, p) >= 0, 'Credit precedes original purchase');
    credits.push({ ...at, type: 'MINT', id, amount: raw(p.grossQuoteRaw), expected: raw(p.entriesMinted) });
  }
  credits.sort((a, b) => order(a, b) || a.id.localeCompare(b.id));
  let carry = 0n, minted = 0n;
  for (const credit of credits) {
    const total = carry + credit.amount; credit.count = total / threshold; carry = total % threshold;
    check(credit.count === credit.expected, 'Per-purchase mint mismatch'); entries[credit.id] = String(credit.count);
  }
  const lanes = Object.fromEntries(['SHORT', 'MONTHLY'].map(k => [k, { open: 0n, consumed: 0n, frozen: null, pending: null, lastTerminal: anchor }]));
  const drawIds = new Set(), history = [], transitions = [];
  for (const e of [...credits, ...events].sort((a, b) => order(a, b) || (a.id ?? '').localeCompare(b.id ?? ''))) {
    check(integer(e.blockNumber) > anchor && integer(e.blockNumber) <= head, 'Event outside history');
    if (e.type === 'MINT') {
      minted += e.count; history.push({ block: integer(e.blockNumber), minted });
      for (const s of Object.values(lanes)) s.open += e.count;
    } else {
      const s = lanes[e.kind]; check(s, 'Unknown lane');
      if (e.type === 'FREEZE') {
        check(!drawIds.has(e.drawId) && !s.pending, 'Duplicate or overlapping draw');
        check(e.cutoff >= s.lastTerminal && e.cutoff < e.blockNumber, 'Invalid cutoff');
        const atCutoff = history.filter(h => h.block <= e.cutoff).at(-1)?.minted ?? 0n;
        const count = atCutoff - s.consumed; check(count >= 0n && count <= s.open, 'Cutoff balance conflict');
        s.open -= count;
        s.frozen = { count, first: s.consumed + 1n, last: atCutoff };
        s.pending = e; drawIds.add(e.drawId);
        transitions.push({ kind: e.kind, drawId: e.drawId, type: e.type, count: String(count), cutoff: e.cutoff });
      } else {
        check(e.type === 'TERMINAL' && s.pending?.drawId === e.drawId && s.pending.snapshotHash === e.snapshotHash && [0, 1].includes(e.outcome), 'Terminal without matching freeze');
        s.consumed += s.frozen.count; s.frozen = null; s.pending = null; s.lastTerminal = e.blockNumber;
        transitions.push({ kind: e.kind, drawId: e.drawId, type: e.type, outcome: e.outcome });
      }
    }
    for (const s of Object.values(lanes)) check(minted === s.open + s.consumed + (s.frozen?.count ?? 0n) && s.open >= 0n, 'Ticket conservation failed');
  }
  const balances = { carryRaw: String(carry), entryThresholdRaw: thresholdRaw, quoteDecimals: 6 };
  for (const [kind, s] of Object.entries(lanes)) {
    const frozen = s.frozen?.count ?? 0n;
    balances[kind] = { mintedTotal: String(minted), open: String(s.open), consumedTotal: String(s.consumed),
      frozenByDraw: frozen ? { [s.pending.drawId]: { count: String(frozen), firstAttempt: String(s.frozen.first), lastAttempt: String(s.frozen.last) } } : {},
      byEpoch: credits.length ? [{ epoch: '1', minted: String(minted), consumed: String(s.consumed), frozen: String(frozen), open: String(s.open), firstOpenAttempt: s.open ? String(minted - s.open + 1n) : null, lastOpenAttempt: s.open ? String(minted) : null }] : [] };
  }
  return { wallet: low(wallet), balances, entries, transitions };
}
export function compareWallet(result, api) {
  const differences = [];
  for (const key of ['carryRaw', 'entryThresholdRaw', 'quoteDecimals']) if (result.balances[key] !== api.balances[key]) differences.push(key);
  for (const lane of ['SHORT', 'MONTHLY']) {
    for (const key of ['mintedTotal', 'open', 'consumedTotal', 'frozenByDraw']) if (canonical(result.balances[lane][key]) !== canonical(api.balances[lane][key])) differences.push(`${lane}.${key}`);
    // Legacy API may omit byEpoch for wallets with no mint. Nonempty epochs must match.
    const actual = api.balances[lane].byEpoch ?? [];
    const expected = result.balances[lane].byEpoch;
    if (canonical(expected) !== canonical(actual)) differences.push(`${lane}.byEpoch`);
  }
  return differences;
}
