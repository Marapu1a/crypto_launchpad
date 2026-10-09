import { mkdirSync, writeFileSync } from 'node:fs';
import config from './rpc-config.cjs';
import { inspectQianqi, readonlyRpc } from '../src/qianqi/readonly-inventory.mjs';

const startedAt = new Date().toISOString();
const directory = `.local/test-results/qianqi-inventory-${startedAt.replace(/[:.]/g, '-')}`;
mkdirSync(directory, { recursive: true });
const { url, source } = config.resolveRpc();
const report = { startedAt, rpcSource: source, api: 'https://qianqi.site/v1/overview?limit=1', status: 'FAIL' };
let id = 0;
const rpc = readonlyRpc(async (method, params) => {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error('RPC HTTP failure');
  const body = await response.json();
  if (body.error || body.result == null) throw Error('RPC read failure');
  return body.result;
});
try {
  const response = await fetch(report.api, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
  if (!response.ok) throw Error('API HTTP failure');
  const overview = await response.json();
  writeFileSync(`${directory}/overview.json`, JSON.stringify(overview, null, 2));
  // Public historical Short emitter; never inferred from a mutable API response.
  report.inventory = await inspectQianqi({ overview, rpc, short: '0xa631f7845af257daee0b9f6ff744334294ce6846' });
  report.status = 'PASS';
} catch {
  // Transport errors can include endpoint credentials. Do not persist them.
  report.error = 'Read-only verification failed; no execution authorized';
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(`${directory}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status} ${directory}/report.json`);
}
