import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { AbiCoder, Interface, keccak256 } from 'ethers';
import config from './rpc-config.cjs';
import { check, canonical, contentHash, low, integer, checkedLog } from '../src/qianqi/ticket-shadow.mjs';
import { verifyCapturedShadow } from '../src/qianqi/captured-evidence.mjs';
import { verifyRoute } from '../src/qianqi/route-replay.mjs';
import { readHistoryProfile } from '../src/qianqi/history-profile.mjs';
import { datasetAbi, participantType, verifyOrdinary, fullReplay, verifyDataset } from '../src/qianqi/history-replay.mjs';
const require = createRequire(import.meta.url), curve = require('../src/tickets/direct-curve.cjs');
const capture = resolve(process.argv[2] ?? '.local/test-results/qianqi-shadow-2026-10-09T12-12-21-030Z');
const routes = resolve(process.argv[3] ?? '.local/test-results/qianqi-routes-2026-10-09T12-33-18-288Z');
const startedAt = new Date().toISOString(), directory = `.local/test-results/qianqi-history-${startedAt.replace(/[:.]/g, '-')}`;
mkdirSync(directory, { recursive: true });
const sourceFiles = ['scripts/qianqi-history-replay.mjs', ...readdirSync('src/qianqi').filter(f => f.endsWith('.mjs')).map(f => 'src/qianqi/' + f), ...readdirSync('src/qianqi/routes').map(f => 'src/qianqi/routes/' + f), 'src/tickets/direct-curve.cjs'];
const report = { startedAt, capture, routes, status: 'INCOMPLETE', executionEligible: false, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(sourceFiles.map(p => [p, createHash('sha256').update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex')])),
  limits: ['Full Pons curve/designated-pool event selection through the fixed head; RPC omissions not cryptographically excluded', 'Unknown buys remain waiting; never treated as verified zero-value purchases', 'Published late-route traces remain publisher/RPC assertions', 'BUY policy genesis hash is an on-chain identity, not a reconstructed deployment manifest', 'No RNG/payout audit, database import, financial execution or worker handoff'] };
const { url, source } = config.resolveRpc(); report.rpcSource = source; report.logSource = config.PUBLIC_RPC;
const cache = new Map(); let calls = 0, artifact = 0, nextAt = 0; const deadline = Date.now() + 600000;
const allowed = new Set(['eth_chainId', 'eth_call', 'eth_getCode', 'eth_getLogs', 'eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
function seed(method, params, value) { cache.set(canonical([method, params]), Promise.resolve(value)); }
async function rpc(method, params, fresh = false) {
  check(allowed.has(method), 'Read-only method rejected'); const key = canonical([method, params]);
  if (fresh) cache.delete(key);
  if (!cache.has(key)) cache.set(key, (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      check(++calls <= 3000 && Date.now() < deadline, 'History RPC budget exceeded');
      const delay = Math.max(0, nextAt - Date.now()); nextAt = Math.max(Date.now(), nextAt) + 150; if (delay) await new Promise(r => setTimeout(r, delay));
      const response = await fetch(method === 'eth_getLogs' ? config.PUBLIC_RPC : url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: calls, method, params }), signal: AbortSignal.timeout(20000) });
      if ([429, 502, 503].includes(response.status) && attempt < 2) { await response.body?.cancel(); await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
      check(response.ok, `RPC HTTP ${response.status}`); const body = await response.json(); check(!body.error && body.result != null, 'RPC read failed');
      writeFileSync(`${directory}/${String(++artifact).padStart(4, '0')}-rpc.json`, JSON.stringify({ method, params, result: body.result })); return body.result;
    }
  })());
  return cache.get(key);
}
const tag = n => '0x' + integer(n).toString(16);
try {
  console.log('Verify prior public evidence and reconstruct public snapshot domain');
  const { shadow, credits, records } = await verifyCapturedShadow(capture), { head, anchor } = shadow.provenance;
  for (const r of records) if (r.method && !['eth_chainId', 'eth_getLogs'].includes(r.method) && !['latest', 'finalized'].includes(r.params[0])) seed(r.method, r.params, r.result);
  if (process.argv[4]) for (const file of readdirSync(process.argv[4]).filter(f => /^\d+-rpc\.json$/.test(f))) {
    const r = JSON.parse(readFileSync(resolve(process.argv[4], file), 'utf8'));
    if (!['eth_chainId', 'eth_getLogs'].includes(r.method) && !['latest', 'finalized'].includes(r.params[0])) seed(r.method, r.params, r.result);
  }
  check(BigInt(await rpc('eth_chainId', [], true)) === 4663n, 'Wrong chain');
  check(low((await rpc('eth_getBlockByNumber', [tag(head.number), false], true)).hash) === low(head.hash), 'Changed control head');
  check(integer((await rpc('eth_getBlockByNumber', ['finalized', false], true)).number) >= head.number, 'Unfinalized control head');
  const state = await readHistoryProfile(rpc, head, anchor), { profile, lifecycle, domain } = state;
  report.publicProfile = state; report.provenance = { head, anchor };
  const logQuery = (address, topics) => rpc('eth_getLogs', [{ address, topics, fromBlock: tag(anchor.number + 1), toBlock: tag(head.number) }]);
  const buys = await logQuery(profile.curve, [curve.EVENTS.getEvent('CurveBuy').topicHash]), sells = await logQuery(profile.curve, [curve.EVENTS.getEvent('CurveSell').topicHash]);
  check(buys.length <= 500 && sells.length <= 500, 'Trade history budget exceeded');
  const swap = new Interface(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
  const pool = await logQuery(profile.manager, [swap.getEvent('Swap').topicHash, profile.poolId]); check(pool.length === 0, 'Pool activity requires additional replay adapter');
  console.log(`History selected: ${buys.length} buys, ${sells.length} sells, ${pool.length} pool swaps`);
  const verified = new Map();
  for (const file of readdirSync(routes).filter(f => /^\d+-evidence\.json$/.test(f))) {
    const e = JSON.parse(readFileSync(resolve(routes, file), 'utf8')), first = credits.get(low(e.tx.hash));
    check(first && contentHash(first.proof) === contentHash(e.proof), 'Late evidence not committed');
    const v = verifyRoute(e), log = first.log;
    check(!verified.has(v.transactionHash), 'Duplicate late evidence');
    verified.set(v.transactionHash, { ...v, status: 'ELIGIBLE', recognition: { bundleHash: first.bundleHash, source: low(log.address) }, creditedAt: { blockNumber: integer(log.blockNumber), blockHash: low(log.blockHash), transactionHash: low(log.transactionHash), transactionIndex: integer(log.transactionIndex), logIndex: integer(log.logIndex) } });
    seed('eth_getTransactionReceipt', [low(e.tx.hash)], e.receipt); seed('eth_getBlockByNumber', [tag(e.block.number), false], e.block);
  }
  check(verified.size === credits.size, 'Missing late route evidence');
  const purchases = [], ordinaryEvidence = [];
  async function verifyLog(log) {
    check(integer(log.blockNumber) > anchor.number && integer(log.blockNumber) <= head.number, 'Log outside history');
    const receipt = await rpc('eth_getTransactionReceipt', [log.transactionHash]), block = await rpc('eth_getBlockByNumber', [tag(log.blockNumber), false]);
    check(low(receipt.transactionHash) === low(log.transactionHash) && integer(block.number) === integer(log.blockNumber), 'Wrong RPC evidence binding'); checkedLog(log, receipt, block);
    return { receipt, block };
  }
  for (const log of buys) {
    check(low(log.address) === low(profile.curve), 'Wrong curve emitter'); const original = await verifyLog(log), late = verified.get(low(log.transactionHash));
    if (late) { check(late.blockHash === low(log.blockHash) && late.logIndex === integer(log.logIndex), 'Late BUY identity mismatch'); purchases.push(late); continue; }
    const tx = await rpc('eth_getTransactionByHash', [log.transactionHash]), block = await rpc('eth_getBlockByNumber', [tag(log.blockNumber), true]), parent = await rpc('eth_getBlockByNumber', [tag(integer(log.blockNumber) - 1), false]), runtimes = {};
    check(low(tx.hash) === low(log.transactionHash), 'Wrong ordinary transaction');
    const self = low(tx.from) === low(tx.to), direct = low(tx.to) === low(profile.curve);
    if (self || direct) for (const address of new Set(['factory', 'hook', 'curve', 'token', 'quote', 'registry', ...(self ? ['batchExecutor', 'weth', 'fundingRouter', 'fundingPool'] : [])].map(k => low(profile[k])).concat(self ? [low(tx.from)] : []))) {
      runtimes[address] = { at: await rpc('eth_getCode', [address, tag(log.blockNumber)]), before: await rpc('eth_getCode', [address, tag(parent.number)]) };
    }
    const e = { tx, receipt: original.receipt, block, parent, runtimes };
    const decision = verifyOrdinary(e, profile); check(decision.logIndex === integer(log.logIndex), 'Ordinary candidate mismatch'); purchases.push(decision); ordinaryEvidence.push(e);
    console.log(`Ordinary ${ordinaryEvidence.length}: ${decision.status}`);
  }
  check([...verified.keys()].every(tx => purchases.some(p => p.transactionHash === tx)), 'Log selection omitted late purchase');
  for (const log of sells) { check(low(log.address) === low(profile.curve) && curve.EVENTS.parseLog(log).name === 'CurveSell', 'Wrong SELL event'); await verifyLog(log); }
  writeFileSync(`${directory}/ordinary-evidence.json`, JSON.stringify(ordinaryEvidence));
  writeFileSync(`${directory}/purchases.json`, JSON.stringify(purchases, null, 2));
  const replay = fullReplay({ purchases, events: shadow.events, domain, rulesHash: lifecycle.shortRules.rulesHash, anchor: anchor.number, head: head.number }); report.replay = replay;
  const datasetLogs = {};
  for (const name of ['DatasetProposed', 'DatasetReady', 'DatasetSealed', 'DatasetChunk']) {
    datasetLogs[name] = await logQuery(lifecycle.source, [datasetAbi.getEvent(name).topicHash]); check(datasetLogs[name].length <= 100, 'Dataset history budget exceeded');
    for (const log of datasetLogs[name]) await verifyLog(log);
  }
  report.datasets = [];
  for (const draw of replay.draws) {
    const seals = datasetLogs.DatasetSealed.map(l => datasetAbi.parseLog(l)).filter(p => low(p.args.drawId) === draw.snapshot.drawId); check(seals.length === 1, 'Missing/duplicate sealed draw');
    const proposalId = seals[0].args.proposalId;
    const proposals = datasetLogs.DatasetProposed.map(l => datasetAbi.parseLog(l)).filter(p => p.args.proposalId === proposalId), ready = datasetLogs.DatasetReady.map(l => datasetAbi.parseLog(l)).filter(p => p.args.proposalId === proposalId);
    check(proposals.length === 1 && ready.length === 1, 'Missing/duplicate proposed or ready dataset');
    const chunks = datasetLogs.DatasetChunk.filter(l => datasetAbi.parseLog(l).args.proposalId === proposalId).sort((a, b) => integer(datasetAbi.parseLog(a).args.index) - integer(datasetAbi.parseLog(b).args.index));
    const published = [];
    for (const [index, log] of chunks.entries()) {
      const parsed = datasetAbi.parseLog(log), tx = await rpc('eth_getTransactionByHash', [log.transactionHash]);
      check(low(tx.hash) === low(log.transactionHash) && low(tx.blockHash) === low(log.blockHash) && low(tx.to) === low(lifecycle.source), 'Wrong publish transaction');
      const call = datasetAbi.decodeFunctionData('publish', tx.input); check(low(datasetAbi.encodeFunctionData('publish', call)) === low(tx.input) && call.id === proposalId, 'Noncanonical publish calldata');
      check(integer(parsed.args.index) === index && integer(parsed.args.count) === call.data.length && keccak256(AbiCoder.defaultAbiCoder().encode([participantType], [call.data])) === parsed.args.chunkHash, 'Published chunk mismatch'); published.push(call.data);
    }
    report.datasets.push({ drawId: draw.snapshot.drawId, proposalId, verified: verifyDataset(draw, proposals[0], ready[0], published) });
  }
  check(replay.draws.length === 2, 'Expected two completed Short draws');
  check(low((await rpc('eth_getBlockByNumber', [tag(head.number), false], true)).hash) === low(head.hash), 'Head changed during replay');
  report.counts = { buys: buys.length, sells: sells.length, poolSwaps: pool.length, eligible: purchases.filter(p => p.status === 'ELIGIBLE').length, waiting: purchases.filter(p => p.status === 'WAITING_RECOGNITION').length, wallets: replay.wallets.length, draws: replay.draws.length };
  report.waiting = purchases.filter(p => p.status === 'WAITING_RECOGNITION'); report.status = 'HISTORY_SNAPSHOTS_MATCH';
} catch (error) {
  report.error = /^[A-Za-z0-9 :;./_-]{1,180}$/.test(error.message) ? error.message : 'History verification failed'; process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); report.rpcCalls = calls;
  writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n'); console.log(`${report.status} ${directory}/report.json`);
}
