const network=require('./runtime-network.cjs');
const {ethers}=require('ethers');
const {withState}=require('./local-scheduler-state.cjs');
const {sendLocalTransaction,withTransactionBoundary,receiptOptions}=require('./local-receipt.cjs');
const {retryableRead,transientRpc}=require('./local-rpc-watch.cjs');
const {PROFILE}=require('./drand-preflight.cjs');
const CHAIN_HASH='0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3';
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase(),check=(v,m)=>{if(!v)throw Error(m);};
const abi=['function PROFILE() view returns(bytes32)','function CHAIN_HASH() view returns(bytes32)',
 'function shortConsumer() view returns(address)','function monthlyConsumer() view returns(address)',
 'function requests(uint256) view returns(address consumer,bytes32 context,uint64 round,bool proven,bool delivered,bytes32 seed)',
 'function verify(uint64,bytes) view returns(bool)','function prove(uint256,bytes) returns(bytes32)','function deliver(uint256)'];
const consumerAbi=['function randomProvider() view returns(address)','function pendingDatasetDraw() view returns(bytes32)',
 'function pendingMonth() view returns(bytes32)','function drawRequest(bytes32) view returns(uint256)',
 'function requests(uint256) view returns(bytes32 drawId,bytes32 context,bool delivered)'];
function validateJob(j){
 check(j.schema===network.schema('local-drand-delivery-v1'),'Explicit worker network schema required');network.checkChain(j.chainId);
 for(const k of ['adapter','short','monthly']){check(ethers.isAddress(j[k])&&!same(j[k],ethers.ZeroAddress),'Invalid '+k);check(/^0x[0-9a-fA-F]{64}$/.test(j[k+'CodeHash']||''),'Missing runtime '+k);}
 check(new Set(['adapter','short','monthly'].map(k=>j[k].toLowerCase())).size===3,'Distinct bindings required');
 check(Number.isSafeInteger(j.anchor?.number)&&j.anchor.number>=0&&/^0x[0-9a-fA-F]{64}$/.test(j.anchor.hash),'Invalid deployment anchor');
 check(BigInt(j.maxGasPrice)>0n&&BigInt(j.nativeFloor)>=0n,'Invalid gas limits');
 for(const k of ['prove','deliver'])check(BigInt(j.gasUnits?.[k])>0n,'Missing gas floor');
 check(Number.isInteger(j.pollSeconds)&&j.pollSeconds>=10&&j.pollSeconds<=86400,'Invalid poll interval');
 return j;
}
async function fetchBeacon(round,{signal}={}){
 const response=await fetch('https://api.drand.sh/'+CHAIN_HASH.slice(2)+'/public/'+round,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Beacon HTTP '+response.status);
 return response.json();
}
async function runDrandDelivery({provider,adapter,executor,job,statePath,signal,receiptTimeoutMs=30000,reconcileOnly=false,transactionGuard,transactionGasLimit,transactionEstimateFailed,kinds=['short','monthly']},{getBeacon=fetchBeacon,onStep=()=>{}}={}){
 check(!transactionGasLimit||typeof transactionGasLimit==='function'&&typeof transactionGuard==='function','Estimated gas policy requires parent guard');
 check(Array.isArray(kinds)&&kinds.length>0&&new Set(kinds).size===kinds.length&&kinds.every(k=>['short','monthly'].includes(k)),'Invalid delivery kinds');
 job=JSON.parse(JSON.stringify(validateJob(job)));receiptOptions(receiptTimeoutMs);
 check(executor?.provider===provider,'Signer/provider mismatch');check(adapter.runner===provider||adapter.runner?.provider===provider,'Adapter/provider mismatch');
 check(same(adapter.target,job.adapter),'Adapter mismatch');network.checkChain((await provider.getNetwork()).chainId);
 const sender=await executor.getAddress();
 const normalize=v=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):typeof v==='string'&&/^0x[0-9a-fA-F]+$/.test(v)?v.toLowerCase():v;
 return withState(statePath,normalize({worker:'drand-delivery-v1',job,sender}),async(state,save)=>{
  const steps=[],failures=[],requests=[];
  const result=(status,reason,extra={})=>({status,...(reason?{reason}:{}),steps,failures,requests,...extra});
  const blocked=reason=>result('blocked',reason,{requiresReconciliation:true,pending:state.pending});
  const wait=reason=>{throw Object.assign(Error(reason),{workerWait:reason});};
  try{
   if(signal?.aborted)return result('stopped','aborted');
   check(same((await provider.getBlock(job.anchor.number))?.hash,job.anchor.hash),'Deployment anchor mismatch');
   if(state.pending){
    if(!state.pending.transactionHash)return blocked('unknownHash');
    const r=await provider.getTransactionReceipt(state.pending.transactionHash);if(!r)return blocked('pendingReceipt');
    const b=await provider.getBlock(r.blockNumber),tx=await provider.getTransaction(state.pending.transactionHash);
    if(!b||!same(b.hash,r.blockHash)||!same(r.hash,state.pending.transactionHash)||![0,1].includes(r.status)||!tx||!same(tx.hash,state.pending.transactionHash)||tx.nonce!==state.pending.nonce||!same(tx.from,sender)||!same(tx.to,state.pending.target)||!same(tx.data,state.pending.data))return blocked('unconfirmedReceipt');
    state.lastResolved={...state.pending,status:r.status,blockHash:r.blockHash};delete state.pending;save(state);
   }
   if(reconcileOnly)return result('complete');
   const head=await provider.getBlock('latest'),at={blockTag:head.number};
   for(const k of ['adapter','short','monthly'])check(same(ethers.keccak256(await provider.getCode(job[k],head.number)),job[k+'CodeHash']),'Runtime mismatch '+k);
   check(await adapter.PROFILE(at)===PROFILE&&same(await adapter.CHAIN_HASH(at),CHAIN_HASH),'Unsupported drand profile');
   check(same(await adapter.shortConsumer(at),job.short)&&same(await adapter.monthlyConsumer(at),job.monthly),'Consumer binding mismatch');
   const lanes=[];
   // At most one frozen request per controller. Completed draws cannot leave undelivered RNG behind.
   for(const [kind,getter]of [['short','pendingDatasetDraw'],['monthly','pendingMonth']]){
    if(!kinds.includes(kind))continue;
    const c=new ethers.Contract(job[kind],consumerAbi,provider);check(same(await c.randomProvider(at),job.adapter),'Reverse provider binding mismatch');
    const draw=await c[getter](at);if(draw===ethers.ZeroHash)continue;
    const id=await c.drawRequest(draw,at);check(id>0n,'Frozen draw has no RNG request');
    const b=await c.requests(id,at),r=await adapter.requests(id,at);
    check(same(b.drawId,draw)&&same(b.context,r.context)&&same(r.consumer,job[kind])&&r.round>0n&&b.delivered===r.delivered,'Request/context binding mismatch');
    lanes.push({kind,id,round:r.round,context:r.context,consumer:r.consumer});
   }
   async function budget(request,action){
    if(signal?.aborted)throw Object.assign(Error('Aborted'),{code:'LOCAL_EXECUTION_STOPPED'});
    const price=(await provider.getFeeData()).gasPrice;if(price==null||price>BigInt(job.maxGasPrice))wait('gasPrice');
    // Pons parent guard budgets the estimated current transaction. Other callers
    // retain their existing standalone floor, job identity and budget semantics.
    if(!transactionGasLimit){const units=BigInt(request.gasLimit??job.gasUnits[action]),required=units*BigInt(request.maxFeePerGas??price)+BigInt(job.nativeFloor);
     if(await provider.getBalance(sender)<required)wait('nativeFunding');}
    if(await provider.getTransactionCount(sender,'pending')>await provider.getTransactionCount(sender,'latest'))wait('pendingSigner');
    if(!same((await provider.getBlock(head.number))?.hash,head.hash))wait('chainChanged');
   }
   const boundary={maxGasPrice:job.maxGasPrice,gasLimit:transactionGasLimit,estimateFailed:transactionEstimateFailed,preflight:async(request,action)=>{await transactionGuard?.(request,action,false);await budget(request,action);},before:async(request,action)=>{
    await transactionGuard?.(request,action,true);await budget(request,action);check(!state.pending,'Unresolved intent');
    state.pending={worker:'drand',action,target:request.to,data:request.data,from:sender,stage:'broadcast'};save(state);
   },sent:async tx=>{state.pending={...state.pending,transactionHash:tx.hash,nonce:tx.nonce,stage:'confirm'};save(state);},confirmed:async r=>{
    check(same(r.hash,state.pending?.transactionHash),'Receipt mismatch');const block=await provider.getBlock(r.blockNumber);check(same(block?.hash,r.blockHash),'Receipt not canonical');
    state.lastResolved={...state.pending,status:r.status,blockHash:r.blockHash};delete state.pending;save(state);
   }};
   async function send(action,args){
    const price=(await provider.getFeeData()).gasPrice;if(price==null||price>BigInt(job.maxGasPrice))wait('gasPrice');
    const receipt=await withTransactionBoundary(boundary,()=>sendLocalTransaction(adapter.connect(executor)[action],args,{from:sender,type:2,maxFeePerGas:price,maxPriorityFeePerGas:0},{signal,receiptTimeoutMs}));
    const step={action,requestId:String(args[0]),transactionHash:receipt.hash};steps.push(step);await onStep(step);
   }
   for(const lane of lanes){
    const id=String(lane.id),record={kind:lane.kind,requestId:id,round:String(lane.round)};requests.push(record);
    let r=await adapter.requests(lane.id);check(same(r.consumer,lane.consumer)&&same(r.context,lane.context)&&r.round===lane.round,'Request changed');
    if(r.delivered){record.status='delivered';continue;}
    if(!r.proven){
     if(BigInt((await provider.getBlock('latest')).timestamp)<1727521075n+(r.round-1n)*3n){record.status='waiting';record.reason='roundNotDue';continue;}
     let beacon;
     try{beacon=await getBeacon(String(r.round),{signal});}catch(e){if(signal?.aborted)throw e;record.status='waiting';record.reason='beaconUnavailable';continue;}
     if(!Number.isSafeInteger(beacon?.round)||BigInt(beacon.round)!==r.round||!/^[0-9a-fA-F]{128}$/.test(beacon.signature||'')){
      record.status='rejected';failures.push({...record,reason:'invalidBeacon'});continue;
     }
     const signature='0x'+beacon.signature;
     if(!await adapter.verify(r.round,signature)){record.status='rejected';failures.push({...record,reason:'invalidProof'});continue;}
     // Another permissionless keeper may have completed this step while HTTP was pending.
     r=await adapter.requests(lane.id);
     if(!r.proven)try{await send('prove',[lane.id,signature]);}catch(e){if(transactionGasLimit&&e.budget?.reason==='nativeFunding'){record.status='waiting';record.reason='nativeFunding';continue;}if(e.definiteRejection){record.status='rejected';failures.push({...record,reason:'proveRejected'});continue;}throw e;}
    }
    r=await adapter.requests(lane.id);
    if(!r.delivered)try{await send('deliver',[lane.id]);}catch(e){if(transactionGasLimit&&e.budget?.reason==='nativeFunding'){record.status='waiting';record.reason='nativeFunding';continue;}if(e.definiteRejection){record.status='rejected';failures.push({...record,reason:'callbackRejected'});continue;}throw e;}
    record.status='delivered';
   }
   return result(failures.length?'degraded':requests.some(r=>r.status==='waiting')?'waiting':'complete');
  }catch(e){
   if(state.pending){if(state.pending.transactionHash&&e.code==='LOCAL_RECEIPT_TIMEOUT')return blocked('pendingReceipt');return {...blocked('unknownTransaction'),retryableRpcRead:!!state.pending.transactionHash&&((e.stage==='confirm'&&transientRpc(e))||retryableRead(e))};}
   if(e.workerWait||e.cause?.workerWait)return result('waiting',e.workerWait||e.cause.workerWait);
   if(e.code==='INSUFFICIENT_FUNDS'||e.cause?.code==='INSUFFICIENT_FUNDS')return result('waiting','nativeFunding');
   if(signal?.aborted||e.code==='LOCAL_EXECUTION_STOPPED')return result('stopped','aborted');
   return result('error',undefined,{retryableRpcRead:retryableRead(e),error:{message:e.message,code:e.code}});
  }
 });
}
module.exports={runDrandDelivery,validateJob,abi,fetchBeacon};
