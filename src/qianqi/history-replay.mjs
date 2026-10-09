import { createRequire } from 'node:module';
import { AbiCoder, Interface, id, keccak256 } from 'ethers';
import { check, low, integer, contentHash, replayWallet, checkedLog } from './ticket-shadow.mjs';
const require = createRequire(import.meta.url);
const curve = require('../tickets/direct-curve.cjs'), batch = require('./routes/ordinary-batch.cjs');
const coder = AbiCoder.defaultAbiCoder();
export const participantType = 'tuple(address wallet,uint128 firstAttempt,uint128 lastAttempt)[]';
const requestType = 'tuple(bytes32 drawId,uint64 campaignId,uint64 rulesEpoch,uint256 cutoffBlockNumber,bytes32 cutoffBlockHash,bytes32 snapshotHash,bytes32 expectedRoot,uint256 expectedCount,uint256 expectedAttempts,uint256 budget)';
const rulesType = 'tuple(uint32 version,uint32 pNumerator,uint32 pDenominator,uint32 hNumerator,uint32 hDenominator)';
export const datasetAbi = new Interface([
  `event DatasetProposed(bytes32 indexed proposalId,bytes32 indexed drawId,${requestType} request,${rulesType} rules,uint256[] weights,uint256 minimumUnit)`,
  'event DatasetSealed(bytes32 indexed proposalId,bytes32 indexed drawId,bytes32 context)',
  'event DatasetReady(bytes32 indexed proposalId,bytes32 root,uint256 count,uint256 totalAttempts)',
  'event DatasetChunk(bytes32 indexed proposalId,uint256 indexed index,bytes32 chunkHash,uint256 count)',
  `function publish(bytes32 id,${participantType} data)`,
]);

export function verifyOrdinary({ tx, receipt, block, parent, runtimes }, profile) {
  check(low(tx.blockHash) === low(block.hash) && integer(tx.blockNumber) === integer(block.number) && low(parent.hash) === low(block.parentHash) && integer(parent.number) + 1 === integer(block.number), 'Wrong trade ancestry');
  const member = block.transactions[integer(tx.transactionIndex)];
  check(low(member?.hash ?? member) === low(tx.hash), 'Trade absent from block');
  check(low(receipt.transactionHash) === low(tx.hash) && low(receipt.from) === low(tx.from) && low(receipt.to) === low(tx.to), 'Wrong trade receipt');
  check(receipt.logs.length > 0, 'Empty trade receipt');
  for (const log of receipt.logs) checkedLog(log, receipt, block);
  const self = low(tx.from) === low(tx.to), direct = low(tx.to) === low(profile.curve);
  const context = { ...block, transactions: block.transactions.map(tx => ({ tx })), batchAccounts: { [low(tx.from)]: { code: runtimes[low(tx.from)]?.before, parentHash: parent.hash } } };
  if (self || direct) for (const key of ['factory', 'hook', 'curve', 'token', 'quote', 'registry', ...(self ? ['batchExecutor', 'weth', 'fundingRouter', 'fundingPool'] : [])]) {
    const observed = runtimes[low(profile[key])];
    check(observed && keccak256(observed.at) === profile.codeHashes[key] && keccak256(observed.before) === profile.codeHashes[key], 'Ordinary runtime mismatch');
  }
  const decisions = (self ? batch : curve).decode(profile, tx, receipt, context);
  check(decisions.length === 1 && decisions[0].reason !== 'SELL', 'Expected single ordinary BUY');
  const row = decisions[0];
  if (!self && !direct) return { ...row, status: 'WAITING_RECOGNITION', reason: 'UNREVIEWED_CURVE_ROUTE', observedSender: low(tx.from), entriesMinted: '0' };
  check(row.status === 'ELIGIBLE', 'Ordinary route failed qualification');
  return row;
}

export function snapshotDomain({ registry, source, sourceCodeHash, instanceId, monthlySource, monthlySourceCodeHash, monthlyInstanceId, vault, vaultCodeHash, quote, token, genesisHash, shortRules, monthlyPolicy, monthlyRules }) {
  // genesisHash is read from BuyPolicySource. It is an opaque committed identity,
  // not the hash of a guessed/reformatted deployment manifest.
  return { schema: 'attempt-lifecycle-v4', chainId: '4663', instanceId: low(instanceId), registry: low(registry), source: low(source), sourceCodeHash: low(sourceCodeHash), buyManifestHash: low(genesisHash),
    shortRulesGenesisHash: contentHash({ rulesHash: low(shortRules.rulesHash), noticeSeconds: String(integer(shortRules.noticeSeconds)), startedAt: String(integer(shortRules.startedAt)), firstBlock: String(integer(shortRules.firstBlock)) }),
    drawIdScheme: 'kind-bit-v1', monthlySource: low(monthlySource), monthlySourceCodeHash: low(monthlySourceCodeHash), monthlyInstanceId: low(monthlyInstanceId), vault: low(vault), vaultCodeHash: low(vaultCodeHash), vaultQuote: low(quote), vaultProjectToken: low(token),
    monthlyPolicyHash: contentHash({ rulesHash: low(monthlyPolicy.rulesHash), interval: String(integer(monthlyPolicy.interval)), startedAt: String(integer(monthlyPolicy.startedAt)) }),
    monthlyRulesGenesisHash: contentHash({ rulesHash: low(monthlyPolicy.rulesHash), noticeSeconds: String(integer(monthlyRules.noticeSeconds)), startedAt: String(integer(monthlyPolicy.startedAt)), firstBlock: String(integer(monthlyRules.firstBlock)), interval: String(integer(monthlyPolicy.interval)) }) };
}
export function participantRoot(participants) {
  let root = id('SHORT_DATASET_V1'), prior = 0n;
  for (const p of participants) {
    check(BigInt(p.wallet) > prior && BigInt(p.firstAttempt) > 0n && BigInt(p.lastAttempt) >= BigInt(p.firstAttempt), 'Invalid participant order/range');
    check(BigInt(p.count) === BigInt(p.lastAttempt) - BigInt(p.firstAttempt) + 1n, 'Invalid participant count');
    root = keccak256(coder.encode(['bytes32', 'address', 'uint128', 'uint128'], [root, p.wallet, p.firstAttempt, p.lastAttempt])); prior = BigInt(p.wallet);
  }
  return root;
}
export function fullReplay({ purchases, events, domain, rulesHash, anchor, head }) {
  const byWallet = new Map(), seen = new Set();
  for (const p of purchases) {
    const key = `${p.blockHash}:${p.transactionHash}:${p.logIndex}`; check(!seen.has(key), 'Duplicate history purchase'); seen.add(key);
    if (p.status !== 'ELIGIBLE') { check(p.status === 'WAITING_RECOGNITION', 'Unclassified history purchase'); continue; }
    if (!byWallet.has(low(p.payer))) byWallet.set(low(p.payer), []); byWallet.get(low(p.payer)).push(structuredClone(p));
  }
  const snapshots = new Map(events.filter(e => e.type === 'FREEZE').map(e => {
    check(e.kind === 'SHORT', 'Monthly frozen history requires its dataset verifier');
    return [e.drawId, { schema: 'attempt-snapshot-v4', domain, drawId: e.drawId, kind: 'SHORT', cutoff: { blockNumber: e.cutoff, blockHash: e.cutoffHash }, rulesHash, participants: [], rulesEpoch: '1' }];
  }));
  const wallets = [];
  for (const [wallet, credits] of [...byWallet].sort(([a], [b]) => a.localeCompare(b))) {
    credits.sort((a, b) => {
      const x = a.creditedAt ?? a, y = b.creditedAt ?? b;
      return x.blockNumber - y.blockNumber || x.transactionIndex - y.transactionIndex || x.logIndex - y.logIndex || `${a.blockHash}:${a.transactionHash}:${a.logIndex}`.localeCompare(`${b.blockHash}:${b.transactionHash}:${b.logIndex}`);
    });
    let carry = 0n;
    for (const p of credits) { const total = carry + BigInt(p.grossQuoteRaw); p.entriesMinted = String(total / 100000000n); carry = total % 100000000n; }
    const replay = replayWallet({ wallet, purchases: credits, events, thresholdRaw: '100000000', anchor, head });
    let consumed = 0n; const frozen = new Map();
    for (const transition of replay.transitions) {
      if (transition.type === 'FREEZE') {
        const count = BigInt(transition.count); frozen.set(transition.drawId, count);
        if (count) snapshots.get(transition.drawId).participants.push({ wallet, count: String(count), firstAttempt: String(consumed + 1n), lastAttempt: String(consumed + count) });
      } else consumed += frozen.get(transition.drawId);
    }
    wallets.push(replay);
  }
  const draws = [...snapshots.values()].map(snapshot => {
    const actual = contentHash(snapshot), expected = events.find(e => e.type === 'FREEZE' && e.drawId === snapshot.drawId).snapshotHash;
    return { snapshot, snapshotHash: actual, expectedSnapshotHash: expected, snapshotMatch: actual === expected, root: participantRoot(snapshot.participants), count: snapshot.participants.length, attempts: String(snapshot.participants.reduce((n, p) => n + BigInt(p.count), 0n)) };
  });
  return { wallets, draws };
}
export function verifyDataset(draw, proposed, ready, published) {
  const r = proposed.args.request;
  check(low(proposed.args.drawId) === draw.snapshot.drawId && low(r.drawId) === draw.snapshot.drawId && r.rulesEpoch === 1n, 'Wrong proposed draw');
  check(integer(r.cutoffBlockNumber) === draw.snapshot.cutoff.blockNumber && low(r.cutoffBlockHash) === draw.snapshot.cutoff.blockHash && low(r.snapshotHash) === draw.expectedSnapshotHash, 'Wrong proposed cutoff/snapshot');
  check(low(r.expectedRoot) === draw.root && integer(r.expectedCount) === draw.count && String(r.expectedAttempts) === draw.attempts, 'Proposed dataset mismatch');
  check(low(ready.args.proposalId) === low(proposed.args.proposalId) && low(ready.args.root) === draw.root && integer(ready.args.count) === draw.count && String(ready.args.totalAttempts) === draw.attempts, 'Ready dataset mismatch');
  const rows = published.flatMap(p => p.map(r => ({ wallet: low(r.wallet), firstAttempt: String(r.firstAttempt), lastAttempt: String(r.lastAttempt), count: String(r.lastAttempt - r.firstAttempt + 1n) })));
  check(contentHash(rows) === contentHash(draw.snapshot.participants), 'Published participants mismatch');
  check(draw.snapshotMatch, 'Lifecycle snapshot hash mismatch');
  return true;
}
