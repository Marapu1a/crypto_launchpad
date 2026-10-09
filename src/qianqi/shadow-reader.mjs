import { Interface, keccak256 } from 'ethers';
import { inspectQianqi } from './readonly-inventory.mjs';
import { check, low, integer, canonical, contentHash, snapshotIdentity, mergeWalletPages, checkedLog, lifecycleAbi, recognitionAbi, lifecycleEvents, verifyRecognition, firstRecognitions, replayWallet, compareWallet, shadowLimits } from './ticket-shadow.mjs';

export const qianqiProfile = Object.freeze({
  token: '0x6ea39a23aa46e51ca6cd2d1cbc0b5bfb29ecb216',
  short: '0xa631f7845af257daee0b9f6ff744334294ce6846',
  monthly: '0x3ee0c608815ec5a621f330fb8899ed31fe682393',
  recognition: '0xd084329f25de50afd68b154cafac6a8d7046f97f',
  instanceId: '0x8a6a507aae35a2981afdf8e3637d013b5736b70a6621355254d55ccdc0a3da12',
  cohortBundle: '0xdae264c33beb742e7335d759c3989e2ef6c5e7a0f572cf85fc5237df8623ce7c',
});
const methods = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getLogs', 'eth_getTransactionReceipt']);
export function shadowRpc(transport) {
  return (method, params) => { check(methods.has(method), 'Read-only shadow RPC method rejected'); return transport(method, params); };
}
async function parallel(items, fn, concurrency = 4) {
  const results = new Array(items.length); let next = 0;
  // Await every active worker even on failure so no reads escape the run lifetime.
  const settled = await Promise.allSettled(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  const failed = settled.find(x => x.status === 'rejected'); if (failed) throw failed.reason;
  return results;
}
export async function collectTicketShadow({ rpc: transport, getJson, progress = () => {}, profile = qianqiProfile }) {
  const rpc = shadowRpc(transport);
  const bundles = new Map(), blocks = new Map(), receipts = new Map();
  function memo(map, key, fn) { if (!map.has(key)) map.set(key, fn()); return map.get(key); }
  const block = height => memo(blocks, integer(height), async () => {
    const result = await rpc('eth_getBlockByNumber', ['0x' + integer(height).toString(16), false]);
    check(integer(result.number) === integer(height), 'RPC returned wrong block'); return result;
  });
  const receipt = hash => memo(receipts, low(hash), async () => {
    const result = await rpc('eth_getTransactionReceipt', [hash]);
    check(low(result.transactionHash) === low(hash), 'RPC returned wrong receipt'); return result;
  });
  const bundle = hash => memo(bundles, low(hash), async () => {
    check(/^0x[0-9a-f]{64}$/.test(low(hash)), 'Invalid bundle identifier');
    const value = await getJson(`/evidence/purchases/${low(hash)}.json`);
    check(contentHash(value) === low(hash), 'Public bundle integrity mismatch'); return value;
  });
  progress('Collect public cohort and same-generation wallet pages');
  const cohort = await bundle(profile.cohortBundle);
  check(cohort.proofs.length > 0 && cohort.proofs.length <= 50 && low(cohort.token) === profile.token && low(cohort.instanceId) === profile.instanceId && String(cohort.chainId) === '4663', 'Unexpected cohort');
  // Initial public cohort gives only an anchor hint. Discover all source commitments
  // up to that API head, including later native batches, without copying server state.
  const seed = await getJson(`/v1/wallets/${low(cohort.proofs[0].trace.from)}?limit=1`);
  snapshotIdentity(seed);
  const range = seed.provenance;
  check(range.head.number - range.anchor.number <= 6000000, 'History range budget exceeded');
  const confirmationLogs = await rpc('eth_getLogs', [{ address: profile.recognition, topics: [recognitionAbi.getEvent('PurchasesRecognized').topicHash], fromBlock: '0x' + (range.anchor.number + 1).toString(16), toBlock: '0x' + range.head.number.toString(16) }]);
  check(Array.isArray(confirmationLogs) && confirmationLogs.length > 0 && confirmationLogs.length <= 100, 'Confirmation history budget exceeded');
  const confirmations = await parallel(confirmationLogs, async log => {
    check(integer(log.blockNumber) > range.anchor.number && integer(log.blockNumber) <= range.head.number, 'Confirmation outside history');
    checkedLog(log, await receipt(log.transactionHash), await block(log.blockNumber));
    return { log, bundle: await bundle(recognitionAbi.parseLog(log).args.bundleHash) };
  });
  const firstCredits = firstRecognitions(confirmations, profile);
  const addresses = [...new Set([...firstCredits.values()].map(c => low(c.proof.trace.from)))].sort();
  check(addresses.length <= 200, 'Wallet cohort budget exceeded');
  const overview = await getJson('/v1/overview?limit=1');
  const wallets = await parallel(addresses, async address => {
    const pages = []; let offset = 0;
    for (let i = 0; i < 100; i++) {
      const page = await getJson(`/v1/wallets/${address}?offset=${offset}&limit=100`);
      check(low(page.wallet) === address, 'Wrong API wallet'); pages.push(page);
      if (page.purchases?.nextOffset === null) return mergeWalletPages(pages);
      check(Number.isSafeInteger(page.purchases?.nextOffset) && page.purchases.nextOffset > offset, 'Invalid API pagination'); offset = page.purchases.nextOffset;
    }
    throw Error('Wallet page budget exceeded');
  });
  const identity = snapshotIdentity(wallets[0]);
  check(identity === snapshotIdentity(seed), 'Discovery/wallet generation mismatch; rerun required');
  check(wallets.every(w => snapshotIdentity(w) === identity), 'Mixed wallet generations; rerun required');
  const { head, anchor, ledgerHash, manifestHash } = wallets[0].provenance;
  check(canonical(overview.provenance.head) === canonical(head) && overview.provenance.ledgerHash === ledgerHash && overview.provenance.manifestHash === manifestHash, 'Overview/wallet generation mismatch; rerun required');
  check(head.number - anchor.number <= 6000000, 'History range budget exceeded');
  const inventory = await inspectQianqi({ overview, rpc, short: profile.short });
  check(inventory.contracts.monthly.address === profile.monthly && inventory.contracts.token.address === profile.token, 'QIANQI contract mismatch');
  check(low((await block(anchor.number)).hash) === low(anchor.hash), 'Wrong anchor');
  const getters = new Interface([
    ...['currentShortEpoch', 'currentMonthlyEpoch', 'drainingShortEpoch', 'drainingMonthlyEpoch'].map(n => `function ${n}() view returns(uint64)`),
    'function instanceId() view returns(bytes32)',
  ]);
  for (const [target, names] of [[profile.short, ['currentShortEpoch', 'drainingShortEpoch']], [profile.monthly, ['currentMonthlyEpoch', 'drainingMonthlyEpoch']]]) {
    for (const [index, name] of names.entries()) {
      const value = getters.decodeFunctionResult(name, await rpc('eth_call', [{ to: target, data: getters.encodeFunctionData(name) }, '0x' + head.number.toString(16)]))[0];
      check(value === (index === 0 ? 1n : 0n), 'Only genesis epoch supported');
    }
  }
  const sourceInstance = getters.decodeFunctionResult('instanceId', await rpc('eth_call', [{ to: profile.recognition, data: getters.encodeFunctionData('instanceId') }, '0x' + head.number.toString(16)]))[0];
  check(low(sourceInstance) === profile.instanceId, 'Wrong recognition binding');
  progress('Read bounded lifecycle logs and verify receipts/cutoff headers');
  const logs = [];
  // One address and one topic per query avoids public-RPC OR-filter range limits.
  // Keep the overall 6M-block / 1000-event budget; never scan every empty block.
  for (const address of [profile.short, profile.monthly]) for (const fragment of lifecycleAbi.fragments) {
    const rows = await rpc('eth_getLogs', [{ address, topics: [fragment.topicHash], fromBlock: '0x' + (anchor.number + 1).toString(16), toBlock: '0x' + head.number.toString(16) }]);
    check(Array.isArray(rows) && logs.length + rows.length <= 1000 && rows.every(l => integer(l.blockNumber) > anchor.number && integer(l.blockNumber) <= head.number), 'Invalid lifecycle log range');
    logs.push(...rows);
  }
  await parallel(logs, async log => checkedLog(log, await receipt(log.transactionHash), await block(log.blockNumber)));
  const events = lifecycleEvents(logs, profile);
  for (const event of events.filter(e => e.type === 'FREEZE')) check(low((await block(event.cutoff)).hash) === event.cutoffHash, 'Wrong cutoff hash');
  progress('Link purchases and late confirmations; replay both lanes');
  let lateCredits = 0, purchases = 0;
  const results = await parallel(wallets, async api => {
    check(api.balances.entryThresholdRaw === '100000000' && api.balances.quoteDecimals === 6, 'Unexpected QIANQI entry policy');
    const records = [];
    for (const p of api.purchases.items) {
      purchases++;
      const r = await receipt(p.transactionHash), b = await block(p.blockNumber);
      const log = r.logs.find(l => integer(l.logIndex) === integer(p.logIndex));
      check(log && low(p.blockHash) === low(log.blockHash), 'Purchase log missing'); checkedLog(log, r, b);
      check(integer(p.blockNumber) === integer(log.blockNumber), 'Wrong purchase height');
      const record = { ...p, transactionIndex: integer(r.transactionIndex) };
      if (p.recognition) {
        check(p.creditedAt, 'Recognition position missing');
        const c = p.creditedAt, cr = await receipt(c.transactionHash), cb = await block(c.blockNumber);
        const cl = cr.logs.find(l => integer(l.logIndex) === integer(c.logIndex)); check(cl, 'Recognition log missing'); checkedLog(cl, cr, cb);
        verifyRecognition(p, await bundle(p.recognition.bundleHash), cl, profile); lateCredits++;
        const first = firstCredits.get(low(p.transactionHash));
        check(first && first.bundleHash === low(p.recognition.bundleHash) && low(first.log.transactionHash) === low(c.transactionHash) && integer(first.log.logIndex) === integer(c.logIndex), 'First recognition position mismatch');
      }
      records.push(record);
    }
    const replay = replayWallet({ wallet: api.wallet, purchases: records, events, thresholdRaw: api.balances.entryThresholdRaw, anchor: anchor.number, head: head.number });
    return { ...replay, differences: compareWallet(replay, api), purchaseCount: records.length, lateCount: records.filter(p => p.recognition).length };
  });
  for (const [tx, credit] of firstCredits) {
    const api = wallets.find(w => low(w.wallet) === low(credit.proof.trace.from));
    check(api?.purchases.items.some(p => low(p.transactionHash) === tx && p.status === 'ELIGIBLE' && p.recognition), 'Committed purchase not indexed in cohort API');
  }
  // Same historical branch at end; API may advance after acquisition without invalidating it.
  for (const [height, promise] of blocks) {
    const before = await promise, after = await rpc('eth_getBlockByNumber', ['0x' + height.toString(16), false]);
    check(low(after.hash) === low(before.hash), 'Historical branch changed during read');
  }
  const finalHead = await rpc('eth_getBlockByNumber', ['0x' + head.number.toString(16), false]);
  check(low(finalHead.hash) === low(head.hash), 'Pinned head changed during read');
  const matched = results.every(r => r.differences.length === 0);
  return { schema: 'qianqi-accounting-shadow-v1', status: matched ? 'ACCOUNTING_MATCH' : 'ACCOUNTING_MISMATCH', executionEligible: false, independentBuyReplay: false,
    profile, provenance: { head, anchor, ledgerHash, manifestHash, cohortBundle: profile.cohortBundle }, inventory,
    counts: { wallets: wallets.length, purchases, lateCredits, lifecycleEvents: events.length, confirmationBatches: confirmations.length, uniqueConfirmedPurchases: firstCredits.size },
    confirmations: confirmations.map(c => ({ block: integer(c.log.blockNumber), transactionHash: c.log.transactionHash, bundleHash: contentHash(c.bundle), purchases: c.bundle.proofs.length })),
    wallets: results, events, limits: shadowLimits };
}
