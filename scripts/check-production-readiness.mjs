// Read-only measurements. No signer, private key, sender or production manifest.
import { mkdirSync, writeFileSync } from 'node:fs';
import config from './rpc-config.cjs';
import { fetchInfo, fetchLatest, GENESIS, PERIOD } from '../src/randomness/drand.mjs';
const { url, source } = config.resolveRpc();
const report = { schema: 'production-observation-v2', startedAt: new Date().toISOString(), source, authorizationToSend: false, samples: [], httpClockObservations: [] };
const file = `.local/test-results/production-observation-${report.startedAt.replace(/[:.]/g, '-')}.json`;
mkdirSync('.local/test-results', { recursive: true });
let next = 0;
async function rpc(method, params) {
  const before = Date.now();
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++next, method, params }), signal: AbortSignal.timeout(15000) });
  const after = Date.now(), serverDate = Date.parse(response.headers.get('date'));
  if (Number.isFinite(serverDate) && report.httpClockObservations.length < 3) report.httpClockObservations.push({ source: 'configured-rpc-http-date', serverDate: new Date(serverDate).toISOString(), offsetFromLocalMidpointMs: serverDate - (before + after) / 2, roundTripMs: after - before, age: response.headers.get('age'), limitation: 'HTTP Date has 1s resolution; not an authenticated time oracle' });
  if (!response.ok) throw Error('RPC unavailable');
  const json = await response.json(); if (json.error || json.result == null) throw Error('RPC unavailable'); return json.result;
}
const header = b => ({ number: Number(BigInt(b.number)), timestamp: Number(BigInt(b.timestamp)), hash: b.hash });
try {
  if (BigInt(await rpc('eth_chainId', [])) !== 4663n) throw Error('Wrong chain');
  report.chainId = 4663;
  await fetchInfo(); // Pin evmnet identity, key, genesis and period.
  for (let i = 0; i < 3; i++) {
    const [l, f, beacon] = await Promise.all([rpc('eth_getBlockByNumber', ['latest', false]), rpc('eth_getBlockByNumber', ['finalized', false]), fetchLatest()]);
    const latest = header(l), finalized = header(f), now = Math.floor(Date.now() / 1000);
    if (finalized.number > latest.number || finalized.timestamp > latest.timestamp) throw Error('Contradictory finality');
    for (const b of [latest, finalized]) if ((await rpc('eth_getBlockByNumber', ['0x' + b.number.toString(16), false])).hash !== b.hash) throw Error('Changed branch');
    report.samples.push({ now, latest, finalized, beaconRound: beacon.round, latestAgeSeconds: now - latest.timestamp, finalizedAgeSeconds: now - finalized.timestamp, chainFinalityLagSeconds: latest.timestamp - finalized.timestamp, finalityBlockGap: latest.number - finalized.number, beaconAgeSeconds: now - (GENESIS + (beacon.round - 1) * PERIOD) });
    if (i < 2) await new Promise(resolve => setTimeout(resolve, 3000));
  }
  report.status = 'observed'; report.beaconAuthentication = 'info and shape/hash only; production adapter BLS verification still required';
} catch { report.status = 'unavailable'; report.reason = 'Observation failed; credential-bearing provider errors omitted'; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, samples: report.samples, httpClockObservations: report.httpClockObservations, file, authorizationToSend: false }, null, 2));
}
