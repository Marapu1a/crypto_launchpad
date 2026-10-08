// Read-only archive probe. No endpoint credentials in console or report.
import { mkdirSync, writeFileSync } from 'node:fs';
import { keccak256 } from 'ethers';
import config from './rpc-config.cjs';
const { url, source } = config.resolveRpc();
const startedAt = new Date().toISOString();
const report = { startedAt, source, checks: [] };
const file = `.local/test-results/rpc-check-${startedAt.replace(/[:.]/g, '-')}.json`;
mkdirSync('.local/test-results', { recursive: true });
const persist = () => writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
let id = 0;
async function rpc(method, params) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const body = await response.json();
  // Provider error messages can contain the URL/key, so persist only the code.
  if (body.error) throw Error(`RPC error ${body.error.code}`);
  if (body.result === undefined || body.result === null) throw Error('Empty RPC result');
  return body.result;
}
async function check(name, run) {
  const row = { name }; report.checks.push(row); const before = Date.now();
  try { row.result = await run(); row.status = 'PASS'; }
  catch (error) { row.status = 'FAIL'; row.error = /^(HTTP \d+|RPC error -?\d+|Empty RPC result|Wrong chain|Wrong block hash|Wrong bytecode)$/.test(error.message) ? error.message : 'Request failed (details omitted to protect credentials)'; process.exitCode = 1; }
  row.elapsedMs = Date.now() - before; persist(); console.log(`${row.status} ${name} (${row.elapsedMs}ms)`);
  return row.status === 'PASS';
}
try {
  const rightChain = await check('chainId 4663', async () => { const chain = Number(BigInt(await rpc('eth_chainId', []))); if (chain !== 4663) throw Error('Wrong chain'); return chain; });
  if (rightChain) {
    await check('latest block', async () => { const b = await rpc('eth_getBlockByNumber', ['latest', false]); return { number: Number(BigInt(b.number)), hash: b.hash }; });
    const tag = '0x' + (82616126).toString(16), factory = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
    await check('historical block 82616126', async () => { const b = await rpc('eth_getBlockByNumber', [tag, false]); if (b.hash !== '0x0c76f96bbaed8a0b5bf36abed373c50ceded43415d266dadb7fa14eb100263f0') throw Error('Wrong block hash'); return { number: Number(BigInt(b.number)), hash: b.hash }; });
    await check('historical factory code', async () => { const hash = keccak256(await rpc('eth_getCode', [factory, tag])); if (hash !== '0x89a27da6f703e0a7cdd4f233e7cb57604ff75b164530962d3ff7cf8483a67d84') throw Error('Wrong bytecode'); return hash; });
    await check('historical launchFee call', () => rpc('eth_call', [{ to: factory, data: '0xcf3cf573' }, tag]));
    await check('historical storage', () => rpc('eth_getStorageAt', [factory, '0x0', tag]));
    await check('historical nonce', () => rpc('eth_getTransactionCount', ['0x202fd7ea97d7e1569b8d429dcabc4bae6e90a242', tag]));
    await check('historical balance', () => rpc('eth_getBalance', ['0x202fd7ea97d7e1569b8d429dcabc4bae6e90a242', tag]));
  }
} finally { report.finishedAt = new Date().toISOString(); persist(); console.log(file); }
