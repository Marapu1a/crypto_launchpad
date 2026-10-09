import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import config from './rpc-config.cjs';
import { collectTicketShadow, qianqiProfile } from '../src/qianqi/shadow-reader.mjs';
import { canonical, check, integer, low, firstRecognitions, mergeWalletPages } from '../src/qianqi/ticket-shadow.mjs';
import { verifyRoute, replayVerifiedCohort } from '../src/qianqi/route-replay.mjs';

const input = resolve(process.argv[2] ?? '.local/test-results/qianqi-shadow-2026-10-09T12-12-21-030Z');
const startedAt = new Date().toISOString(), directory = `.local/test-results/qianqi-routes-${startedAt.replace(/[:.]/g, '-')}`;
mkdirSync(directory, { recursive: true });
const sourceFiles = ['scripts/qianqi-route-replay.mjs', 'src/qianqi/route-replay.mjs', 'src/qianqi/ticket-shadow.mjs', 'src/qianqi/shadow-reader.mjs', 'src/qianqi/readonly-inventory.mjs', 'src/tickets/direct-curve.cjs', ...readdirSync('src/qianqi/routes').map(n => 'src/qianqi/routes/' + n)];
const report = { startedAt, input, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(sourceFiles.map(p => [p, createHash('sha256').update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex')])), status: 'INCOMPLETE', executionEligible: false,
  limits: ['Bounded 53-purchase cohort, not all token activity', 'Published committed traces are verified against receipts and historical runtime; traces remain publisher/RPC assertions', 'No fresh debug trace, consensus proof or intra-block upgrade proof', 'Same reviewed route algorithms as QIANQI, not an independent security audit', 'No global snapshot/RNG/payout verification, no state migration or execution'] };
let calls = 0, finished = 0; const deadline = Date.now() + 600000;
const { url, source } = config.resolveRpc(); report.rpcSource = source;
const allowed = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getCode']);
const cache = new Map();
let nextRequestAt = 0;
// Optional reuse of immutable evidence from an earlier incomplete run. Every row
// is still reverified against the committed proof and the canonical captured head.
function loadReuse() {
  if (!process.argv[3]) return;
  const reuse = resolve(process.argv[3]); let reused = 0;
  const seed = (method, params, value) => cache.set(canonical([method, params]), Promise.resolve(value));
  for (const file of readdirSync(reuse).filter(f => /^\d+-evidence\.json$/.test(f))) {
    const e = JSON.parse(readFileSync(resolve(reuse, file), 'utf8')); verifyRoute(e);
    const tag = '0x' + integer(e.block.number).toString(16), parentTag = '0x' + integer(e.parent.number).toString(16);
    seed('eth_getTransactionByHash', [e.tx.hash], e.tx); seed('eth_getTransactionReceipt', [e.tx.hash], e.receipt);
    seed('eth_getBlockByNumber', [tag, false], e.block); seed('eth_getBlockByNumber', [parentTag, false], e.parent);
    for (const [address, code] of Object.entries(e.runtimes)) { seed('eth_getCode', [address, tag], code.at); seed('eth_getCode', [address, parentTag], code.before); }
    reused++;
  }
  report.reusedEvidence = { directory: reuse, rows: reused };
}
function rpc(method, params) {
  check(allowed.has(method), 'Read-only method rejected'); const key = canonical([method, params]);
  if (!cache.has(key)) cache.set(key, (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      check(++calls <= 3000 && Date.now() < deadline, 'Read budget exceeded');
      const delay = Math.max(0, nextRequestAt - Date.now()); nextRequestAt = Math.max(Date.now(), nextRequestAt) + 150;
      if (delay) await new Promise(r => setTimeout(r, delay));
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: calls, method, params }), signal: AbortSignal.timeout(20000) });
      if ([429, 502, 503].includes(response.status) && attempt < 2) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
      check(response.ok, `RPC HTTP ${response.status}`); const body = await response.json();
      check(!body.error && body.result != null, 'RPC read failed'); return body.result;
    }
  })());
  return cache.get(key);
}
try {
  loadReuse();
  const api = new Map(), rawRpc = new Map(), bundles = new Map(), walletPages = new Map(); let logs;
  for (const file of readdirSync(input).filter(f => /^\d+-(api|rpc)\.json$/.test(f)).sort()) {
    const row = JSON.parse(readFileSync(resolve(input, file), 'utf8'));
    const map = row.method ? rawRpc : api, key = row.method ? canonical([row.method, row.params]) : row.path;
    if (!map.has(key)) map.set(key, []); map.get(key).push(row.method ? row.result : row.data);
    if (row.path?.startsWith('/evidence/purchases/')) bundles.set(row.path.split('/').at(-1).slice(0, -5), row.data);
    if (row.path?.startsWith('/v1/wallets/') && row.path.includes('offset=')) { const w = low(row.data.wallet); if (!walletPages.has(w)) walletPages.set(w, []); walletPages.get(w).push(row.data); }
    if (row.method === 'eth_getLogs' && row.params[0].address === qianqiProfile.recognition) logs = row.result;
  }
  const take = (map, key) => { const values = map.get(key); check(values?.length, 'Missing captured evidence'); return structuredClone(values.shift()); };
  console.log('Recheck captured commitments, lifecycle and API generation');
  const prior = await collectTicketShadow({ rpc: async (method, params) => take(rawRpc, canonical([method, params])), getJson: async path => take(api, path) });
  check(prior.status === 'ACCOUNTING_MATCH', 'Baseline shadow mismatch');
  const credits = firstRecognitions(logs.map(log => ({ log, bundle: bundles.get(low(log.topics[2])) })), qianqiProfile);
  const apiWallets = [...walletPages.values()].map(p => mergeWalletPages(p.sort((a, b) => a.purchases.offset - b.purchases.offset)));
  check(credits.size === 53, 'Expected fixed 53-purchase cohort');
  check(BigInt(await rpc('eth_chainId', [])) === 4663n, 'Wrong chain');
  const head = prior.provenance.head, headTag = '0x' + head.number.toString(16);
  check(low((await rpc('eth_getBlockByNumber', [headTag, false])).hash) === low(head.hash), 'Historical head changed');
  check(integer((await rpc('eth_getBlockByNumber', ['finalized', false])).number) >= head.number, 'Historical head not finalized');
  const inputs = [...credits.values()], verified = new Array(inputs.length); let next = 0, failure;
  const workers = await Promise.allSettled(Array.from({ length: 3 }, async () => {
    while (next < inputs.length && !failure) {
      const index = next++, { proof, log, bundleHash } = inputs[index];
      try {
        const tx = await rpc('eth_getTransactionByHash', [proof.transactionHash]);
        const height = integer(tx.blockNumber), tag = '0x' + height.toString(16), parentTag = '0x' + (height - 1).toString(16);
        const [receipt, block, parent] = await Promise.all([rpc('eth_getTransactionReceipt', [proof.transactionHash]), rpc('eth_getBlockByNumber', [tag, false]), rpc('eth_getBlockByNumber', [parentTag, false])]);
        check(height <= head.number && height > prior.provenance.anchor.number, 'Purchase outside captured history');
        const runtimes = {};
        for (const address of Object.keys(proof.codeHashes)) {
          const [at, before] = await Promise.all([rpc('eth_getCode', [address, tag]), rpc('eth_getCode', [address, parentTag])]); runtimes[address] = { at, before };
        }
        const evidence = { proof, tx, receipt, block, parent, runtimes };
        const result = verifyRoute(evidence);
        const creditedAt = { blockNumber: integer(log.blockNumber), blockHash: low(log.blockHash), transactionHash: low(log.transactionHash), transactionIndex: integer(log.transactionIndex), logIndex: integer(log.logIndex) };
        verified[index] = { ...result, creditedAt, recognition: { bundleHash, source: qianqiProfile.recognition } };
        writeFileSync(`${directory}/${String(index).padStart(3, '0')}-evidence.json`, JSON.stringify(evidence));
        if (++finished % 10 === 0 || finished === inputs.length) console.log(`Verified routes ${finished}/${inputs.length}`);
      } catch (error) { failure = error; throw error; }
    }
  }));
  const failed = workers.find(w => w.status === 'rejected'); if (failed) throw failed.reason;
  // Bypass cache: head must still name the captured canonical branch at completion.
  cache.delete(canonical(['eth_getBlockByNumber', [headTag, false]]));
  check(low((await rpc('eth_getBlockByNumber', [headTag, false])).hash) === low(head.hash), 'Historical head changed during verification');
  const wallets = replayVerifiedCohort({ verified, events: prior.events, anchor: prior.provenance.anchor.number, head: head.number, apiWallets });
  report.status = wallets.every(w => !w.differences.length) ? 'ROUTE_COHORT_MATCH' : 'ROUTE_COHORT_MISMATCH';
  Object.assign(report, { provenance: prior.provenance, verified, wallets, families: verified.reduce((a, v) => ({ ...a, [v.family]: (a[v.family] ?? 0) + 1 }), {}),
    inputBasis: 'payer and amount from verified routes; credit time from commitments; API comparison only' });
  if (report.status !== 'ROUTE_COHORT_MATCH') process.exitCode = 1;
} catch (error) {
  report.error = /^[A-Za-z0-9 :;./_-]{1,180}$/.test(error.message) ? error.message : 'Verification failed'; process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); report.rpcCalls = calls; report.verifiedCount = finished;
  writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n'); console.log(`${report.status} ${directory}/report.json`);
}
