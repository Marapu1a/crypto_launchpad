import {keccak256} from 'ethers';
import inspectRoute from '../qianqi/routes/pons-router-trace-research.cjs';
import calldata from '../qianqi/routes/pons-router-calldata-research.cjs';
import direct from './direct-curve.cjs';
import fixed from '../qianqi/routes/pons-park-native-pins.json' with {type:'json'};
import {check,same,ticketProfile} from '../worker/production-template.mjs';

export const ROUTE_PROFILE='pons-65050-batch-20261012-v1';
export const ROUTER='0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc';
const main='0x7e7d82b72797821f94dffed7d5e77e24c7532f30',fee='0xb8159ba378904f803639d274cec79f788931c9c8';
const weth='0x0bd7d308f8e1639fab988df18a8011f41eacad73',fundingPool='0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca';
const pins={
 [ROUTER]:'0xf9e0c7528d41526b7e818b1b8dcab413df3f20e8908b5386e4ba6f3c3ef07a8f',
 [main]:'0x706ce20f86198cd66b4bc39cafa14fd6c06b7b712f9b667353c53ba721053eb4',
 '0xd17b21b65cc273a4b342f14b19063da8bb410dbd':'0x0f3e60976384e62a8359f1c3a6424b488b12a05bfa82366fdffafd9d3d1fbf95',
 '0x1ab4c5dfe15ff16170201d7fe0edc20c3d0cada3':'0x0a9f1cdcd49033dedb5525414b57d74ca5aa4832d86263a4189adab37f334174',
 ...Object.fromEntries([weth,fundingPool,'0x68184c449e1a8f34fa18d289737129fd27b66f8f','0xc6b81b429797e0f555440b70cd99e032d7ae947e'].map(a=>[a,fixed[a]])),
 [fee]:keccak256('0x'),
};
const low=x=>String(x).toLowerCase();
function manifest(p){return {...ticketProfile(p),weth,fundingPool};}
export function isRouterCandidate(p,tx,receipt){
 return p.routes===ROUTE_PROFILE&&same(tx.to,ROUTER)&&receipt.logs.some(l=>same(l.address,p.contracts.curve.address)&&l.topics[0]===direct.EVENTS.getEvent('CurveBuy').topicHash);
}
// RPC failures leave the durable index unchanged; no silent loss of a supported purchase.
export async function captureRouterContext(provider,p,block,tx,receipt){
 if(!isRouterCandidate(p,tx,receipt))return;
 const height=Number(BigInt(block.number));
 try{
  const trace=await provider.send('debug_traceTransaction',[tx.hash,{tracer:'callTracer',tracerConfig:{withLog:true}}]);
  check(trace&&trace.type,'Missing trace');
  check(same(trace.from,tx.from)&&same(trace.to,tx.to)&&same(trace.input,tx.input)&&BigInt(trace.value??0)===BigInt(tx.value??0),'Wrong trace envelope');
  const addresses=new Set([low(tx.from)]),logs=new Map();let count=0;
  function walk(n){check(++count<=500,'Oversized trace');addresses.add(low(n.to));
   for(const log of n.logs??[]){const i=String(BigInt(log.index));check(!logs.has(i),'Duplicate trace log');logs.set(i,log);}
   for(const c of n.calls??[])walk(c);
  }walk(trace);
  check(logs.size===receipt.logs.length,'Incomplete trace logs');
  for(const log of receipt.logs){const found=logs.get(String(BigInt(log.logIndex)));check(found&&same(found.address,log.address)&&same(found.data,log.data)&&JSON.stringify(found.topics.map(low))===JSON.stringify(log.topics.map(low)),'Trace log mismatch');}
  check(addresses.size<=100,'Oversized runtime set');
  const hashes=await Promise.all([...addresses].map(async a=>[a,keccak256(await provider.getCode(a,height)),keccak256(await provider.getCode(a,height-1))]));
  const [current,parent]=await Promise.all([provider.getBlock(height),provider.getBlock(height-1)]);
  check(same(current?.hash,block.hash)&&same(parent?.hash,block.parentHash),'Route branch changed');
  return {schema:ROUTE_PROFILE,hash:block.hash,parentHash:block.parentHash,timestamp:Number(BigInt(block.timestamp)),transactionHash:low(tx.hash),trace,
   codeHashes:Object.fromEntries(hashes.map(([a,h])=>[a,h])),parentCodeHashes:Object.fromEntries(hashes.map(([a,,h])=>[a,h]))};
 }catch{throw Object.assign(Error('route-evidence-unavailable'),{code:'PRODUCTION_WAIT'});}
}
export function recognizeRouter(p,tx,receipt,context,ordinary){
 check(context?.schema===ROUTE_PROFILE&&same(context.hash,tx.blockHash)&&same(context.transactionHash,tx.hash),'Missing route provenance');
 try{
  check(BigInt(receipt.status)===1n&&!tx.authorizationList?.length,'Unsupported execution');
  check(same(receipt.transactionHash,tx.hash)&&same(receipt.blockHash,tx.blockHash),'Receipt mismatch');
  check(ordinary.length===1,'Multiple curve trades');
  const m=manifest(p),shape=calldata.decode(m,tx);
  check(shape.deadline>=BigInt(context.timestamp),'Expired purchase');
  const result=inspectRoute.inspect({manifest:m,tx,receipt,trace:context.trace,routerModule:main});
  const expected={...pins,...Object.fromEntries(['quote','token','curve'].map(k=>[low(p.contracts[k].address),low(p.contracts[k].codeHash)]))};
  function walk(n){const a=low(n.to);check(expected[a]&&context.codeHashes[a]===expected[a]&&context.parentCodeHashes[a]===expected[a],'Unreviewed runtime');
   if(a===fee)check(n.type==='CALL'&&n.input==='0x'&&!n.calls?.length&&!n.logs?.length,'Fee callback');
   for(const c of n.calls??[])walk(c);
  }walk(context.trace);
  check(context.codeHashes[low(tx.from)]===keccak256('0x')&&context.parentCodeHashes[low(tx.from)]===keccak256('0x'),'Contract payer');
  if(shape.native){const payments=result.nativePayments,f=shape.amountIn/100n;
   check(payments.length===2&&payments[0].to===fee&&BigInt(payments[0].valueRaw)===f&&payments[1].to===weth&&BigInt(payments[1].valueRaw)===shape.amountIn-f,'Native payment mismatch');
  }
  const value=shape.native?result.curveQuoteRaw:result.observedWalletQuoteDebitRaw;
  check(BigInt(value)>0n&&same(result.recipient,tx.from),'Invalid payer/amount');
  return [{...ordinary[0],status:'ELIGIBLE',reason:'SUPPORTED_PONS_ROUTER_BUY',payer:result.recipient,recipient:result.recipient,grossQuoteRaw:value,netQuoteDebitRaw:value,refundQuoteRaw:'0',quoteBasis:shape.native?'verified-curve-usdg-v1':m.quoteBasis,evidenceLogIndexes:receipt.logs.map(l=>Number(BigInt(l.logIndex)))}];
 }catch{return ordinary.map(e=>({...e,status:'UNSUPPORTED_ROUTE',reason:'UNREVIEWED_PONS_EXECUTION'}));}
}
