import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, Transaction, id, keccak256, sha256 } from 'ethers';
import { validatePolicy, policyIdentity, admitFinalizedSnapshot } from '../../src/worker/production-policy.mjs';
import { advanceProductionTransaction } from '../../src/worker/production-journal.mjs';
import { assessTiming, admitBeacon } from '../../src/worker/production-timing.mjs';
import { GENESIS, PERIOD } from '../../src/randomness/drand.mjs';
import reference from '../../server/adapters/qianqi/runtime/scripts/drand-timing-readiness.cjs';

function fixture() {
  const signer = Wallet.createRandom(), target = Wallet.createRandom().address;
  const policy = { schema: 'short-production-policy-v1', chainId: 4663, projectId: 'a5897d1a-def5-4c9f-a7bb-a76f2b16519e', executor: signer.address, publisher: Wallet.createRandom().address, buildHash: id('build'), anchor: { number: 1, hash: id('block1') }, contracts: { program: { address: target, codeHash: keccak256('0x6000') } }, limits: { maxGasPrice: '10', maxGasLimit: '100000', nativeFloor: '1' }, timing: { lead: 60, clockLag: 5, clockAhead: 5, finalizedLag: 5, beaconLag: 10 } };
  const f = { signer, policy, state: { schema: 'short-production-journal-v1', identity: policyIdentity(policy), history: [] }, action: 'claim:1:wallet', request: { to: target, data: '0x1234', value: 0 }, finalized: 9, broadcasts: [], saved: [], guards: 0, admits: [], receipt: null };
  const block = number => ({ number, timestamp: 1000 + number, hash: id('block' + number) });
  f.provider = { getNetwork: async () => ({ chainId: 4663n }), getCode: async () => '0x6000', getBlock: async n => block(n === 'latest' ? 10 : n === 'finalized' ? f.finalized : n), getTransactionCount: async () => 0, getFeeData: async () => ({ gasPrice: 1n }), estimateGas: async () => 21000n, getBalance: async () => 1000000n,
    getTransactionReceipt: async () => f.receipt, broadcastTransaction: async raw => { assert.ok(f.saved.at(-1)?.pending?.raw === raw); f.broadcasts.push(raw); const t = Transaction.from(raw); f.receipt = { hash: t.hash, blockNumber: 10, blockHash: id('block10'), status: 1 }; return { hash: t.hash }; } };
  f.save = async state => f.saved.push(structuredClone(state));
  f.lease = async () => { f.guards++; };
  f.admit = async input => f.admits.push(input.phase);
  return f;
}

test('Publisher journal uses its own identity and cannot resume as executor', async () => {
  const f = fixture(), publisher = Wallet.createRandom();
  f.policy.publisher = publisher.address;
  f.signer = publisher; f.role = 'publisher';
  f.state.identity = policyIdentity(f.policy) + ':publisher';
  const result = await advanceProductionTransaction(f);
  assert.equal(result.reason, 'receipt-finality');
  assert.equal(Transaction.from(f.state.pending.raw).from, publisher.address);
  await assert.rejects(advanceProductionTransaction({ ...f, role: 'executor' }), /Wrong executor/);
  await assert.rejects(advanceProductionTransaction({ ...f, state: { ...f.state, identity: policyIdentity(f.policy) } }), /Journal identity/);
  f.finalized = 10; assert.equal((await advanceProductionTransaction(f)).status, 'confirmed');
});

test('Production policy rejects implicit limits, shared signer, wrong chain and changed runtime', async () => {
  for (const change of [p => { delete p.limits; }, p => { p.publisher = p.executor; }, p => { p.chainId = 31337; }, p => { p.timing.lead = 1; }]) {
    const f = fixture(); change(f.policy); assert.throws(() => validatePolicy(f.policy));
  }
  const f = fixture(); f.provider.getCode = async () => '0x6001'; await assert.rejects(advanceProductionTransaction(f), /runtime changed/); assert.equal(f.saved.length, 0);
  f.provider.getCode = async () => '0x6000'; f.provider.getNetwork = async () => ({ chainId: 31337n }); await assert.rejects(advanceProductionTransaction(f), /Wrong production chain/);
});

test('Snapshot and recognition wait for finalized chain time, then preserve exact cutoff', async () => {
  const f = fixture(), args = { ...f, snapshot: { number: 10, hash: id('block10') }, now: 1010 };
  assert.equal((await admitFinalizedSnapshot(args)).reason, 'snapshot-finality');
  f.finalized = 10; assert.equal((await admitFinalizedSnapshot({ ...args, availableAt: 1011 })).reason, 'recognition-finality');
  const admitted = await admitFinalizedSnapshot({ ...args, availableAt: 1010 }); assert.deepEqual(admitted.cutoff, args.snapshot); assert.equal(admitted.authorizationToSend, false);
  await assert.rejects(admitFinalizedSnapshot({ ...args, snapshot: { number: 10, hash: id('other') } }), /Snapshot branch changed/);
  f.provider.getBlock = async () => null; await assert.rejects(admitFinalizedSnapshot(args));
});

test('Signed journal survives crash and unfinalized receipt without another signature or payout', async () => {
  const f = fixture(); await assert.rejects(advanceProductionTransaction({ ...f, hook: async phase => { if (phase === 'prepared') throw Error('crash'); } }), /crash/);
  const hash = f.state.pending.hash; f.state = structuredClone(f.saved.at(-1));
  assert.equal((await advanceProductionTransaction(f)).reason, 'receipt-finality'); assert.equal(f.state.pending.hash, hash); assert.equal(f.state.history.length, 0);
  assert.equal((await advanceProductionTransaction(f)).reason, 'receipt-finality'); assert.equal(f.broadcasts.length, 1);
  f.finalized = 10; assert.equal((await advanceProductionTransaction(f)).status, 'confirmed'); assert.equal(f.state.history[0].raw, undefined);
  assert.equal((await advanceProductionTransaction(f)).status, 'already-confirmed'); assert.equal(f.broadcasts.length, 1);
  f.request.data = '0xabcd'; await assert.rejects(advanceProductionTransaction(f), /Changed completed intent/);
});

test('Lost lease, changed pending request and a consumed nonce never replace the signed intent', async () => {
  const f = fixture(); await assert.rejects(advanceProductionTransaction({ ...f, hook: async () => { throw Error('crash'); } }), /crash/);
  const raw = f.state.pending.raw;
  await assert.rejects(advanceProductionTransaction({ ...f, request: { ...f.request, data: '0xabcd' } }), /Changed pending intent/);
  await assert.rejects(advanceProductionTransaction({ ...f, lease: async () => { throw Error('lease lost'); } }), /lease lost/);
  f.provider.getTransactionCount = async () => 1; await assert.rejects(advanceProductionTransaction(f), /Nonce consumed/);
  assert.equal(f.state.pending.raw, raw); assert.equal(f.broadcasts.length, 0);
});

test('Reorg and reverted receipt retain or stop state; finality failure never clears pending', async () => {
  const f = fixture(); await advanceProductionTransaction(f);
  const getBlock = f.provider.getBlock;
  f.provider.getBlock = async n => { if (n === 'finalized') throw Error('RPC URL WITH SECRET'); return getBlock(n); };
  assert.equal((await advanceProductionTransaction(f)).reason, 'finality-unavailable'); assert.ok(f.state.pending);
  f.provider.getBlock = getBlock;
  f.receipt.blockHash = id('other'); await assert.rejects(advanceProductionTransaction(f), /Noncanonical/); assert.ok(f.state.pending);
  f.receipt.blockHash = id('block10'); f.receipt.status = 0; f.finalized = 10;
  assert.equal((await advanceProductionTransaction(f)).status, 'blocked'); assert.ok(f.state.failure);
  await assert.rejects(advanceProductionTransaction(f), /reconciliation/);
});

test('Admission is repeated before signing and broadcasting, budgets prevent signing', async () => {
  const f = fixture(); await advanceProductionTransaction(f); assert.deepEqual(f.admits, ['prepare', 'sign', 'broadcast']);
  const g = fixture(); g.provider.getBalance = async () => 0n; assert.equal((await advanceProductionTransaction(g)).reason, 'native-balance'); assert.equal(g.saved.length, 0);
  const h = fixture(); h.admit = async ({ phase }) => { if (phase === 'broadcast') throw Error('cutoff expired'); };
  await assert.rejects(advanceProductionTransaction(h), /cutoff expired/); assert.ok(h.state.pending); assert.equal(h.broadcasts.length, 0);
});

test('Lost broadcast response resumes the mined hash; signer cannot increase the approved gas price', async () => {
  const f = fixture(), broadcast = f.provider.broadcastTransaction;
  f.provider.broadcastTransaction = async raw => { await broadcast(raw); throw Error('lost response'); };
  await assert.rejects(advanceProductionTransaction(f), /lost response/);
  const hash = f.state.pending.hash; f.state = structuredClone(f.saved.at(-1)); f.finalized = 10;
  assert.equal((await advanceProductionTransaction(f)).hash, hash); assert.equal(f.broadcasts.length, 1);
  const g = fixture(), signer = g.signer;
  g.signer = { getAddress: () => signer.getAddress(), signTransaction: tx => signer.signTransaction({ ...tx, gasPrice: 2n }) };
  await assert.rejects(advanceProductionTransaction(g), /Signer changed intent/); assert.equal(g.saved.length, 0); assert.equal(g.broadcasts.length, 0);
});

test('Timing model matches QIANQI and HTTP beacon alone cannot admit a freeze', async () => {
  const timing = fixture().policy.timing, round = 1000, now = GENESIS + (round - 1) * PERIOD;
  const signature = '01'.repeat(64), beacon = { round, signature, randomness: sha256('0x' + signature).slice(2) };
  for (const offset of [0, 2, 20, 100]) {
    const observation = { now, latest: { number: 10, timestamp: now - offset }, finalized: { number: 9, timestamp: now - offset - 2 } };
    const result = assessTiming({ observation, timing, beacon });
    const expected = reference.assessDrandTiming({ now: BigInt(now), latestTimestamp: BigInt(observation.latest.timestamp), finalizedTimestamp: BigInt(observation.finalized.timestamp), beaconRound: BigInt(round), lead: 60n, maxClockLag: 5n, maxClockAhead: 5n, maxFinalizedLag: 5n, maxBeaconLag: 10n });
    assert.deepEqual(result.reasons, expected.reasons); assert.equal(String(result.targetRound), expected.targetRound); assert.equal(result.authorizationToSend, false);
    await assert.rejects(admitBeacon({ observation, timing, beacon, verify: async () => false }), /Unverified/);
    await assert.rejects(admitBeacon({ observation, timing, beacon }), /Unverified/);
  }
});
