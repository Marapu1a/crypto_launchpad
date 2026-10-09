import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import config from './rpc-config.cjs';
import { collectTicketShadow, shadowRpc } from '../src/qianqi/shadow-reader.mjs';

const startedAt = new Date().toISOString();
const directory = `.local/test-results/qianqi-shadow-${startedAt.replace(/[:.]/g, '-')}`;
mkdirSync(directory, { recursive: true });
const { url, source } = config.resolveRpc();
const report = { startedAt, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), rpcSource: source, logSource: config.PUBLIC_RPC, status: 'INCOMPLETE', executionEligible: false };
report.workingTreeDirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
report.sourceHashes = Object.fromEntries(['scripts/qianqi-ticket-shadow.mjs', 'src/qianqi/ticket-shadow.mjs', 'src/qianqi/shadow-reader.mjs', 'src/qianqi/readonly-inventory.mjs'].map(path => [path, createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex')]));
let id = 0, artifact = 0;
const deadline = Date.now() + 300000;
const save = (kind, data) => writeFileSync(`${directory}/${String(++artifact).padStart(4, '0')}-${kind}.json`, JSON.stringify(data, null, 2) + '\n');
async function json(response, label) {
  if (!response.ok) throw Error(`${label} HTTP read failed ${response.status}`);
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > 10 * 1024 * 1024) throw Error('Response exceeds size budget'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const rpc = shadowRpc(async (method, params) => {
  if (++id > 2000 || Date.now() > deadline) throw Error('RPC read budget exceeded');
  // The configured free-tier endpoint allows only 10 blocks per getLogs request.
  // Public chain RPC selects logs; configured archive RPC checks their receipts/headers.
  const endpoint = method === 'eth_getLogs' ? config.PUBLIC_RPC : url;
  const body = await json(await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(20000) }), method === 'eth_getLogs' ? 'Public logs' : 'Archive RPC');
  if (body.error || body.result == null) throw Error('RPC read failed');
  save('rpc', { source: method === 'eth_getLogs' ? 'public-chain-rpc' : source, method, params, result: body.result }); return body.result;
});
try {
  report.shadow = await collectTicketShadow({ rpc, getJson: async path => {
    if (Date.now() > deadline || !/^\/(v1\/|evidence\/purchases\/)/.test(path)) throw Error('Invalid public read');
    const data = await json(await fetch('https://qianqi.site' + path, { cache: 'no-store', signal: AbortSignal.timeout(20000) }), 'Public API');
    save('api', { path, data }); return data;
  }, progress: message => console.log(message) });
  report.status = report.shadow.status;
  if (report.status !== 'ACCOUNTING_MATCH') process.exitCode = 1;
} catch (error) {
  // All internal failures are local literals; never expose nested transport details/URLs.
  report.error = /^[A-Za-z0-9 ;/-]{1,160}$/.test(error.message) ? error.message : 'Read or verification failed';
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString(); report.rpcCalls = id;
  writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status} ${directory}/report.json`);
}
