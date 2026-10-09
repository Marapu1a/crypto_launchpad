import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'ethers';
import { inspectQianqi, readonlyRpc, inventoryAbi as abi } from '../../src/qianqi/readonly-inventory.mjs';

const address = n => '0x' + n.toString(16).padStart(40, '0');
function fixture(change = {}) {
  const reserves = { freeShort: '10', freeCurrent: '20', freeNext: '30', nextStartTarget: '100', reserved: '2', claimable: '3', balance: '65' };
  const overview = { schema: 'promo-overview-v1', status: 'observed', asset: { address: address(4), decimals: 6, codeHash: keccak256('0x6000') }, reserves,
    provenance: { chainId: '4663', head: { number: 10, hash: '0xabc' } }, draws: { SHORT: { earliestAt: '30' }, MONTHLY: { earliestAt: '50', minimumRaw: '100' } } };
  let blocks = 0;
  const rpc = async (method, params) => {
    if (method === 'eth_chainId') return change.chain || '0x1237';
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === 'finalized') return { number: change.finalized || '0xb', hash: '0xdef' };
      return { number: '0xa', hash: ++blocks === 2 && change.reorg ? '0xchanged' : '0xabc' };
    }
    assert.equal(params.at(-1), '0xa');
    if (method === 'eth_getCode') return change.code || '0x6000';
    const call = abi.parseTransaction({ data: params[0].data });
    const values = { datasetVault: address(2), monthlyVault: change.binding || address(2), shortController: address(1), monthlyController: address(3), quoteToken: address(4), projectToken: address(5), randomProvider: address(6), decimals: 6,
      ...reserves, balanceOf: change.balance || reserves.balance, SHORT_INTERVAL: 20, lastShortTerminalAt: 10, monthlyInterval: 40, lastMonthAt: 10, minimumMonthlyBudget: 100 };
    return abi.encodeFunctionResult(call.name, [values[call.name]]);
  };
  return { overview, rpc, short: address(1) };
}
test('read-only boundary rejects signing and sends before transport', () => {
  let called = false;
  const rpc = readonlyRpc(() => { called = true; });
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'eth_sign', 'debug_traceTransaction']) assert.throws(() => rpc(method, []), /rejected/);
  assert.equal(called, false);
});
test('two controllers, same-block reserves and timing verified', async () => {
  const result = await inspectQianqi(fixture());
  assert.equal(result.contracts.monthly.address, address(3));
  assert.equal(result.reserves.balance, '65');
});
for (const [name, change, error] of [
  ['wrong chain', { chain: '0x1' }, /Wrong chain/],
  ['not finalized', { finalized: '0x9' }, /not finalized/],
  ['finalized fork mismatch', { finalized: '0xa' }, /Finalized hash mismatch/],
  ['wrong binding', { binding: address(9) }, /binding/],
  ['missing runtime', { code: '0x' }, /Missing contract/],
  ['reserve drift', { balance: '66' }, /Reserve mismatch/],
  ['mid-read reorg', { reorg: true }, /Block changed/],
]) test(name, async () => assert.rejects(inspectQianqi(fixture(change)), error));
test('stale API rejected', async () => {
  const input = fixture(); input.overview.status = 'stale';
  await assert.rejects(inspectQianqi(input), /stale/);
});
