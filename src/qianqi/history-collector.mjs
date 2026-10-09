import {verifyDrawDatasets} from './dataset-reader.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { AbiCoder, Interface, keccak256 } from 'ethers';
import { check, contentHash, low, integer, checkedLog } from './ticket-shadow.mjs';
import { verifyCapturedShadow } from './captured-evidence.mjs';
import { verifyRoute } from './route-replay.mjs';
import { readHistoryProfile } from './history-profile.mjs';
import { datasetAbi, participantType, verifyOrdinary, fullReplay, verifyDataset } from './history-replay.mjs';
const require=createRequire(import.meta.url),curve=require('../tickets/direct-curve.cjs');
const tag=n=>'0x'+integer(n).toString(16);

export async function collectHistory({capture,routes,cacheDirectory,rpc,seed,save=()=>{},progress=()=>{},report={executionEligible:false}}) {
  progress('Verify prior public evidence and reconstruct public snapshot domain');
  const { shadow, credits, records } = await verifyCapturedShadow(capture), { head, anchor } = shadow.provenance;
  for (const r of records) if (r.method && !['eth_chainId', 'eth_getLogs'].includes(r.method) && !['latest', 'finalized'].includes(r.params[0])) seed(r.method, r.params, r.result);
  if (cacheDirectory) for (const file of readdirSync(cacheDirectory).filter(f => /^\d+-rpc\.json$/.test(f))) {
    const r = JSON.parse(readFileSync(resolve(cacheDirectory, file), 'utf8'));
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
  progress(`History selected: ${buys.length} buys, ${sells.length} sells, ${pool.length} pool swaps`);
  const verified = new Map();
  for (const file of readdirSync(routes).filter(f => /^\d+-evidence\.json$/.test(f))) {
    await new Promise(setImmediate); // Keep DB/socket callbacks responsive during CPU-heavy proof verification.
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
    progress(`Ordinary ${ordinaryEvidence.length}: ${decision.status}`);
  }
  check([...verified.keys()].every(tx => purchases.some(p => p.transactionHash === tx)), 'Log selection omitted late purchase');
  for (const log of sells) { check(low(log.address) === low(profile.curve) && curve.EVENTS.parseLog(log).name === 'CurveSell', 'Wrong SELL event'); await verifyLog(log); }
  save('ordinary-evidence.json', ordinaryEvidence);
  save('purchases.json', purchases);
  const replay = fullReplay({ purchases, events: shadow.events, domain, rulesHash: lifecycle.shortRules.rulesHash, anchor: anchor.number, head: head.number }); report.replay = replay;
  report.datasets=await verifyDrawDatasets({rpc,logQuery,verifyLog,replay,lifecycle});
  check(replay.draws.length === 2, 'Expected two completed Short draws');
  check(low((await rpc('eth_getBlockByNumber', [tag(head.number), false], true)).hash) === low(head.hash), 'Head changed during replay');
  report.counts = { buys: buys.length, sells: sells.length, poolSwaps: pool.length, eligible: purchases.filter(p => p.status === 'ELIGIBLE').length, waiting: purchases.filter(p => p.status === 'WAITING_RECOGNITION').length, wallets: replay.wallets.length, draws: replay.draws.length };
  report.waiting = purchases.filter(p => p.status === 'WAITING_RECOGNITION'); report.status = 'HISTORY_SNAPSHOTS_MATCH';
  report.purchases = purchases; report.events = shadow.events; return report;
}
