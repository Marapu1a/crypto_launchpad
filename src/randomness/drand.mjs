import { sha256 } from 'ethers';
export const CHAIN_HASH='04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3';
export const BASE=`https://api.drand.sh/${CHAIN_HASH}`;
export const GENESIS=1727521075, PERIOD=3;
const KEY='07e1d1d335df83fa98462005690372c643340060d205306a9aa8106b6bd0b3820557ec32c2ad488e4d4f6008f89a346f18492092ccc0d594610de2732c8b808f0095685ae3a85ba243747b1b2f426049010f6b73a0cf1d389351d5aaaa1047f6297d3a4f9749b33eb2d904c9d9ebf17224150ddd7abd7567a9bec6c74480ee0b';
export function validateInfo(info){
  if(info.hash!==CHAIN_HASH||info.public_key!==KEY||info.period!==PERIOD||info.genesis_time!==GENESIS||info.schemeID!=='bls-bn254-unchained-on-g1')throw Error('drand profile changed');
  return info;
}
export function validateBeacon(beacon,round){
  if(!Number.isSafeInteger(round)||round<1||beacon.round!==round||!/^([0-9a-f]{128})$/i.test(beacon.signature??''))throw Error('Wrong drand round/signature');
  const signature='0x'+beacon.signature;
  if(sha256(signature).slice(2)!==beacon.randomness?.toLowerCase())throw Error('drand randomness mismatch');
  return signature; // Hash/shape only; BLS authentication happens on-chain.
}
async function json(path){const r=await fetch(BASE+path,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(`drand HTTP ${r.status}`);return r.json();}
export async function fetchInfo(){return validateInfo(await json('/info'));}
export async function fetchBeacon(round){const b=await json('/public/'+round);validateBeacon(b,round);return b;}
export async function fetchLatest(){const b=await json('/public/latest');validateBeacon(b,b.round);return b;}
// Permissionless local delivery; on-chain flags reconcile repeated execution.
// A failed/unknown transaction is surfaced, never retried with another seed/round.
export async function deliverRequest(adapter,id,beacon){
  let request=await adapter.requests(id);
  if(request.consumer==='0x0000000000000000000000000000000000000000')throw Error('Unknown request');
  if(!request.proven){const signature=validateBeacon(beacon,Number(request.round));await (await adapter.prove(id,signature)).wait();}
  request=await adapter.requests(id);
  if(!request.delivered)await (await adapter.deliver(id)).wait();
  return (await adapter.requests(id)).seed;
}
