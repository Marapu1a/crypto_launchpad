import {createRequire} from 'node:module';
import {Interface} from 'ethers';
import {check,low,integer,canonical,contentHash,checkedLog,lifecycleAbi,lifecycleEvents,recognitionAbi,firstRecognitions,mergeWalletPages,compareWallet,replayWallet} from './ticket-shadow.mjs';
import {qianqiProfile as p} from './shadow-reader.mjs';
import {readHistoryProfile} from './history-profile.mjs';
import {inspectQianqi} from './readonly-inventory.mjs';
import {verifyOrdinary,fullReplay} from './history-replay.mjs';
import {verifyRoute} from './route-replay.mjs';
import {verifyDrawDatasets} from './dataset-reader.mjs';
const require=createRequire(import.meta.url),curve=require('../tickets/direct-curve.cjs');
const tag=n=>'0x'+integer(n).toString(16),order=(a,b)=>a.blockNumber-b.blockNumber||a.transactionIndex-b.transactionIndex||a.logIndex-b.logIndex;
const methods=new Set(['eth_chainId','eth_call','eth_getCode','eth_getLogs','eth_getBlockByNumber','eth_getTransactionReceipt','eth_getTransactionByHash']);
function branch(ok){if(!ok){const e=Error('QIANQI canonical branch changed');e.code='QIANQI_REORG';throw e;}}
export async function advanceShadow({previous,rpc:transport,getJson}){
 const rpc=(method,params)=>{check(methods.has(method),'Live read-only method rejected');return transport(method,params);};
 const old=previous.provenance.head,anchor=previous.provenance.anchor;
 check(BigInt(await rpc('eth_chainId',[]))===4663n,'Wrong live chain');
 branch(low((await rpc('eth_getBlockByNumber',[tag(old.number),false])).hash)===old.hash);
 const overview=await getJson('/v1/overview?limit=1'),head=overview.provenance?.head;
 check(overview.status==='observed'&&head&&integer(head.number)>=old.number,'API head behind cursor');
 if(head.number===old.number){branch(head.hash===old.hash);return {payload:previous,changed:false,delta:{buys:0,sells:0,recognitions:0,lifecycle:0},comparedWallets:0};}
 check(head.number-old.number<=1000000,'Live catch-up range exceeds budget');
 const state=await readHistoryProfile(rpc,head,anchor);check(contentHash(state)===contentHash(previous.publicProfile),'Live profile changed');
 const inventory=await inspectQianqi({overview,rpc,short:p.short});
 const memo=new Map();async function cached(method,params){const key=canonical([method,params]);if(!memo.has(key))memo.set(key,rpc(method,params));return memo.get(key);}
 async function verifyLog(log){check(integer(log.blockNumber)<=head.number,'Future log');const receipt=await cached('eth_getTransactionReceipt',[log.transactionHash]),block=await cached('eth_getBlockByNumber',[tag(log.blockNumber),false]);checkedLog(log,receipt,block);return {receipt,block};}
 async function select(address,topics,from=old.number+1){
  const all=[];for(let start=from;start<=head.number;start+=90000){const to=Math.min(start+89999,head.number);const logs=await rpc('eth_getLogs',[{address,topics,fromBlock:tag(start),toBlock:tag(to)}]);check(logs.length<=500,'Live event budget exceeded');
   for(const l of logs){check(low(l.address)===low(address)&&integer(l.blockNumber)>=start&&integer(l.blockNumber)<=to,'Wrong live log selection');await verifyLog(l);all.push(l);}}
  const keys=all.map(l=>`${l.blockHash}:${l.transactionHash}:${l.logIndex}`);check(new Set(keys).size===keys.length,'Duplicate live events');return all;
 }
 const {profile,lifecycle,domain}=state;
 const buys=await select(profile.curve,[curve.EVENTS.getEvent('CurveBuy').topicHash]),sells=await select(profile.curve,[curve.EVENTS.getEvent('CurveSell').topicHash]);
 const swap=new Interface(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
 check((await select(profile.manager,[swap.getEvent('Swap').topicHash,profile.poolId])).length===0,'Pool activity unsupported');
 const lifecycleTopics=lifecycleAbi.fragments.map(f=>lifecycleAbi.getEvent(f.name).topicHash);
 const rawLifecycle=[...await select(p.short,[lifecycleTopics]),...await select(p.monthly,[lifecycleTopics])];
 const events=[...previous.events,...lifecycleEvents(rawLifecycle,p)].sort(order);
 const purchases=structuredClone(previous.purchases);
 for(const log of buys){
  const tx=await cached('eth_getTransactionByHash',[log.transactionHash]),receipt=await cached('eth_getTransactionReceipt',[log.transactionHash]),block=await cached('eth_getBlockByNumber',[tag(log.blockNumber),true]),parent=await cached('eth_getBlockByNumber',[tag(integer(log.blockNumber)-1),false]),runtimes={};
  const self=low(tx.from)===low(tx.to),direct=low(tx.to)===low(profile.curve);
  if(self||direct)for(const address of new Set(['factory','hook','curve','token','quote','registry',...(self?['batchExecutor','weth','fundingRouter','fundingPool']:[])].map(k=>low(profile[k])).concat(self?[low(tx.from)]:[]))){runtimes[address]={at:await cached('eth_getCode',[address,tag(log.blockNumber)]),before:await cached('eth_getCode',[address,tag(parent.number)])};}
  const decision=verifyOrdinary({tx,receipt,block,parent,runtimes},profile);check(decision.logIndex===integer(log.logIndex)&&decision.transactionHash===low(log.transactionHash),'Wrong live BUY');purchases.push(decision);
 }
 const recognitionLogs=await select(p.recognition,[recognitionAbi.getEvent('PurchasesRecognized').topicHash]),confirmations=[];
 for(const log of recognitionLogs){const hash=recognitionAbi.parseLog(log).args.bundleHash,bundle=await getJson(`/evidence/purchases/${hash}.json`);confirmations.push({log,bundle});}
 for(const {log,proof,bundleHash} of firstRecognitions(confirmations,p).values()){
  await new Promise(setImmediate);
  const index=purchases.findIndex(x=>x.transactionHash===low(proof.transactionHash));check(index>=0,'Recognition missing original purchase');const prior=purchases[index];check(prior.blockHash===low(proof.blockHash),'Recognition original branch mismatch');
  const tx=await cached('eth_getTransactionByHash',[proof.transactionHash]),receipt=await cached('eth_getTransactionReceipt',[proof.transactionHash]),block=await cached('eth_getBlockByNumber',[tag(tx.blockNumber),false]),parent=await cached('eth_getBlockByNumber',[tag(integer(tx.blockNumber)-1),false]),runtimes={};
  for(const address of Object.keys(proof.codeHashes)){runtimes[address]={at:await cached('eth_getCode',[address,tag(tx.blockNumber)]),before:await cached('eth_getCode',[address,tag(parent.number)])};}
  const verified=verifyRoute({proof,tx,receipt,block,parent,runtimes});check(verified.logIndex===prior.logIndex,'Recognition log mismatch');
  purchases[index]=applyRecognitionPurchase(prior,verified,log,bundleHash);
 }
 purchases.sort(order);
 const replay=fullReplay({purchases,events,domain,rulesHash:lifecycle.shortRules.rulesHash,anchor:anchor.number,head:head.number});
 for(const d of previous.replay.draws)check(replay.draws.find(x=>x.snapshot.drawId===d.snapshot.drawId)?.snapshotHash===d.snapshotHash,'Historical snapshot changed');
 let datasets=previous.datasets;
 if(rawLifecycle.length)datasets=await verifyDrawDatasets({rpc,logQuery:(address,topics)=>select(address,topics,anchor.number+1),verifyLog,replay,lifecycle});
 const addresses=[...new Set(purchases.map(x=>x.status==='ELIGIBLE'?x.payer:x.observedSender??x.payer).filter(Boolean))].sort();
 let next=0;const comparisons=[];
 const workers=await Promise.allSettled(Array.from({length:Math.min(4,addresses.length)},async()=>{while(next<addresses.length){const wallet=addresses[next++],pages=[];let offset=0;
  for(let i=0;i<100;i++){const page=await getJson(`/v1/wallets/${wallet}?offset=${offset}&limit=100`);check(low(page.wallet)===wallet,'Wrong live API wallet');pages.push(page);if(page.purchases?.nextOffset===null)break;offset=page.purchases.nextOffset;}
  const api=mergeWalletPages(pages),g=api.provenance;check(canonical(g.head)===canonical(head)&&canonical(g.anchor)===canonical(anchor)&&g.ledgerHash===overview.provenance.ledgerHash&&g.manifestHash===overview.provenance.manifestHash,'Mixed live API generation');
  const calculated=replay.wallets.find(x=>x.wallet===wallet)??replayWallet({wallet,purchases:[],events,thresholdRaw:'100000000',anchor:anchor.number,head:head.number});check(compareWallet(calculated,api).length===0,'Live wallet balance mismatch');comparisons.push(wallet);
 }}));const failed=workers.find(r=>r.status==='rejected');if(failed)throw failed.reason;
 const finalOverview=await getJson('/v1/overview?limit=1');check(canonical(finalOverview.provenance.head)===canonical(head)&&finalOverview.provenance.ledgerHash===overview.provenance.ledgerHash&&finalOverview.provenance.manifestHash===overview.provenance.manifestHash,'API generation moved during cycle');
 branch(low((await rpc('eth_getBlockByNumber',[tag(old.number),false])).hash)===old.hash);branch(low((await rpc('eth_getBlockByNumber',[tag(head.number),false])).hash)===head.hash);
 const payload={...previous,provenance:{...previous.provenance,head},purchases,events,replay,datasets,counts:{...previous.counts,buys:purchases.length,sells:previous.counts.sells+sells.length,eligible:purchases.filter(x=>x.status==='ELIGIBLE').length,waiting:purchases.filter(x=>x.status!=='ELIGIBLE').length,wallets:replay.wallets.length,draws:replay.draws.length}};
 return {payload,changed:true,inventory,apiGeneration:{head,ledgerHash:overview.provenance.ledgerHash,manifestHash:overview.provenance.manifestHash},comparedWallets:comparisons.length,delta:{buys:buys.length,sells:sells.length,recognitions:recognitionLogs.length,lifecycle:rawLifecycle.length}};
}

export function applyRecognitionPurchase(prior,verified,log,bundleHash){
 check(prior.transactionHash===verified.transactionHash&&prior.blockHash===verified.blockHash&&prior.logIndex===verified.logIndex,'Recognition identity mismatch');
 if(prior.status==='ELIGIBLE'){check(prior.payer===verified.payer&&prior.grossQuoteRaw===verified.grossQuoteRaw,'Repeated recognition conflicts');return prior;}
 check(prior.status==='WAITING_RECOGNITION'&&integer(log.blockNumber)>=verified.blockNumber,'Invalid late purchase state');
 return {...verified,status:'ELIGIBLE',recognition:{source:p.recognition,bundleHash},creditedAt:{...Object.fromEntries(['blockNumber','transactionIndex','logIndex'].map(k=>[k,integer(log[k])])),blockHash:low(log.blockHash),transactionHash:low(log.transactionHash)}};
}
