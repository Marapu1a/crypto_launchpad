import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Interface, parseEther, ZeroAddress } from 'ethers';
import { providerFor, readAt, NETWORK, ERC20, FACTORY, launchRecord, stringify } from '../../src/pons/client.mjs';
import { initialDraft, preparePlan, simulatePlan } from '../../src/pons/plan.mjs';
import { assertLocalFork, executeLocalLaunch, continueLocalHolders, sendLocal } from '../../src/pons/local-execution.mjs';

const provider = providerFor(process.env.PONS_TEST_RPC || 'http://127.0.0.1:8545');
const report = { startedAt: new Date().toISOString(), scenarios: [], limitations: [
  'Local EVM fork; not a mainnet transaction or proof of full Arbitrum execution equivalence.',
  'Test ETH balances are supplied by Hardhat; ERC20 funding uses local impersonation.',
] };
mkdirSync('.local/test-results', { recursive: true });
const file = `.local/test-results/pons-fork-${report.startedAt.replace(/[:.]/g, '-')}.json`;
const save = () => writeFileSync(file, stringify(report) + '\n');
const account = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const usdg = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const fixture = extra => ({ ...initialDraft(), name: 'Baseline Test', symbol: 'BASE',
  logo: 'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee', ...extra });
async function scenario(name, run) {
  const row = { name, status: 'RUNNING', startedAt: new Date().toISOString() }; report.scenarios.push(row); save();
  try { Object.assign(row, await run(), { status: 'PASS' }); console.log('PASS ' + name); }
  catch (e) { row.status = 'FAIL'; row.error = e.shortMessage || e.message; row.detail = e.info?.error?.message; console.log('FAIL ' + name + ': ' + row.error); process.exitCode = 1; }
  save();
}
async function launch(extra) {
  const draft = fixture(extra), journal = [];
  let plan = await preparePlan(provider, draft, account);
  const saveJournal = async () => { report.lastJournal = journal; save(); };
  for (const step of plan.steps) await sendLocal(provider, account, step, journal, saveJournal, step.kind);
  plan = await simulatePlan(provider, await preparePlan(provider, draft, account));
  const result = await executeLocalLaunch(provider, plan, journal, saveJournal);
  return { plan, result, journal };
}
try {
  report.fork = await assertLocalFork(provider); save();
  // Numeric block reads execute on a locally mined block, not the foreign fork boundary.
  await provider.send('evm_mine', []);
  await scenario('ETH / wallet / no buy / 0% creator fee', async () => {
    const { plan, result, journal } = await launch({});
    assert.equal(result.token, plan.token); assert.equal(journal.length, 1);
    await assert.rejects(() => executeLocalLaunch(provider, plan, journal, async () => {}), /уже отправлен/);
    return { result, duplicateBlocked: true, journal };
  });
  await scenario('ETH / buyback / opening buy / 10% creator fee', async () => {
    const { plan, result, journal } = await launch({ destination: 'buyback', openingBuy: '0.002', creatorFee: '10' });
    const [balance] = await readAt(provider, result.token, ERC20, 'balanceOf', [account], 'latest');
    assert.ok(balance >= plan.minOut && plan.minOut > 0n);
    const record = await launchRecord(provider, result.token); assert.equal(record.buybackEnabled, true); assert.equal(record.creatorTaxBps, 1000n);
    return { result, balance, minOut: plan.minOut, journal };
  });
  await scenario('ETH / holders / continuation is idempotent', async () => {
    const { result, journal } = await launch({ destination: 'holders', creatorFee: '1' });
    const distributor = await continueLocalHolders(provider, result.token, account, journal, async () => {});
    const count = journal.length;
    assert.equal(await continueLocalHolders(provider, result.token, account, journal, async () => {}), distributor);
    assert.equal(journal.length, count);
    return { result, distributor, journal };
  });
  await scenario('USDG / wallet / no buy / separate fee recipient', async () => {
    const { result, journal } = await launch({ pair: usdg, feeWallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', creatorFee: '3' });
    const record = await launchRecord(provider, result.token); assert.equal(record.pairToken, usdg);
    assert.equal(record.creatorTaxBps, 300n); return { result, journal };
  });
  await scenario('USDG / approve / atomic opening buy', async () => {
    const transferAbi = new Interface(['function transfer(address,uint256) returns(bool)']);
    const holder = '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e';
    const [balance] = await readAt(provider, usdg, ERC20, 'balanceOf', [holder], 'latest');
    assert.ok(balance >= 20_000_000n, 'Test funding source lacks USDG');
    await provider.send('hardhat_impersonateAccount', [holder]);
    await provider.send('hardhat_setBalance', [holder, '0x56bc75e2d63100000']);
    try {
      const hash = await provider.send('eth_sendTransaction', [{ from: holder, to: usdg,
        data: transferAbi.encodeFunctionData('transfer', [account, 20_000_000n]) }]);
      assert.equal((await provider.waitForTransaction(hash)).status, 1);
    } finally { await provider.send('hardhat_stopImpersonatingAccount', [holder]); }
    const { plan, result, journal } = await launch({ pair: usdg, openingBuy: '10', creatorFee: '1' });
    assert.ok(journal.some(j => j.kind === 'approve'));
    const [received] = await readAt(provider, result.token, ERC20, 'balanceOf', [account], 'latest');
    assert.ok(received >= plan.minOut && plan.minOut > 0n); return { result, received, minOut: plan.minOut, journal };
  });
  await scenario('Economics drift rejects reviewed launch', async () => {
    const ready = await simulatePlan(provider, await preparePlan(provider, fixture({}), account));
    const [owner] = await readAt(provider, NETWORK.factory, FACTORY, 'owner', [], 'latest');
    const snapshot = await provider.send('evm_snapshot', []);
    try {
      await provider.send('hardhat_impersonateAccount', [owner]);
      await provider.send('hardhat_setBalance', [owner, '0x56bc75e2d63100000']);
      const hash = await provider.send('eth_sendTransaction', [{ from: owner, to: NETWORK.factory,
        data: FACTORY.encodeFunctionData('setLaunchFee', [ready.terms.fee + 1n]) }]);
      await provider.waitForTransaction(hash);
      await assert.rejects(() => executeLocalLaunch(provider, ready, [], async () => {}), /Условия изменились/);
      return { originalFee: ready.terms.fee, changedFee: ready.terms.fee + 1n };
    } finally { await provider.send('evm_revert', [snapshot]); }
  });
  for (const pair of [ZeroAddress, usdg]) for (const destination of ['wallet', 'buyback', 'holders']) {
    // Complete the combinations not exercised above, plus holders with opening buy.
    const cases = pair === ZeroAddress
      ? (destination === 'wallet' ? ['0.001'] : destination === 'buyback' ? [''] : ['0.001'])
      : (destination === 'wallet' ? [] : ['', '1']);
    for (const openingBuy of cases) await scenario(`${pair === ZeroAddress ? 'ETH' : 'USDG'} / ${destination} / ${openingBuy || 'no'} opening buy`, async () => {
      const { plan, result, journal } = await launch({ pair, destination, openingBuy, creatorFee: '0.1' });
      let distributor;
      if (destination === 'holders') distributor = await continueLocalHolders(provider, result.token, account, journal, async () => {});
      if (openingBuy) {
        const [balance] = await readAt(provider, result.token, ERC20, 'balanceOf', [account], 'latest');
        assert.ok(balance >= plan.minOut && plan.minOut > 0n);
      }
      return { result, distributor, journal };
    });
  }
} catch (e) { report.failure = e.shortMessage || e.message; process.exitCode = 1; console.error(report.failure); }
finally { report.finishedAt = new Date().toISOString(); save(); provider.destroy(); console.log(file); }
