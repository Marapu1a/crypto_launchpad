import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BrowserProvider, Contract, ContractFactory, HDNodeWallet, id, keccak256 } from 'ethers';
import { compileProduction } from '../../src/worker/production-build.mjs';
import { GENESIS, PERIOD, validateBeacon } from '../../src/randomness/drand.mjs';
import { compute, QIANQI_RULES } from '../../src/draws/short-outcome.mjs';
import { advanceProductionTransaction } from '../../src/worker/production-journal.mjs';
import { policyIdentity } from '../../src/worker/production-policy.mjs';
import { saveState } from '../../src/worker/storage.mjs';
import { digest } from '../../src/tickets/digest.mjs';
import { createTestPostgres } from './production-postgres.mjs';
import { registerProductionSender, runProductionSender } from '../../server/shared/production-sender.mjs';
import { inProject } from '../../server/shared/store.mjs';

const vector = JSON.parse(readFileSync('vendor/qianqi/research/drand-feasibility/vector.json', 'utf8'));
const roundTime = GENESIS + (vector.beacon.round - 1) * PERIOD;
// Test bounds only, not a deployment recommendation/default.
const timing = { lead: 3600, clockLag: 30, clockAhead: 30, finalizedLag: 1800, beaconLag: 30 };
process.env.PRODUCTION_TEST_START = new Date((roundTime - 100000) * 1000).toISOString();
process.env.HARDHAT_CONFIG = resolve('tests/contracts/production-hardhat.config.cjs');
const { default: hre } = await import('hardhat');
const provider = new BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 });
const report = { startedAt: new Date().toISOString(), chain: 'isolated in-process 4663, no public RPC', scenarios: [], limits: ['Modeled finality, not actual Orbit consensus', 'Pons fixture, not live factory', 'Operator attests dataset truth; full dataset admission/planner not connected', 'Historical fixed BLS vector; timing values are test-only'] };
const root = '.local/test-results/production-contracts-' + report.startedAt.replace(/[:.]/g, '-');
mkdirSync(root, { recursive: true });
const persist = () => writeFileSync(root + '/report.json', JSON.stringify(report, (_, v) => typeof v === 'bigint' ? String(v) : v, 2));
const tx = async p => (await p).wait();
const scenario = async (name, run) => { await run(); report.scenarios.push({ name, status: 'PASS' }); console.log('PASS ' + name); persist(); };
let db;
try {
  const build = compileProduction();
  const fixtures = compileProduction({ 'tests/contracts/ProductionFixtures.sol': { content: readFileSync('tests/contracts/ProductionFixtures.sol', 'utf8') } });
  report.buildHash = build.manifest.buildHash;
  writeFileSync(root + '/manifest.json', JSON.stringify(build.manifest, null, 2));
  const signer = await provider.getSigner(0), outsider = await provider.getSigner(1), team = await provider.getSigner(2), operations = await provider.getSigner(3);
  const deployArtifact = async (a, args) => { const c = await new ContractFactory(a.abi, a.evm.bytecode.object, signer).deploy(...args); await c.waitForDeployment(); return c; };
  const deploy = (name, args = []) => deployArtifact(build.artifacts[name], args);
  const fixture = (file, name, args = []) => deployArtifact(fixtures.contracts['tests/contracts/' + file + '.sol'][name], args);
  const quote = await fixture('Fixtures', 'TestUSDG');
  const escrow = await fixture('Fixtures', 'TestEscrow', [quote.target]);
  const program = await deploy('ShortProgram', [{ asset: quote.target, operator: await signer.getAddress(), instance: id('project-a'), interval: 86400, minimumFund: 50000000, minimumUnit: 50000000 }, [1], timing]);
  const adapter = new Contract(await program.randomness(), build.artifacts.ShortDrandAdapter.abi, signer);
  const splitter = await deploy('FeeSplitter', [quote.target, program.target, await team.getAddress(), await operations.getAddress(), [8000, 1500, 500]]);
  const factory = await fixture('ProductionFixtures', 'TestPonsFactory');
  const collector = await deploy('PonsFeeCollector', [quote.target, escrow.target, splitter.target, factory.target]);
  const token = await fixture('Fixtures', 'TestUSDG');
  const curve = await fixture('ProductionFixtures', 'TestPonsCurve', [token.target, factory.target, quote.target, collector.target, escrow.target]);
  const recognition = await deploy('PurchaseRecognition', [id('project-a'), await outsider.getAddress()]);
  const second = await deploy('ShortProgram', [{ asset: quote.target, operator: await signer.getAddress(), instance: id('project-b'), interval: 86400, minimumFund: 50000000, minimumUnit: 1 }, Array(64).fill(1), timing]);
  db = await createTestPostgres(root + '/postgres');
  const projectId = 'a5897d1a-def5-4c9f-a7bb-a76f2b16519e', moduleId = projectId, otherId = 'b5897d1a-def5-4c9f-a7bb-a76f2b16519e';
  await db.admin.query("INSERT INTO launchpad.projects VALUES($1,'new-a','New A',4663,$3,'test'),($2,'new-b','New B',4663,$4,'test')", [projectId, otherId, token.target.toLowerCase(), second.target.toLowerCase()]);
  for (const [p, address] of [[projectId, program.target], [otherId, second.target]]) await db.admin.query("INSERT INTO launchpad.module_instances VALUES($1,$1,'short','production-candidate-v1',$2,$3)", [p, address.toLowerCase(), 'a'.repeat(64)]);
  const dbAnchor = await provider.getBlock('latest');
  const dbPolicy = { schema: 'short-production-policy-v1', chainId: 4663, projectId, executor: await signer.getAddress(), publisher: await outsider.getAddress(), buildHash: build.manifest.buildHash, anchor: { number: dbAnchor.number, hash: dbAnchor.hash }, contracts: {}, limits: { maxGasPrice: '100000000000', maxGasLimit: '1000000', nativeFloor: '100000' }, timing };
  for (const [name, c] of [['program', program], ['splitter', splitter], ['collector', collector]]) dbPolicy.contracts[name] = { address: c.target, codeHash: keccak256(await provider.getCode(c.target)) };
  await registerProductionSender({ pool: db.pools.executor, provider, projectId, moduleId, policy: dbPolicy });
  const setLaunch = async recipient => tx(factory.setLaunch([token.target, curve.target, await signer.getAddress(), recipient, quote.target, 4200000, 3000, 60, 200, false, 0, 0, 0, 0, true]));
  await scenario('Exact production artifacts deployed; contracts and project RNG isolated', async () => {
    for (const [name, c] of [['ShortProgram', program], ['ShortDrandAdapter', adapter], ['FeeSplitter', splitter], ['PonsFeeCollector', collector], ['PurchaseRecognition', recognition]]) {
      let code = (await provider.getCode(c.target)).slice(2);
      const a = build.artifacts[name], refs = Object.values(a.evm.deployedBytecode.immutableReferences).flat();
      for (const { start, length } of refs) code = code.slice(0, start * 2) + '00'.repeat(length) + code.slice((start + length) * 2);
      assert.equal(code, a.evm.deployedBytecode.object, name + ' runtime differs from build');
    }
    assert.notEqual(await second.randomness(), adapter.target); assert.notEqual(await second.instanceId(), await program.instanceId());
    assert.equal(await adapter.shortConsumer(), program.target); assert.equal(await program.interval(), 86400n);
    await assert.rejects(deploy('ShortProgram', [{ asset: quote.target, operator: await signer.getAddress(), instance: id('bad'), interval: 1, minimumFund: 1, minimumUnit: 1 }, [1], { ...timing, lead: 60 }]));
    await assert.rejects(deploy('FeeSplitter', [quote.target, program.target, await team.getAddress(), await operations.getAddress(), [8000, 1500, 600]]));
  });
  await scenario('Pons binding is irreversible; fee flow preserves 80/15/5 and rejects wrong recipient', async () => {
    await setLaunch(await signer.getAddress()); await assert.rejects(collector.bind(token.target));
    await setLaunch(collector.target); await assert.rejects(collector.connect(outsider).bind(token.target));
    await tx(collector.bind(token.target)); await assert.rejects(collector.bind(token.target));
    await tx(quote.mint(curve.target, 100000000)); await tx(collector.connect(outsider).sweepCurve());
    await tx(collector.collect()); await tx(collector.forward());
    assert.equal(await splitter.credit(0), 80000000n); assert.equal(await splitter.credit(1), 15000000n); assert.equal(await splitter.credit(2), 5000000n);
    for (const lane of [0, 1, 2]) await tx(splitter.connect(outsider).deliver(lane));
    assert.equal(await program.freeFund(), 80000000n); assert.equal(await second.freeFund(), 0n);
    assert.equal(await quote.balanceOf(await team.getAddress()), 15000000n); assert.equal(await quote.balanceOf(await operations.getAddress()), 5000000n);
    await assert.rejects(splitter.deliver(0)); await assert.rejects(collector.forward());
  });
  const people = Array.from({ length: 30 }, (_, i) => ({ wallet: '0x' + (i + 100).toString(16).padStart(40, '0'), firstAttempt: 1n, lastAttempt: 20n }));
  let checkpoint, draw, requestId;
  await scenario('Freeze binds immutable checkpoint, participants, budget and one future round', async () => {
    let head = await provider.getBlock('latest');
    checkpoint = { number: head.number, blockHash: head.hash, timestamp: head.timestamp, ledgerHash: id('finalized-ledger') };
    await assert.rejects(program.freeze(people, checkpoint)); // First interval not elapsed.
    await assert.rejects(recognition.connect(outsider).confirm(id('early'), 1));
    await hre.network.provider.send('evm_setNextBlockTimestamp', [roundTime - timing.lead - 2]);
    await hre.network.provider.send('evm_mine');
    head = await provider.getBlock('latest'); checkpoint = { ...checkpoint, number: head.number, blockHash: head.hash, timestamp: head.timestamp };
    await assert.rejects(program.connect(outsider).freeze(people, checkpoint));
    await assert.rejects(program.freeze(people, { ...checkpoint, ledgerHash: '0x' + '00'.repeat(32) }));
    // Fix the freeze timestamp exactly for the historical drand proof.
    await hre.network.provider.send('evm_setNextBlockTimestamp', [roundTime - timing.lead - 1]);
    await tx(program.freeze(people, checkpoint));
    requestId = await program.requestForCycle(1); draw = await program.draws(1);
    const request = await adapter.requests(requestId);
    assert.equal(request.round, BigInt(vector.beacon.round));
    assert.equal(request.context, draw.context); assert.equal(request.consumer, program.target);
    assert.equal(await program.reserved(), 80000000n);
    await assert.rejects(program.freeze(people, checkpoint)); await assert.rejects(adapter.request(id('replace')));
    await assert.rejects(program.fulfill(requestId, id('forged'))); await assert.rejects(program.settle(people));
    await assert.rejects(adapter.prove(requestId, validateBeacon(vector.beacon, vector.beacon.round)));
  });
  await scenario('Late funding and evidence cannot rewrite a frozen draw', async () => {
    await tx(quote.mint(await signer.getAddress(), 20000000)); await tx(quote.approve(program.target, 20000000)); await tx(program.fund(20000000));
    await assert.rejects(recognition.confirm(id('late-bundle'), 1));
    await tx(recognition.connect(outsider).confirm(id('late-bundle'), 1)); await assert.rejects(recognition.connect(outsider).confirm(id('late-bundle'), 1));
    assert.deepEqual(await program.draws(1), draw); assert.equal(await program.freeFund(), 20000000n); assert.equal(await program.reserved(), 80000000n);
    assert.equal((await program.checkpoints(1)).ledgerHash, checkpoint.ledgerHash);
  });
  let expected;
  await scenario('Delayed delivery uses the original BLS round; bad proof and dataset replacement fail', async () => {
    // Deliberate long delay models a worker outage: there is no deadline-based reroll.
    await hre.network.provider.send('evm_setNextBlockTimestamp', [roundTime + 7200]); await hre.network.provider.send('evm_mine');
    const signature = validateBeacon(vector.beacon, vector.beacon.round);
    assert.equal(await adapter.verify(vector.beacon.round, signature), true); assert.equal(await adapter.verify(vector.beacon.round + 1, signature), false);
    await assert.rejects(adapter.prove(requestId, '0x' + '00'.repeat(64)));
    await tx(adapter.prove(requestId, signature)); const proven = await adapter.requests(requestId);
    await assert.rejects(tx(adapter.deliver(requestId, { gasLimit: 30000 }))); assert.equal((await adapter.requests(requestId)).delivered, false);
    await tx(adapter.connect(outsider).deliver(requestId)); await tx(adapter.deliver(requestId));
    assert.equal(await program.verifiedSeed(1), proven.seed); assert.equal((await adapter.requests(requestId)).round, BigInt(vector.beacon.round));
    await assert.rejects(program.settle(people.slice(0, 1)));
    expected = compute(draw.context, proven.seed, people, QIANQI_RULES, [80000000n]);
    await tx(program.connect(outsider).settle(people));
    assert.equal((await program.draws(1)).resultHash, expected.resultHash);
    assert.equal(await program.freeFund() + await program.liabilities(), 100000000n);
    assert.equal(await program.consumedThrough(people[0].wallet), 20n); assert.ok(await program.solvent());
    assert.equal(expected.winners.length, 1); await assert.rejects(program.settle(people));
    report.result = { winners: expected.winners, amounts: expected.amounts, round: vector.beacon.round, seed: proven.seed, resultHash: expected.resultHash };
  });
  await scenario('Failed recipient preserves debt; actual signed sender resumes disk journal and waits for finality', async () => {
    const winner = expected.winners[0]; await tx(quote.blockRecipient(winner, true));
    await assert.rejects(program.claim(1, winner)); assert.equal(await program.rewards(1, winner), 80000000n);
    await tx(quote.blockRecipient(winner, false));
    const wallet = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk').connect(provider);
    assert.equal(wallet.address, await signer.getAddress());
    const anchor = await provider.getBlock('latest'); let finalizedHeight = anchor.number;
    const observedProvider = new Proxy(provider, { get(target, name) {
      if (name === 'getBlock') return n => target.getBlock(n === 'finalized' ? finalizedHeight : n);
      const v = Reflect.get(target, name); return typeof v === 'function' ? v.bind(target) : v;
    } });
    const policy = { schema: 'short-production-policy-v1', chainId: 4663, projectId: 'a5897d1a-def5-4c9f-a7bb-a76f2b16519e', executor: wallet.address, publisher: await outsider.getAddress(), buildHash: build.manifest.buildHash, anchor: { number: anchor.number, hash: anchor.hash }, contracts: { program: { address: program.target, codeHash: keccak256(await provider.getCode(program.target)) } }, limits: { maxGasPrice: '100000000000', maxGasLimit: '1000000', nativeFloor: '100000' }, timing };
    let state = { schema: 'short-production-journal-v1', identity: policyIdentity(policy), history: [] };
    const request = { to: program.target, data: program.interface.encodeFunctionData('claim', [1, winner]), value: 0 };
    let leaseHeld = true;
    const params = () => ({ provider: observedProvider, signer: wallet, policy, state, request, action: 'claim:1:' + winner, save: s => saveState(root + '/journal.json', s), lease: async () => { assert.ok(leaseHeld, 'lease lost'); }, admit: async ({ request: r }) => {
      assert.equal(r.data, request.data); assert.equal(r.to, program.target.toLowerCase()); assert.equal(await program.rewards(1, winner), 80000000n);
    } });
    await assert.rejects(advanceProductionTransaction({ ...params(), hook: async phase => { if (phase === 'prepared') throw Error('simulated process crash'); } }), /simulated process crash/);
    const saved = JSON.parse(readFileSync(root + '/journal.json', 'utf8')), { checksum, ...restored } = saved;
    assert.equal(checksum, digest(restored)); state = restored; const originalHash = state.pending.hash;
    leaseHeld = false; await assert.rejects(advanceProductionTransaction(params()), /lease lost/); leaseHeld = true;
    assert.equal((await advanceProductionTransaction(params())).reason, 'receipt-finality'); assert.equal(state.pending.hash, originalHash);
    assert.equal(await quote.balanceOf(winner), 80000000n); // Mined, but not finalized in the modeled observer.
    assert.equal((await advanceProductionTransaction(params())).reason, 'receipt-finality');
    finalizedHeight = (await provider.getBlock('latest')).number;
    assert.equal((await advanceProductionTransaction(params())).status, 'confirmed');
    assert.equal((await advanceProductionTransaction(params())).status, 'already-confirmed');
    assert.equal(await quote.balanceOf(winner), 80000000n); assert.equal(state.history[0].raw, undefined);
    await assert.rejects(program.claim(1, winner)); assert.equal(await program.liabilities(), 0n);
    report.journal = { hash: originalHash, confirmed: true, repeated: 'already-confirmed' };
  });
  await scenario('Next timer starts at settle; consumed attempts and checkpoint cannot be reused', async () => {
    const settled = await program.lastTerminal();
    await tx(quote.mint(await signer.getAddress(), 50000000)); await tx(quote.approve(program.target, 50000000)); await tx(program.fund(50000000));
    const newer = { ...checkpoint, number: checkpoint.number + 1, ledgerHash: id('new-ledger') };
    const next = people.map(p => ({ ...p, firstAttempt: 21n, lastAttempt: 25n }));
    await assert.rejects(program.freeze(next, newer));
    await hre.network.provider.send('evm_setNextBlockTimestamp', [Number(settled) + 86400]); await hre.network.provider.send('evm_mine');
    await assert.rejects(program.freeze(next, checkpoint)); await assert.rejects(program.freeze(people, newer));
    const head = await provider.getBlock('latest');
    await tx(program.freeze(next, { ...newer, number: head.number, blockHash: head.hash, timestamp: head.timestamp }));
    assert.equal(await program.cycle(), 2n); assert.equal((await program.draws(2)).budget, 70000000n);
    assert.equal(await second.cycle(), 0n); assert.equal(await second.liabilities(), 0n);
  });
  await scenario('PostgreSQL sender: RLS, exclusive wallet lease, DB session loss and durable signature recovery', async () => {
    assert.equal((await inProject(db.pools.executor, otherId, c => c.query('SELECT * FROM launchpad.production_senders'))).rowCount, 0);
    for (const pool of [db.pools.api, db.pools.jobs]) await assert.rejects(inProject(pool, projectId, c => c.query('SELECT state_text FROM launchpad.production_senders')), /permission denied/);
    const duplicate = { ...dbPolicy, projectId: otherId, contracts: { program: { address: second.target, codeHash: keccak256(await provider.getCode(second.target)) } } };
    await assert.rejects(registerProductionSender({ pool: db.pools.executor, provider, projectId: otherId, moduleId: otherId, policy: duplicate }), /duplicate key/);
    await tx(quote.mint(curve.target, 100000000)); await tx(collector.sweepCurve()); await tx(collector.collect()); await tx(collector.forward());
    const wallet = HDNodeWallet.fromPhrase('test test test test test test test test test test test junk').connect(provider);
    const request = { to: splitter.target, data: splitter.interface.encodeFunctionData('deliver', [1]), value: 0 };
    const args = { pool: db.pools.executor, provider, signer: wallet, projectId, moduleId, request, action: 'team-credit:2', admit: async ({ request: r }) => { assert.equal(r.data, request.data); assert.equal(r.to, splitter.target.toLowerCase()); assert.equal(await splitter.credit(1), 15000000n); } };
    await assert.rejects(runProductionSender({ ...args, hook: async phase => {
      if (phase !== 'prepared') return;
      assert.equal((await runProductionSender(args)).status, 'busy');
      const { rows: [backend] } = await db.admin.query("SELECT pid FROM pg_stat_activity WHERE usename='lp_executor' AND pid IN (SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted)");
      assert.ok(backend); await db.admin.query('SELECT pg_terminate_backend($1)', [backend.pid]);
    } }));
    const { rows: [saved] } = await db.admin.query('SELECT state_text,state_hash FROM launchpad.production_senders WHERE project_id=$1', [projectId]);
    const prepared = JSON.parse(saved.state_text); assert.equal(digest(prepared), saved.state_hash); assert.ok(prepared.pending);
    assert.equal(await quote.balanceOf(await team.getAddress()), 15000000n); // No broadcast after losing the DB fence.
    const result = await runProductionSender(args); assert.equal(result.status, 'confirmed'); assert.equal(result.hash, prepared.pending.hash);
    assert.equal((await runProductionSender(args)).status, 'already-confirmed');
    assert.equal(await quote.balanceOf(await team.getAddress()), 30000000n);
    report.postgres = { hash: result.hash, sessionTerminated: true, repeated: 'already-confirmed', migrations: 11 };
  });
  report.status = 'PASS';
} catch (e) { report.status = 'FAIL'; report.error = e.shortMessage || e.message; console.error(report.error); process.exitCode = 1; }
finally { persist(); console.log(root + '/report.json'); await db?.close(); provider.destroy(); }
