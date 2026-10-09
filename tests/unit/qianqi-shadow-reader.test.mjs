import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface, keccak256 } from 'ethers';
import { collectTicketShadow } from '../../src/qianqi/shadow-reader.mjs';
import { contentHash, recognitionAbi, lifecycleAbi } from '../../src/qianqi/ticket-shadow.mjs';
import { inventoryAbi } from '../../src/qianqi/readonly-inventory.mjs';

const h = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const a = n => '0x' + n.toString(16).padStart(40, '0');
function fixture(options = {}) {
  const profile = { short: a(1), monthly: a(3), token: a(5), recognition: a(7), instanceId: h(90) };
  const wallet = a(10), head = { number: 20, hash: h(20) }, anchor = { number: 1, hash: h(1) };
  const bundle = { schema: 'purchase-recognition-bundle-v1', chainId: '4663', instanceId: profile.instanceId, token: profile.token, proofs: [{ transactionHash: h(102), blockHash: h(2), trace: { from: wallet } }] };
  profile.cohortBundle = contentHash(bundle);
  const log = (block, address, abi, name, args) => ({ ...abi.encodeEventLog(abi.getEvent(name), args), address, blockNumber: block, blockHash: h(block), transactionHash: h(100 + block), transactionIndex: 0, logIndex: 0, removed: false });
  const confirmation = log(4, profile.recognition, recognitionAbi, 'PurchasesRecognized', [profile.instanceId, profile.cohortBundle, 1]);
  const frozen = log(5, profile.short, lifecycleAbi, 'AttemptsFrozen', [h(50), 0, 4, h(4), h(80), h(100)]);
  const consumed = log(6, profile.short, lifecycleAbi, 'AttemptsConsumed', [h(50), 0, h(100), 1, h(70)]);
  const purchaseLog = { address: a(9), data: '0x', topics: [h(2)], blockNumber: 2, blockHash: h(2), transactionHash: h(102), transactionIndex: 0, logIndex: 0, removed: false };
  const credit = Object.fromEntries(['blockNumber', 'blockHash', 'transactionHash', 'transactionIndex', 'logIndex'].map(k => [k, confirmation[k]]));
  const purchase = { ...Object.fromEntries(['blockNumber', 'blockHash', 'transactionHash', 'logIndex'].map(k => [k, purchaseLog[k]])), status: 'ELIGIBLE', grossQuoteRaw: '150000000', entriesMinted: '1', recognition: { source: profile.recognition, bundleHash: profile.cohortBundle }, creditedAt: credit };
  function balance(open, consumed) { return { mintedTotal: '1', open, consumedTotal: consumed, frozenByDraw: {}, byEpoch: [{ epoch: '1', minted: '1', open, consumed, frozen: '0', firstOpenAttempt: open === '1' ? '1' : null, lastOpenAttempt: open === '1' ? '1' : null }] }; }
  const api = { schema: 'promo-wallet-status-v1', status: 'observed', wallet, provenance: { chainId: '4663', anchor, head, manifestHash: h(91), ledgerHash: h(92) },
    balances: { carryRaw: options.drift ? '1' : '50000000', entryThresholdRaw: '100000000', quoteDecimals: 6, SHORT: balance('0', '1'), MONTHLY: balance('1', '0') },
    purchases: { items: [purchase], offset: 0, limit: 100, total: 1, nextOffset: null } };
  const reserves = { freeShort: '0', freeCurrent: '0', freeNext: '0', nextStartTarget: '100', reserved: '0', claimable: '0', balance: '0' };
  const overview = { schema: 'promo-overview-v1', status: 'observed', asset: { address: a(4), decimals: 6, codeHash: keccak256('0x6000') }, reserves, provenance: api.provenance,
    draws: { SHORT: { earliestAt: '30' }, MONTHLY: { earliestAt: '50', minimumRaw: '100' } } };
  const abi = new Interface([...inventoryAbi.fragments,
    ...['currentShortEpoch', 'currentMonthlyEpoch', 'drainingShortEpoch', 'drainingMonthlyEpoch'].map(n => `function ${n}() view returns(uint64)`), 'function instanceId() view returns(bytes32)']);
  let headReads = 0;
  const rpc = async (method, params) => {
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_getCode') return '0x6000';
    if (method === 'eth_getBlockByNumber') {
      const number = params[0] === 'finalized' ? 21 : Number(BigInt(params[0]));
      if (number === 20) headReads++;
      return { number, hash: options.reorg && number === 20 && headReads === 3 ? h(999) : h(number) };
    }
    if (method === 'eth_call') {
      assert.equal(params[1], '0x14'); const call = abi.parseTransaction({ data: params[0].data });
      const values = { datasetVault: a(2), monthlyVault: a(2), shortController: profile.short, monthlyController: profile.monthly, quoteToken: a(4), projectToken: profile.token, randomProvider: a(6), decimals: 6, ...reserves,
        balanceOf: 0, SHORT_INTERVAL: 20, lastShortTerminalAt: 10, monthlyInterval: 40, lastMonthAt: 10, minimumMonthlyBudget: 100, currentShortEpoch: 1, currentMonthlyEpoch: 1, drainingShortEpoch: 0, drainingMonthlyEpoch: 0, instanceId: profile.instanceId };
      return abi.encodeFunctionResult(call.name, [values[call.name]]);
    }
    if (method === 'eth_getLogs') {
      if (options.logFailure) throw Error('Log source unavailable');
      const f = params[0]; assert.equal(f.fromBlock, '0x2'); assert.equal(f.toBlock, '0x14');
      return [confirmation, frozen, consumed].filter(l => l.address === f.address && l.topics[0] === f.topics[0]);
    }
    if (method === 'eth_getTransactionReceipt') {
      const l = [confirmation, frozen, consumed, purchaseLog].find(l => l.transactionHash === params[0]); assert.ok(l);
      return { status: '0x1', transactionHash: options.wrongReceipt ? h(999) : l.transactionHash, transactionIndex: 0, blockNumber: l.blockNumber, blockHash: l.blockHash, logs: [l] };
    }
    throw Error('Unexpected RPC method');
  };
  let walletCalls = 0;
  const getJson = async path => {
    if (path.startsWith('/evidence/')) return bundle;
    if (path.startsWith('/v1/overview')) return overview;
    walletCalls++;
    if (options.generation && walletCalls > 1) return { ...api, provenance: { ...api.provenance, ledgerHash: h(999) } };
    return api;
  };
  return { rpc, getJson, profile };
}
test('full collector links raw evidence, replays lanes and marks result non-executable', async () => {
  const result = await collectTicketShadow(fixture());
  assert.equal(result.status, 'ACCOUNTING_MATCH'); assert.equal(result.executionEligible, false); assert.equal(result.independentBuyReplay, false);
  assert.deepEqual(result.counts, { wallets: 1, purchases: 1, lateCredits: 1, lifecycleEvents: 2, confirmationBatches: 1, uniqueConfirmedPurchases: 1 });
});
test('API balance drift produces an explicit mismatch', async () => {
  const result = await collectTicketShadow(fixture({ drift: true }));
  assert.equal(result.status, 'ACCOUNTING_MISMATCH'); assert.deepEqual(result.wallets[0].differences, ['carryRaw']);
});
test('collector fails on mixed API generation, unavailable logs or changed historical head', async () => {
  await assert.rejects(collectTicketShadow(fixture({ generation: true })), /generation mismatch/);
  await assert.rejects(collectTicketShadow(fixture({ logFailure: true })), /unavailable/);
  await assert.rejects(collectTicketShadow(fixture({ reorg: true })), /head changed/);
  await assert.rejects(collectTicketShadow(fixture({ wrongReceipt: true })), /wrong receipt/);
});
