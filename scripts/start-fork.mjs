import { spawn } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import rpcConfig from './rpc-config.cjs';
const { url: rpc, source: rpcSource } = rpcConfig.resolveRpc();
const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false] }), signal: AbortSignal.timeout(15000) });
const { result: block, error } = await response.json();
if (error || !block?.hash) throw Error('Cannot obtain fork block: ' + JSON.stringify(error));
mkdirSync('.local/logs', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(`.local/logs/fork-${stamp}.json`, JSON.stringify({ rpcOrigin: new URL(rpc).origin, rpcSource, customArchive: rpcSource !== 'public', block: Number(BigInt(block.number)), hash: block.hash, hardfork: 'cancun', localChainId: 31337 }, null, 2));
const log = openSync(`.local/logs/fork-${stamp}.log`, 'a');
console.log(`Local fork: http://127.0.0.1:8545, block ${Number(BigInt(block.number))}. Log: .local/logs/fork-${stamp}.log`);
const child = spawn(process.execPath, ['node_modules/hardhat/internal/cli/cli.js', 'node', '--hostname', '127.0.0.1', '--port', '8545'], {
  env: { ...process.env, PONS_ARCHIVE_RPC: rpc, PONS_FORK_BLOCK: String(BigInt(block.number)) }, stdio: ['ignore', log, log], windowsHide: true,
});
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
child.on('exit', code => { process.exitCode = code ?? 1; });
// Execute numeric block reads above the fork boundary on Hardhat's local hardfork.
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const local = await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'hardhat_metadata', params: [] }), signal: AbortSignal.timeout(1000) });
    const { result } = await local.json();
    if (result?.forkedNetwork?.forkBlockHash !== block.hash) throw Error('Local port belongs to another fork');
    const mined = await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'evm_mine', params: [] }) });
    if ((await mined.json()).error) throw Error('Could not mine local block');
    console.log('Fork ready for local testing.'); break;
  } catch (error) {
    if (attempt === 29 || child.exitCode !== null) { child.kill(); throw error; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
