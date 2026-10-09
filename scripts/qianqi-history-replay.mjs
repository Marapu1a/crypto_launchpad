import { collectHistory } from '../src/qianqi/history-collector.mjs';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import config from './rpc-config.cjs';
import { check, canonical } from '../src/qianqi/ticket-shadow.mjs';
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
try {
  await collectHistory({capture,routes,cacheDirectory:process.argv[4],rpc,seed,report,progress:console.log,save:(name,data)=>writeFileSync(resolve(directory,name),JSON.stringify(data,null,2))});
} catch (error) {
  report.error = /^[A-Za-z0-9 :;./_-]{1,180}$/.test(error.message) ? error.message : 'History verification failed'; process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); report.rpcCalls = calls;
  writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n'); console.log(`${report.status} ${directory}/report.json`);
}
