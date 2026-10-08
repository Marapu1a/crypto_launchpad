import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZeroAddress } from 'ethers';
import { initialDraft, normalizeDraft, minimumOutput, encodeLaunch, percentBps, simulatePlan } from '../../src/pons/plan.mjs';
import { FACTORY, ROUTER, DIRECT, NETWORK } from '../../src/pons/client.mjs';
import { sendLocal, assertLocalFork, reconcileJournal } from '../../src/pons/local-execution.mjs';
const account = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const terms = { observedAt: new Date().toISOString(), cap: 1000, curveFeeBps: 100, economics: '0x' + 'ab'.repeat(32), fee: 500000000000000n, configId: 0,
  quote: { address: ZeroAddress, decimals: 18 } };
const draft = extra => ({ ...initialDraft(), name: 'Test Token', symbol: 'test', logo: 'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee', ...extra });
test('Native atomic buy carries fee plus buy and a protected minimum', () => {
  const input = normalizeDraft(draft({ creatorFee: '3.25', openingBuy: '0.1' }), terms, account);
  const tx = encodeLaunch(input, terms, account, 123n);
  const decoded = ROUTER.decodeFunctionData('launchAndBuy', tx.data);
  assert.equal(tx.value, 100500000000000000n); assert.equal(decoded[0].creatorTaxBps, 325n);
  assert.equal(decoded[0].expectedEconomics, terms.economics); assert.equal(decoded[4], 123n);
  assert.equal(decoded[5], account);
});
test('ERC20 amount uses quote decimals, tx value contains only launch fee', () => {
  const pair = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
  const t = { ...terms, quote: { address: pair, decimals: 6 } };
  const input = normalizeDraft(draft({ pair, openingBuy: '12.345678' }), t, account);
  assert.equal(input.amount, 12345678n); assert.equal(encodeLaunch(input, t, account, 1n).value, terms.fee);
  assert.throws(() => normalizeDraft(draft({ pair, openingBuy: '0.0000001' }), t, account));
});
test('Holders starts with account as recipient; buyback is separate', () => {
  const input = normalizeDraft(draft({ destination: 'holders', feeWallet: 'invalid' }), terms, account);
  assert.equal(input.params.creatorFeeRecipient, account); assert.equal(input.params.buybackEnabled, false);
  const decoded = FACTORY.decodeFunctionData(DIRECT, encodeLaunch(input, terms, account).data);
  assert.equal(decoded[0].creatorFeeRecipient, account); assert.equal(decoded[3].length, 0);
});
test('Fees are configurable and bounded, decimal parsing is exact', () => {
  assert.equal(percentBps('0.01'), 1); assert.equal(percentBps('10'), 1000);
  for (const creatorFee of ['10.01', '-1', '1e1', '0.001', 'NaN']) assert.throws(() => normalizeDraft(draft({ creatorFee }), terms, account));
});
test('Reject zero recipient, unsafe URL, invalid CID and wrong pair snapshot', () => {
  for (const extra of [{ feeWallet: ZeroAddress }, { website: 'javascript:alert(1)' }, { logo: 'blob:local' }, { pair: account }]) assert.throws(() => normalizeDraft(draft(extra), terms, account));
});
test('Social handles normalize and exact launch salt survives encoding', () => {
  const d = draft({ twitter: '@test_user', telegram: 'https://t.me/testgroup' });
  const p = normalizeDraft(d, terms, account);
  assert.equal(p.params.socials.twitter, 'https://x.com/test_user'); assert.equal(p.params.socials.telegram, 'https://t.me/testgroup');
  assert.equal(FACTORY.decodeFunctionData(DIRECT, encodeLaunch(p, terms, account).data)[0].salt, d.salt);
});
test('Snipe exemptions reject duplicates and do not silently truncate', () => {
  assert.throws(() => normalizeDraft(draft({ exemptions: account + ',' + account }), terms, account));
  const entries = Array.from({ length: 32 }, (_, i) => '0x' + (i + 1).toString(16).padStart(40, '0')).join(',');
  assert.equal(normalizeDraft(draft({ exemptions: entries }), terms, account).exemptions.length, 32);
  assert.throws(() => normalizeDraft(draft({ exemptions: entries, openingBuy: '1' }), terms, account));
});
test('Tiny output and simulation failures cannot fall back to minOut=0', async () => {
  assert.equal(minimumOutput(1000n, 200), 980n); assert.throws(() => minimumOutput(1n, 200));
  const d = draft({ openingBuy: '1' });
  const plan = { steps: [], input: normalizeDraft(d, terms, account), terms, account };
  await assert.rejects(() => simulatePlan({ call: async () => { throw Error('RPC unavailable'); } }, plan), /RPC unavailable/);
});
test('Local sender rejects mainnet even on localhost', async () => {
  await assert.rejects(() => assertLocalFork({ _getConnection: () => ({ url: 'http://127.0.0.1:8545' }), getNetwork: async () => ({ chainId: 4663n }) }), /31337/);
  await assert.rejects(() => assertLocalFork({ _getConnection: () => ({ url: NETWORK.rpc }) }), /локальный/);
});
function fakeProvider() {
  return { _getConnection: () => ({ url: 'http://127.0.0.1:8545' }), getNetwork: async () => ({ chainId: 31337n }),
    send: async () => ({ forkedNetwork: { chainId: 4663 }, instanceId: 'test-instance' }), call: async () => '0x', getTransactionCount: async () => 4,
    getSigner: async () => ({ getAddress: async () => account, sendTransaction: async () => { throw Error('transport timeout'); } }),
  };
}
test('Transport timeout persists unknown intent and blocks retry', async () => {
  const journal = [], states = [], p = fakeProvider();
  await assert.rejects(() => sendLocal(p, account, { to: NETWORK.factory, value: 0n, data: '0x' }, journal, async () => states.push(journal.at(-1).state), 'launch'), /timeout/);
  assert.deepEqual(states, ['requesting', 'unknown']); assert.equal(journal[0].nonce, 4);
  await assert.rejects(() => sendLocal(p, account, {}, journal, async () => {}, 'launch'), /предыдущей/);
});
test('Storage failure before broadcast prevents sending', async () => {
  const p = fakeProvider(); let sent = false;
  p.getSigner = async () => ({ getAddress: async () => account, sendTransaction: async () => { sent = true; } });
  await assert.rejects(() => sendLocal(p, account, {}, [], async () => { throw Error('storage full'); }, 'launch'), /storage full/);
  assert.equal(sent, false);
});
test('Reconciliation checks transaction content, not only success', async () => {
  const p = fakeProvider(); p.getTransactionReceipt = async () => ({ status: 1 });
  p.getTransaction = async () => ({ from: account, nonce: 4, to: NETWORK.factory, data: '0xab', value: 0n });
  const journal = [{ state: 'unknown', hash: '0x123', instanceId: 'test-instance', account, nonce: 4, request: { to: NETWORK.factory, data: '0xcd', value: '0' } }];
  await assert.rejects(() => reconcileJournal(p, journal, async () => {}), /не соответствует/); assert.equal(journal[0].state, 'unknown');
});
test('Journal from a previous fork cannot authorize another send', async () => {
  const journal = [{ state: 'confirmed', instanceId: 'old-fork' }];
  await assert.rejects(() => sendLocal(fakeProvider(), account, {}, journal, async () => {}, 'launch'), /другому экземпляру/);
});
test('Explicit rejection is distinguishable from unknown transport result', async () => {
  const p = fakeProvider(), journal = [];
  p.getSigner = async () => ({ getAddress: async () => account, sendTransaction: async () => { throw Object.assign(Error('rejected'), { code: 'ACTION_REJECTED' }); } });
  await assert.rejects(() => sendLocal(p, account, {}, journal, async () => {}, 'launch'), /rejected/);
  assert.equal(journal[0].state, 'rejected');
});
