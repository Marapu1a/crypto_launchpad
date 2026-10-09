import test from 'node:test';
import assert from 'node:assert/strict';
import { replayWallet, compareWallet, mergeWalletPages, lifecycleEvents, lifecycleAbi, recognitionAbi, verifyRecognition, firstRecognitions, contentHash, checkedLog } from '../../src/qianqi/ticket-shadow.mjs';
import { shadowRpc } from '../../src/qianqi/shadow-reader.mjs';
const hash = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const addr = n => '0x' + n.toString(16).padStart(40, '0');
const profile = { short: addr(1), monthly: addr(2), recognition: addr(3), token: addr(4), instanceId: hash(90) };
const purchase = (id, blockNumber, amount, entries, extra = {}) => ({ transactionHash: hash(id), blockHash: hash(blockNumber), blockNumber, transactionIndex: 0, logIndex: id, status: 'ELIGIBLE', grossQuoteRaw: amount, entriesMinted: entries, ...extra });
const freeze = (kind = 'SHORT', blockNumber = 5, cutoff = 3) => ({ type: 'FREEZE', kind, blockNumber, transactionIndex: 0, logIndex: 0, cutoff, drawId: hash(kind === 'SHORT' ? 50 : (1n << 255n) + 1n), snapshotHash: hash(100) });
const terminal = (f, blockNumber = 6, outcome = 1) => ({ ...f, type: 'TERMINAL', blockNumber, outcome });
const run = (purchases, events = []) => replayWallet({ wallet: addr(10), purchases, events, thresholdRaw: '100', anchor: 1, head: 20 });
function page(items, extra = {}) {
  return { schema: 'promo-wallet-status-v1', status: 'observed', wallet: addr(10), provenance: { chainId: '4663', anchor: { number: 1, hash: hash(1) }, head: { number: 20, hash: hash(20) }, manifestHash: hash(91), ledgerHash: hash(92) }, balances: run(items).balances, purchases: { items, total: items.length, offset: 0, limit: 100, nextOffset: null }, ...extra };
}
test('carry uses integers, both lanes mint and partial buys preserve epoch 1', () => {
  const result = run([purchase(1, 2, '70', '0'), purchase(2, 3, '250', '3')]);
  assert.equal(result.balances.carryRaw, '20');
  for (const lane of ['SHORT', 'MONTHLY']) assert.equal(result.balances[lane].open, '3');
  assert.equal(run([purchase(1, 2, '1', '0')]).balances.SHORT.byEpoch[0].minted, '0');
});
test('late purchase is minted at confirmation, not original block; terminal consumes only frozen Short', () => {
  const f = freeze();
  const result = run([purchase(1, 2, '100', '1'), purchase(2, 3, '200', '2', { recognition: {}, creditedAt: { blockNumber: 4, transactionIndex: 0, logIndex: 0 } })], [f, terminal(f)]);
  assert.equal(result.balances.SHORT.open, '2'); assert.equal(result.balances.SHORT.consumedTotal, '1');
  assert.equal(result.balances.MONTHLY.open, '3');
});
test('NO_WINNER consumes frozen attempts in Monthly too; lanes can freeze independently', () => {
  const s = freeze(), m = freeze('MONTHLY', 7, 6);
  const result = run([purchase(1, 2, '200', '2')], [s, terminal(s), m, terminal(m, 8, 0)]);
  assert.equal(result.balances.SHORT.consumedTotal, '2'); assert.equal(result.balances.MONTHLY.open, '0');
});
test('pending freeze remains frozen without terminal; later purchases remain open', () => {
  const f = freeze(); const result = run([purchase(1, 2, '100', '1'), purchase(2, 7, '100', '1')], [f]);
  assert.equal(result.balances.SHORT.frozenByDraw[f.drawId].count, '1');
  assert.equal(result.balances.SHORT.open, '1'); assert.equal(result.balances.SHORT.consumedTotal, '0');
});
test('shared confirmation uses stable candidate order for carry', () => {
  const at = { blockNumber: 4, transactionIndex: 0, logIndex: 0 };
  const a = purchase(1, 2, '60', '0', { recognition: {}, creditedAt: at });
  const b = purchase(2, 2, '60', '1', { recognition: {}, creditedAt: at });
  assert.deepEqual(run([b, a]), run([a, b]));
});
test('duplicate purchases cannot inflate totals', () => {
  const p = purchase(1, 2, '100', '1'); assert.throws(() => run([p, p]), /Duplicate purchase/);
});
test('wrong mint count, noneligible credit and backdating stop replay', () => {
  assert.throws(() => run([purchase(1, 2, '100', '2')]), /mint mismatch/);
  assert.throws(() => run([purchase(1, 2, '100', '1', { status: 'WAITING_RECOGNITION' })]), /Unadmitted/);
  assert.throws(() => run([purchase(1, 3, '100', '1', { recognition: {}, creditedAt: { blockNumber: 2 } })]), /outside history/);
  assert.throws(() => run([purchase(1, 3, '100', '1', { transactionIndex: 1, recognition: {}, creditedAt: { blockNumber: 3, transactionIndex: 0, logIndex: 0 } })]), /precedes original/);
});
test('overlap, unmatched terminal and future cutoff stop replay', () => {
  const f = freeze();
  assert.throws(() => run([], [terminal(f)]), /matching freeze/);
  assert.throws(() => run([], [f, { ...f, blockNumber: 6 }]), /overlapping draw/);
  assert.throws(() => run([], [freeze('SHORT', 5, 5)]), /Invalid cutoff/);
});
test('differences include frozen ranges and epoch data, not only open totals', () => {
  const r = run([purchase(1, 2, '100', '1')]); const api = { balances: structuredClone(r.balances) };
  assert.deepEqual(compareWallet(r, api), []);
  api.balances.SHORT.byEpoch[0].lastOpenAttempt = '2';
  assert.deepEqual(compareWallet(r, api), ['SHORT.byEpoch']);
});
test('pagination merges one generation and rejects stale, missing pages, balance drift', () => {
  const p = purchase(1, 2, '100', '1'); const first = page([p]);
  assert.equal(mergeWalletPages([first]).purchases.items.length, 1);
  assert.throws(() => mergeWalletPages([{ ...first, status: 'stale' }]), /unavailable/);
  const partial = { ...first, purchases: { ...first.purchases, total: 2, nextOffset: 1 } };
  assert.throws(() => mergeWalletPages([partial]), /Missing wallet page/);
  const second = structuredClone(first); second.purchases.offset = 1; second.purchases.total = 2;
  second.provenance.head.hash = hash(21);
  assert.throws(() => mergeWalletPages([partial, second]), /Mixed API generation/);
  second.provenance = first.provenance; second.balances.carryRaw = '1';
  assert.throws(() => mergeWalletPages([partial, second]), /balance drift/);
});
function logFor(abi, name, args, address = profile.short) {
  return { ...abi.encodeEventLog(abi.getEvent(name), args), address, blockNumber: '0x5', blockHash: hash(5), transactionHash: hash(60), transactionIndex: '0x0', logIndex: '0x0', removed: false };
}
test('lifecycle decoder rejects wrong lane, kind bit and policy transitions; duplicate delivery is idempotent', () => {
  const log = logFor(lifecycleAbi, 'AttemptsFrozen', [hash(50), 0, 3, hash(3), hash(80), hash(100)]);
  assert.equal(lifecycleEvents([log, log], profile).length, 1);
  assert.throws(() => lifecycleEvents([{ ...log, address: profile.monthly }], profile), /lane emitter/);
  const wrong = logFor(lifecycleAbi, 'AttemptsFrozen', [hash(50), 1, 3, hash(3), hash(80), hash(100)], profile.monthly);
  assert.throws(() => lifecycleEvents([wrong], profile), /kind bit/);
  assert.throws(() => lifecycleEvents([logFor(lifecycleAbi, 'ShortRulesActivated', [1, 2, 6])], profile), /Policy transition/);
});
test('receipt requires success, correct branch and matching raw log', () => {
  const log = logFor(recognitionAbi, 'PurchasesRecognized', [profile.instanceId, hash(101), 1], profile.recognition);
  const receipt = { status: '0x1', blockHash: log.blockHash, blockNumber: log.blockNumber, transactionHash: log.transactionHash, transactionIndex: log.transactionIndex, logs: [log] }, header = { hash: log.blockHash, number: log.blockNumber };
  checkedLog(log, receipt, header);
  assert.throws(() => checkedLog(log, { ...receipt, status: '0x0' }, header), /Failed/);
  assert.throws(() => checkedLog(log, receipt, { ...header, hash: hash(99) }), /Noncanonical/);
  assert.throws(() => checkedLog({ ...log, data: '0x' }, receipt, header), /not in receipt/);
});
test('late bundle commitment binds instance, source, original purchase and confirmation position', () => {
  const p = purchase(1, 2, '100', '1');
  const bundle = { schema: 'purchase-recognition-bundle-v1', chainId: '4663', instanceId: profile.instanceId, token: profile.token, proofs: [{ transactionHash: p.transactionHash, blockHash: p.blockHash }] };
  const bundleHash = contentHash(bundle), log = logFor(recognitionAbi, 'PurchasesRecognized', [profile.instanceId, bundleHash, 1], profile.recognition);
  const creditedAt = Object.fromEntries(['blockNumber', 'blockHash', 'transactionHash', 'transactionIndex', 'logIndex'].map(k => [k, log[k]]));
  Object.assign(p, { recognition: { source: profile.recognition, bundleHash }, creditedAt });
  assert.equal(verifyRecognition(p, bundle, log, profile), 'commitment-linked-not-route-verified');
  assert.throws(() => verifyRecognition(p, { ...bundle, token: addr(9) }, log, profile), /hash mismatch/);
  assert.throws(() => verifyRecognition({ ...p, creditedAt: { ...creditedAt, logIndex: 1 } }, bundle, log, profile), /creditedAt/);
  assert.throws(() => verifyRecognition(p, bundle, log, { ...profile, instanceId: hash(200) }), /instance/);
});
test('reader rejects write and trace methods without transport invocation', () => {
  let calls = 0; const rpc = shadowRpc(() => calls++);
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'debug_traceTransaction']) assert.throws(() => rpc(method, []), /rejected/);
  assert.equal(calls, 0);
});
test('repeated recognition preserves first confirmation and cannot move its cutoff', () => {
  const proof = { transactionHash: hash(10), blockHash: hash(2) };
  const b = { schema: 'purchase-recognition-bundle-v1', chainId: '4663', instanceId: profile.instanceId, token: profile.token, proofs: [proof] };
  const a = logFor(recognitionAbi, 'PurchasesRecognized', [profile.instanceId, contentHash(b), 1], profile.recognition);
  const later = { ...b, proofs: [proof, { transactionHash: hash(11), blockHash: hash(3) }] };
  const c = { ...logFor(recognitionAbi, 'PurchasesRecognized', [profile.instanceId, contentHash(later), 2], profile.recognition), blockNumber: 10 };
  const index = firstRecognitions([{ log: c, bundle: later }, { log: a, bundle: b }], profile);
  assert.equal(index.size, 2); assert.equal(index.get(hash(10)).bundleHash, contentHash(b));
});
test('conflicting original branch in repeated recognition stops the shadow', () => {
  const make = (blockHash, blockNumber) => {
    const bundle = { schema: 'purchase-recognition-bundle-v1', chainId: '4663', instanceId: profile.instanceId, token: profile.token, proofs: [{ transactionHash: hash(10), blockHash }] };
    const log = { ...logFor(recognitionAbi, 'PurchasesRecognized', [profile.instanceId, contentHash(bundle), 1], profile.recognition), blockNumber };
    return { log, bundle };
  };
  assert.throws(() => firstRecognitions([make(hash(2), 5), make(hash(3), 10)], profile), /Conflicting repeated/);
});
