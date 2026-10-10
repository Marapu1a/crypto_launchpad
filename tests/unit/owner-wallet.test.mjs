import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walletAccount } from '../../src/pons/wallet.mjs';
import { sendLocal, attachLocalHash } from '../../src/pons/local-execution.mjs';
const account = '0x0000000000000000000000000000000000000001', to = '0x0000000000000000000000000000000000000002';
const hash = '0x' + 'ab'.repeat(32), request = { to, data: '0x1234', value: 2n };
function fixture() {
  const journal = [], states = [], calls = [];
  const metadata = { instanceId: 'one', forkedNetwork: { chainId: 4663 } };
  const tx = { from: account, ...request, nonce: 3 };
  const provider = { _getConnection: () => ({ url: 'http://127.0.0.1:8545' }), getNetwork: async () => ({ chainId: 31337n }),
    send: async () => metadata, call: async () => '0x', getTransactionCount: async () => 3,
    getTransaction: async () => tx, getTransactionReceipt: async () => ({ status: 1, blockNumber: 10, hash }),
    waitForTransaction: async () => ({ status: 1, blockNumber: 10, hash }),
  };
  const wallet = { request: async ({ method, params }) => {
    calls.push({ method, params });
    return ({ eth_chainId: '0x7a69', eth_accounts: [account], hardhat_metadata: metadata, eth_sendTransaction: hash })[method];
  } };
  const persist = async () => states.push(structuredClone(journal));
  return { provider, wallet, journal, persist, states, calls, tx };
}
test('Wallet send records intent first and sends exact chain, nonce, value and calldata', async () => {
  const f = fixture();
  await sendLocal(f.provider, account, request, f.journal, f.persist, 'launch', f.wallet);
  assert.equal(f.states[0][0].state, 'requesting'); assert.equal(f.journal[0].state, 'confirmed');
  assert.deepEqual(f.calls.find(c => c.method === 'eth_sendTransaction').params, [{ from: account, to, data: '0x1234', value: '0x2', nonce: '0x3', chainId: '0x7a69' }]);
});
test('Wrong chain, changed account and different fork cannot request a signature', async () => {
  for (const override of [{ eth_chainId: '0x1237' }, { eth_accounts: [to] }, { hardhat_metadata: { instanceId: 'other' } }]) {
    const f = fixture(), original = f.wallet.request;
    f.wallet.request = args => args.method in override ? Promise.resolve(override[args.method]) : original(args);
    await assert.rejects(sendLocal(f.provider, account, request, f.journal, f.persist, 'launch', f.wallet));
    assert.equal(f.calls.some(c => c.method === 'eth_sendTransaction'), false);
  }
});
test('Disconnect and 4001 rejection differ from ambiguous timeout; recovery never resends', async () => {
  await assert.rejects(walletAccount({ request: async ({ method }) => method === 'eth_chainId' ? '0x7a69' : [] }, 31337));
  for (const code of [4001, -32000]) {
    const f = fixture(), original = f.wallet.request;
    f.wallet.request = args => { if (args.method === 'eth_sendTransaction') throw Object.assign(Error('interrupted'), { code }); return original(args); };
    await assert.rejects(sendLocal(f.provider, account, request, f.journal, f.persist, 'launch', f.wallet));
    assert.equal(f.journal[0].state, code === 4001 ? 'rejected' : 'unknown');
    if (code !== 4001) {
      await assert.rejects(sendLocal(f.provider, account, request, f.journal, f.persist, 'launch', f.wallet));
      const restored = JSON.parse(JSON.stringify(f.journal, (_, v) => typeof v === 'bigint' ? String(v) : v));
      f.tx.data = '0xdead'; await assert.rejects(attachLocalHash(f.provider, restored, f.persist, hash));
      assert.equal(restored[0].hash, undefined);
      f.tx.data = request.data; await attachLocalHash(f.provider, restored, f.persist, hash);
      assert.equal(restored[0].state, 'confirmed');
    }
  }
});
test('Wallet changed transaction and missing receipt stay unresolved', async () => {
  for (const missing of [false, true]) {
    const f = fixture();
    if (missing) f.provider.waitForTransaction = async () => null; else f.tx.value = 999n;
    await assert.rejects(sendLocal(f.provider, account, request, f.journal, f.persist, 'launch', f.wallet));
    assert.equal(f.journal[0].state, 'unknown'); assert.equal(f.journal[0].hash, hash);
  }
});
