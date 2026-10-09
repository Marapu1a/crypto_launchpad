import {Interface,keccak256,toQuantity,ZeroHash,toBeHex,zeroPadValue} from 'ethers';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {hash}=require('./runtime/scripts/direct-buy.cjs');
const {observePublic}=require('./runtime/scripts/public-observation.cjs');
const {observeRewards}=require('./runtime/scripts/reward-observation.cjs');
const {ABI:recognitionAbi}=require('./runtime/scripts/purchase-recognition.cjs');
const allowed=new Set(['eth_chainId','eth_getBlockByNumber','eth_getBlockByHash','eth_getBlockReceipts','eth_getBalance','eth_getTransactionCount','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getCode','eth_getStorageAt','eth_call','eth_getLogs']);
export function readOnlyRpc(transport){return async(method,params)=>{
 if(!allowed.has(method))throw Object.assign(Error('RECOVERY_RPC_WRITE_FORBIDDEN'),{code:'RECOVERY_RPC_WRITE_FORBIDDEN'});
 return transport(method,params);
};}
export function rpcTransport(url,{fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),intervalMs=200}={}){
 let id=0,queue=Promise.resolve();
 return readOnlyRpc((method,params)=>{
 const task=queue.then(async()=>{
 await wait(intervalMs); // Serialized, <=5 requests/s; do not compete with the live indexer.
 let response;
 for(let attempt=0;attempt<3;attempt++){
  response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(30000)});
  if(![429,502,503,504].includes(response.status)||attempt===2)break;
  await response.arrayBuffer();await wait(1000*2**attempt);
 }
 const context={method,...(method==='eth_call'?{selector:params[0].data.slice(0,10),blockTag:params[1]}:{}),...(method==='eth_getBlockByNumber'?{blockTag:params[0]}:{})};
 if(!response.ok)throw Object.assign(Error('RECOVERY_RPC_UNAVAILABLE'),{rpc:{...context,httpStatus:response.status}});
 const body=await response.json();if(body.error||!Object.hasOwn(body,'result'))throw Object.assign(Error('RECOVERY_RPC_UNAVAILABLE'),{rpc:{...context,rpcCode:typeof body.error?.code==='number'?body.error.code:null}});return body.result;
 });queue=task.catch(()=>{});return task;
 });
}
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const num=v=>Number(BigInt(v));
const plain=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));

export async function inspectRecoveryChain(native,pair,rpc,compiled,{maxGap=50000,observers={observePublic,observeRewards}}={}){
 const issues=[],add=(ok,code)=>{if(!ok)issues.push(code);};
 const c=native.config,index=native.states[3].index,head=native.projection.head;
 if(BigInt(await rpc('eth_chainId',[]))!==4663n)throw Error('RECOVERY_WRONG_CHAIN');
 const latest=await rpc('eth_getBlockByNumber',['latest',false]),finalized=await rpc('eth_getBlockByNumber',['finalized',false]);
 if(!latest||!finalized)throw Error('RECOVERY_HEAD_UNAVAILABLE');
 const tag=latest.number,at=toQuantity(head.number),canonical=[];
 const checked=new Set();
 async function canonicalBlock(number,expected,label,force=false){
  const key=String(number)+':'+expected;if(!force&&checked.has(key))return;checked.add(key);
  const block=await rpc('eth_getBlockByNumber',[toQuantity(number),false]);
  const ok=!!block&&same(block.hash,expected);add(ok,'NONCANONICAL_'+label);
  canonical.push({number:num(number),hash:expected,canonical:ok});
 }
 await canonicalBlock(c.manifest.anchor.number,c.manifest.anchor.hash,'ANCHOR');
 await canonicalBlock(head.number,head.hash,'NATIVE_HEAD');
 if(pair.pgHead)await canonicalBlock(pair.pgHead.number,pair.pgHead.hash,'PG_HEAD');
 add(num(head.number)<=num(finalized.number),'NATIVE_HEAD_NOT_FINALIZED');
 const nonce={latest:num(await rpc('eth_getTransactionCount',[c.executor,tag])),pending:num(await rpc('eth_getTransactionCount',[c.executor,'pending']))};
 add(nonce.latest===nonce.pending,'PENDING_SIGNER_NONCE');
 const journals=[];
 for(let i=0;i<3;i++){
  const state=native.states[i];
  if(state.pending){
   issues.push('UNRESOLVED_NATIVE_INTENT');
   const receipt=state.pending.transactionHash?await rpc('eth_getTransactionReceipt',[state.pending.transactionHash]):null;
   journals.push({state:i,pending:true,nonce:state.pending.nonce,transactionHash:state.pending.transactionHash??null,receipt:receipt?'mined-reconciliation-required':'not-observed'});
  }
  const p=state.lastResolved;if(!p)continue;
  const receipt=await rpc('eth_getTransactionReceipt',[p.transactionHash]);
  const tx=await rpc('eth_getTransactionByHash',[p.transactionHash]);
  const valid=receipt&&tx&&same(receipt.transactionHash,p.transactionHash)&&same(tx.hash,p.transactionHash)&&same(receipt.blockHash,p.blockHash)&&same(tx.from,c.executor)&&same(tx.to,p.target)&&same(tx.input,p.data)&&num(tx.nonce)===p.nonce&&num(receipt.status)===p.status&&BigInt(tx.value)===BigInt(p.value??0);
  add(valid,'RESOLVED_INTENT_MISMATCH');
  if(receipt){await canonicalBlock(receipt.blockNumber,receipt.blockHash,'RECEIPT');add(num(receipt.blockNumber)<=num(head.number),'INDEX_BEHIND_FINANCIAL_JOURNAL');}
  journals.push({state:i,pending:false,nonce:p.nonce,transactionHash:p.transactionHash,receipt:valid?'canonical-match':'mismatch'});
 }
 const known=journals.filter(x=>!x.pending&&Number.isSafeInteger(x.nonce));
 nonce.expected=known.length?Math.max(...known.map(x=>x.nonce))+1:null;
 add(nonce.expected!==null&&nonce.latest===nonce.expected,'NONCE_NOT_ACCOUNTED_BY_NATIVE_JOURNALS');
 const codePins=[[c.collector,c.codeHashes.collector],[c.escrow,c.codeHashes.escrow],
  [c.vault,c.lifecycle.vaultCodeHash],[c.lifecycle.source,c.lifecycle.sourceCodeHash],
  [c.lifecycle.monthlySource,c.lifecycle.monthlySourceCodeHash],[c.deliveryJob.adapter,c.deliveryJob.adapterCodeHash]];
 if(c.recognition)codePins.push([c.recognition.source,c.recognition.sourceCodeHash]);
 for(const [address,digest]of codePins)add(same(keccak256(await rpc('eth_getCode',[address,tag])),digest),'CONTRACT_RUNTIME_CHANGED');
 const quote=native.profile.quoteImplementation,slot=toBeHex(BigInt(require('ethers').id('eip1967.proxy.implementation'))-1n,32);
 add(same(await rpc('eth_getStorageAt',[c.manifest.quote,slot,tag]),zeroPadValue(quote.address,32))&&same(keccak256(await rpc('eth_getCode',[quote.address,tag])),quote.codeHash),'QUOTE_IMPLEMENTATION_CHANGED');
 // Replay-derived rewards are independently checked against storage at their original anchor.
 add(!!index.rewards&&Array.isArray(index.rewards.rewards),'REWARD_SNAPSHOT_MISSING');
 await observers.observeRewards({blocks:index.blocks,vault:c.vault,rpc,blockTag:at,fullAudit:true});
 const historical=await observers.observePublic({config:native.indexConfig,manifest:index.manifest,rpc,blockTag:at,blockHash:head.hash});
 const current=await observers.observePublic({config:native.indexConfig,manifest:index.manifest,rpc,blockTag:tag,blockHash:latest.hash});
 add(hash(historical.reserves)===hash(index.publicObservation?.reserves)&&hash(historical.timing)===hash(index.publicObservation?.timing),'SAVED_PUBLIC_OBSERVATION_MISMATCH');
 add(hash(current.reserves)===hash(historical.reserves)&&hash(current.timing)===hash(historical.timing),'RESERVES_OR_TIMING_CHANGED');
 const call=async(contract,address,name,args=[],blockTag=tag)=>{
  const abi=new Interface(compiled[contract].abi);
  return abi.decodeFunctionResult(name,await rpc('eth_call',[{to:address,data:abi.encodeFunctionData(name,args)},blockTag]));
 };
 const obligations={lanes:[],jobs:[],rewards:[],recognitions:[]};
 for(const [kind,contract,address,getter]of [['SHORT','RobinhoodShortController',c.lifecycle.source,'pendingDatasetDraw'],['MONTHLY','RobinhoodMonthlyController',c.lifecycle.monthlySource,'pendingMonth']]){
  const [draw]=await call(contract,address,getter),[savedDraw]=await call(contract,address,getter,[],at);
  add(same(draw,savedDraw),'FROZEN_DRAW_CHANGED');
  const lane={kind,draw};
  if(draw!==ZeroHash){
   const [requestId]=await call(contract,address,'drawRequest',[draw]);
   const binding=await call(contract,address,'requests',[requestId]),request=await call('DrandRandomAdapter',c.deliveryJob.adapter,'requests',[requestId]);
   add(same(binding.drawId,draw)&&same(binding.context,request.context)&&same(request.consumer,address)&&binding.delivered===request.delivered&&request.round>0n,'RNG_BINDING_MISMATCH');
   Object.assign(lane,{requestId:String(requestId),round:String(request.round),context:request.context,delivered:request.delivered});
  }
  obligations.lanes.push(lane);
  for(const entry of native.states[1].jobs[kind]){
   if(entry.terminalChecked)await canonicalBlock(entry.terminalChecked.number,entry.terminalChecked.hash,'TERMINAL');
   if(!entry.job)continue;
   const key=kind==='SHORT'?entry.job.proposalId:entry.job.artifact.request.drawId;
   const method=kind==='SHORT'?'datasetProposal':'month';
   const [saved]=await call(contract,address,method,[key],at),[now]=await call(contract,address,method,[key]);
   add(hash(plain(saved))===hash(plain(now)),'NATIVE_JOB_STORAGE_CHANGED');
   const phase=Number(kind==='SHORT'?now.status:now.phase);
   add(!entry.started||phase!==0,'STARTED_JOB_DISAPPEARED');
   if(entry.terminalChecked){
    const terminal=kind==='SHORT'?phase===4&&Number((await call(contract,address,'settlements',[entry.job.artifact.request.drawId])).phase)===3:phase===5;
    add(terminal,'NATIVE_TERMINAL_CONFLICT');
   }
   obligations.jobs.push({kind,key,phase,storageHash:hash(plain(now)),terminalChecked:!!entry.terminalChecked});
  }
 }
 for(const r of index.rewards?.rewards??[]){
  const [due]=await call('DualControllerPromoVault',c.vault,'reward',[r.drawId,r.winner]);
  add(due===(r.status==='paid'?0n:BigInt(r.amountRaw)),'REWARD_ALREADY_PAID_OR_CHANGED');
  obligations.rewards.push({draw:r.drawId,winner:r.winner,due:String(due),savedStatus:r.status});
 }
 if(c.recognition){
  const published=new Interface(['function published(bytes32) view returns(bool)']);
  const bundles=new Set();
  for(const block of index.blocks)for(const {receipt}of block.transactions)for(const log of receipt.logs){
   if(!same(log.address,c.recognition.source))continue;
   let event;try{event=recognitionAbi.parseLog(log);}catch{continue;}
   if(event?.name==='PurchasesRecognized')bundles.add(event.args.bundleHash);
  }
  for(const bundle of bundles){
   const [yes]=published.decodeFunctionResult('published',await rpc('eth_call',[{to:c.recognition.source,data:published.encodeFunctionData('published',[bundle])},tag]));
   add(yes,'RECOGNITION_COMMITMENT_MISSING');obligations.recognitions.push({bundleHash:bundle,published:yes});
  }
 }
 // Never declare an old index current merely because the sender's nonce did not move.
 const gap=num(latest.number)-num(head.number);
 if(gap<0||gap>maxGap)issues.push('INDEX_CATCHUP_REQUIRED');
 else{
  const address=[...new Set([c.manifest.token,c.lifecycle.source,c.lifecycle.monthlySource,c.vault,c.collector,...(c.recognition?[c.recognition.source]:[])])];
  for(let from=num(head.number)+1;from<=num(latest.number);from+=500){
   const logs=await rpc('eth_getLogs',[{address,fromBlock:toQuantity(from),toBlock:toQuantity(Math.min(from+499,num(latest.number)))}]);
   if(logs.length){issues.push('UNINDEXED_PROJECT_EVENTS');break;}
  }
 }
 await canonicalBlock(latest.number,latest.hash,'OBSERVATION_HEAD',true);
 const after=num(await rpc('eth_getTransactionCount',[c.executor,'latest']));
 add(after===nonce.latest&&num(await rpc('eth_getTransactionCount',[c.executor,'pending']))===nonce.pending,'SIGNER_CHANGED_DURING_PREFLIGHT');
 return {issues:[...new Set(issues)],observedAt:new Date().toISOString(),observationHead:{number:num(latest.number),hash:latest.hash},finalizedHead:{number:num(finalized.number),hash:finalized.hash},nonce,canonical,journals,obligations,reserves:current.reserves,indexGap:gap};
}
