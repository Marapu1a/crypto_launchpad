// Real public evidence is kept in .local, never embedded as production state.
// node tests/qianqi/routes.mjs .local/test-results/qianqi-routes-<successful-run>
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keccak256, toBeHex, zeroPadValue } from 'ethers';
import { verifyRoute, routeProfile, replayVerifiedCohort } from '../../src/qianqi/route-replay.mjs';
const directory = resolve(process.argv[2]);
const report = JSON.parse(readFileSync(resolve(directory, 'report.json'), 'utf8'));
assert.equal(report.status, 'ROUTE_COHORT_MATCH');
const evidence = readdirSync(directory).filter(f => /^\d+-evidence\.json$/.test(f)).sort().map(f => JSON.parse(readFileSync(resolve(directory, f), 'utf8')));
assert.equal(evidence.length, 53);
const selected = new Map();
for (const e of evidence) { const family = verifyRoute(e).family; if (!selected.has(family)) selected.set(family, e); }
assert.equal(selected.size, 3);
const mutate = (e, fn) => { const changed = structuredClone(e); fn(changed); return changed; };
const rejectAll = fn => { for (const e of selected.values()) assert.throws(() => verifyRoute(mutate(e, fn))); };
test('all 53 routes reproduce independently derived payer and amount', () => {
  for (const e of evidence) {
    const actual = verifyRoute(e), expected = report.verified.find(v => v.transactionHash === e.tx.hash.toLowerCase());
    assert.equal(actual.payer, expected.payer); assert.equal(actual.grossQuoteRaw, expected.grossQuoteRaw);
  }
});
test('wrong transaction, block membership, parent or receipt cannot pass', () => {
  rejectAll(e => { e.tx.hash = toBeHex(1, 32); });
  rejectAll(e => { e.block.transactions[Number(BigInt(e.tx.transactionIndex))] = toBeHex(1, 32); });
  rejectAll(e => { e.parent.hash = toBeHex(1, 32); });
  rejectAll(e => { e.receipt.status = '0x0'; });
  rejectAll(e => { e.receipt.from = '0x' + '12'.repeat(20); });
});
test('changed historical runtime and forged matching proof hashes still fail reviewed pins', () => {
  rejectAll(e => { e.runtimes[routeProfile.quote].before = '0x'; });
  rejectAll(e => {
    e.runtimes[routeProfile.quote] = { at: '0x', before: '0x' };
    e.proof.codeHashes[routeProfile.quote] = keccak256('0x'); e.proof.parentCodeHashes[routeProfile.quote] = keccak256('0x');
  });
});
test('caller substitution, authorization, unknown route and failed execution rejected', () => {
  rejectAll(e => { e.proof.trace.from = '0x' + '12'.repeat(20); });
  rejectAll(e => { e.tx.authorizationList = [{}]; });
  rejectAll(e => { e.tx.input = '0xdeadbeef'; e.proof.trace.input = e.tx.input; });
  rejectAll(e => { e.proof.trace.error = 'execution reverted'; });
});
test('removed and duplicated logs fail before attribution', () => {
  rejectAll(e => { e.receipt.logs[0].removed = true; });
  rejectAll(e => { e.receipt.logs.push(structuredClone(e.receipt.logs[0])); });
});
function changeLog(e, address, edit) {
  const log = e.receipt.logs.find(l => l.address.toLowerCase() === address && l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');
  assert.ok(log); edit(log);
  function walk(frame) {
    for (const l of frame.logs ?? []) if (BigInt(l.index) === BigInt(log.logIndex)) { l.data = log.data; l.topics = [...log.topics]; }
    for (const child of frame.calls ?? []) walk(child);
  }
  walk(e.proof.trace);
}
test('consistent trace/receipt tampering of USDG amount rejected by route accounting', () => {
  rejectAll(e => changeLog(e, routeProfile.quote, l => { l.data = toBeHex(BigInt(l.data) + 1n, 32); }));
});
test('consistent trace/receipt token recipient substitution rejected', () => {
  rejectAll(e => changeLog(e, routeProfile.token, l => { l.topics[2] = zeroPadValue('0x' + '12'.repeat(20), 32); }));
});
test('API amounts are comparison targets and cannot replace verified route amounts', () => {
  const input = JSON.parse(readFileSync(resolve(report.input, 'report.json'), 'utf8'));
  const api = readdirSync(report.input).filter(f => f.endsWith('-api.json')).map(f => JSON.parse(readFileSync(resolve(report.input, f), 'utf8')))
    .filter(r => r.path.startsWith('/v1/wallets/') && r.path.includes('offset=')).map(r => r.data);
  const args = { verified: report.verified, events: input.shadow.events, anchor: report.provenance.anchor.number, head: report.provenance.head.number, apiWallets: api };
  const first = replayVerifiedCohort(args); assert.ok(first.every(w => w.differences.length === 0));
  api[0].purchases.items[0].grossQuoteRaw = '1';
  const changed = replayVerifiedCohort(args); assert.ok(changed.some(w => w.differences.some(d => d.startsWith('purchase:'))));
  assert.deepEqual(changed.map(w => w.balances), first.map(w => w.balances));
  assert.throws(() => replayVerifiedCohort({ ...args, verified: [...args.verified, args.verified[0]] }), /Duplicate/);
});
test('7702 self-call requires the reviewed account implementation', () => {
  const self = evidence.find(e => e.tx.from.toLowerCase() === e.tx.to.toLowerCase()); assert.ok(self);
  const sender = self.tx.from.toLowerCase();
  const changed = mutate(self, e => { e.runtimes[sender] = { at: '0x', before: '0x' }; e.proof.codeHashes[sender] = keccak256('0x'); e.proof.parentCodeHashes[sender] = keccak256('0x'); });
  assert.throws(() => verifyRoute(changed));
});
test('v4 funding checks the caller swap delta, not internal vault turnover', () => {
  const findSwap = trace => {
    if (trace.type === 'CALL' && trace.to?.toLowerCase() === '0x8366a39cc670b4001a1121b8f6a443a643e40951' && trace.input?.startsWith('0xf3cd914c')) return trace;
    for (const child of trace.calls ?? []) { const found = findSwap(child); if (found) return found; }
  };
  const subject = evidence.find(e => findSwap(e.proof.trace)); assert.ok(subject);
  const changed = mutate(subject, e => { const frame = findSwap(e.proof.trace); frame.output = toBeHex(BigInt(frame.output) + 1n, 32); });
  assert.throws(() => verifyRoute(changed), /delta/);
});
