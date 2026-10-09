import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonical, check, low, firstRecognitions } from './ticket-shadow.mjs';
import { collectTicketShadow, qianqiProfile } from './shadow-reader.mjs';

export async function verifyCapturedShadow(directory) {
  const api = new Map(), rpc = new Map(), bundles = new Map(), records = []; let confirmations;
  for (const file of readdirSync(directory).filter(f => /^\d+-(api|rpc)\.json$/.test(f)).sort()) {
    const row = JSON.parse(readFileSync(resolve(directory, file), 'utf8')); records.push(row);
    const map = row.method ? rpc : api, key = row.method ? canonical([row.method, row.params]) : row.path;
    if (!map.has(key)) map.set(key, []); map.get(key).push(row.method ? row.result : row.data);
    if (row.path?.startsWith('/evidence/purchases/')) bundles.set(row.path.split('/').at(-1).slice(0, -5), row.data);
    if (row.method === 'eth_getLogs' && row.params[0].address === qianqiProfile.recognition) confirmations = row.result;
  }
  const take = (map, key) => { const rows = map.get(key); check(rows?.length, 'Captured evidence missing'); return structuredClone(rows.shift()); };
  const shadow = await collectTicketShadow({ rpc: async (method, params) => take(rpc, canonical([method, params])), getJson: async path => take(api, path) });
  check(shadow.status === 'ACCOUNTING_MATCH', 'Captured shadow mismatch');
  const credits = firstRecognitions(confirmations.map(log => ({ log, bundle: bundles.get(low(log.topics[2])) })), qianqiProfile);
  return { shadow, credits, records };
}
