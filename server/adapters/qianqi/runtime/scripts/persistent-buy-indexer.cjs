// Durable evidence cache. The existing scanner and replay remain authoritative.
const fs=require('node:fs');
const {hash,replay,replayWithCheckpoint}=require('./direct-buy.cjs');
const {validIndexerChecksum}=require('./indexer-checksum.cjs');
const {scanWithRpc}=require('./replay-direct-buy.cjs');
const {resolveBuyPolicy}=require('./buy-policy-runtime.cjs');
const {withState}=require('./local-scheduler-state.cjs');
const tag=n=>'0x'+BigInt(n).toString(16);
const check=(v,m)=>{if(!v)throw Error(m);};
const nextDelay=status=>status?.state==='catchingUp'?0:10000;
// Bump when replay semantics change; never reuse a ledger produced by an older engine.
const REPLAY_REVISION='buy-replay-checkpoint-v3-recognition';
async function readSnapshot({config,statePath,manifest,cutoff,rpc,now=Date.now()}){
 const waiting=reason=>{throw Object.assign(Error(reason),{code:'INDEXER_WAIT',reason});};
 let state;
 try{const {checksum,...stored}=JSON.parse(fs.readFileSync(statePath,'utf8'));
  if(!validIndexerChecksum(stored,checksum)||stored.configHash!==hash({kind:'persistent-buy-indexer-v1',config}))return waiting('indexerIdentity');state=stored;
 }catch(e){if(e.code==='INDEXER_WAIT')throw e;return waiting('indexerUnavailable');}
 const index=state.index,status=state.status,age=now-Date.parse(status?.updatedAt);
 if(!index||!['caughtUp','catchingUp'].includes(status?.state)||!Number.isFinite(age)||age<0||age>config.indexer.maxAgeSeconds*1000)return waiting('indexerStale');
 if(index.policyStatus?.mode!=='admitted')return waiting('indexerUnadmitted');
 if(index.head<cutoff)return waiting('indexerBehind');
 const saved=index.manifest.versions?require('./buy-policy-runtime.cjs').prefix(index.manifest,cutoff):index.manifest;
 if(hash(saved)!==hash(manifest))return waiting('indexerPolicy');
 let blocks=index.blocks.filter(b=>BigInt(b.number)<=BigInt(cutoff));
 const current=await rpc('eth_getBlockByNumber',[tag(cutoff),false]);
 if(index.evidenceMode==='pons-project-events-v1'){
  if(!current||Number(BigInt(current.number))!==cutoff)return waiting('indexerBranch');
  const savedHead=await rpc('eth_getBlockByNumber',[tag(index.head),false]);
  if(savedHead?.hash!==index.blocks.at(-1)?.hash)return waiting('indexerBranch');
  if(!blocks.length||Number(BigInt(blocks.at(-1).number))!==cutoff)blocks.push({number:current.number,hash:current.hash,parentHash:current.parentHash,timestamp:current.timestamp,transactions:[]});
  blocks=require('./project-history.cjs').mark(blocks,manifest,config.lifecycle,undefined,[config.buyPolicy?.source,config.recognition?.source]);
 }
 const head=blocks.at(-1);
 if(!head||BigInt(head.number)!==BigInt(cutoff)||head.hash!==current?.hash)return waiting('indexerBranch');
 // Never consume cached minted totals as open attempts. Caller runs lifecycle replay.
 replay(manifest,blocks);
 return {manifest,blocks};
}
async function indexOnce({config,rpc,statePath,batchSize=config.indexer?.batchSize??100,reorgLimit=128,fullRewardAudit=false}){
 check(Number.isInteger(batchSize)&&batchSize>0&&batchSize<=1000,'Invalid index batch');
 check(Number.isInteger(reorgLimit)&&reorgLimit>=0&&reorgLimit<=10000,'Invalid reorg limit');
 if(config.indexer?.scanMode)rpc=require('./index-read-rpc.cjs').pacedReads(rpc);
 const started=performance.now();
 return withState(statePath,{kind:'persistent-buy-indexer-v1',config},async(state,save)=>{
  try{
   const m=config.manifest,anchor=Number(m.anchor.number);
   check(BigInt(await rpc('eth_chainId',[]))===BigInt(m.chainId),'Wrong RPC chain');
   const finalized=await rpc('eth_getBlockByNumber',['finalized',false]);
   const target=Number(BigInt(finalized.number));check(Number.isSafeInteger(target)&&target>=anchor,'Finalized head before anchor');
   const a=await rpc('eth_getBlockByNumber',[tag(anchor),false]);check(a.hash.toLowerCase()===m.anchor.hash.toLowerCase(),'Anchor is not canonical');
   const prior=state.index||{blocks:[],cache:{},head:anchor};
   check(target>=prior.head,'Finalized head regressed; wait for consistent RPC');
   let keep=prior.blocks.length,removed=0;
   while(keep){
    const b=prior.blocks[keep-1],current=await rpc('eth_getBlockByNumber',[tag(b.number),false]);
    if(current.hash.toLowerCase()===b.hash.toLowerCase())break;
    check(removed<reorgLimit,'Reorg exceeds configured limit; independent review required');
    keep--;removed++;
    if(prior.evidenceMode==='pons-project-events-v1'&&keep)check(prior.head-Number(BigInt(prior.blocks[keep-1].number))<=reorgLimit,'Reorg exceeds retained project tail; independent review required');
   }
   const base=keep?Number(BigInt(prior.blocks[keep-1].number)):anchor;
   const end=Math.min(target,base+batchSize),cache={};
   // The canonical prefix lives in blocks. RPC cache is only an acceleration
   // for the recent tail, not a second permanent copy of the full history.
   const cacheFloor=Math.max(anchor,end-reorgLimit);
   for(const [key,row] of Object.entries(prior.cache))if(row.height>=cacheFloor&&row.height<=base)cache[key]=row;
   let cacheHits=0;
   const read=async(method,params=[])=>{
    let height=anchor;
    let cacheable=false;
    if(method==='eth_getBlockByNumber'&&params[1]===true){height=Number(BigInt(params[0]));cacheable=true;}
    else if(method==='eth_getCode'){height=Number(BigInt(params[1]));cacheable=true;}
    // Pons bindings are checked at evidence-bearing blocks. Cache only fixed-height
    // calls, never latest/finalized or state overrides. Tail rollback evicts them.
    else if(method==='eth_call'&&params.length===2&&/^0x[0-9a-f]+$/i.test(params[1])){height=Number(BigInt(params[1]));cacheable=true;}
    else if(method==='eth_getTransactionReceipt')cacheable=true;
    const key=hash({method,params});
    if(cacheable&&cache[key]){cacheHits++;return structuredClone(cache[key].value);}
    const value=await rpc(method,params);check(value!=null,'Missing indexer RPC result');
    // A parent-state read can precede a receipt (delegated-account batches).
    // Bind receipt eviction to its own block, not the last RPC read's height.
    const cacheHeight=method==='eth_getTransactionReceipt'?Number(BigInt(value.blockNumber)):height;
    if(cacheable&&cacheHeight>=cacheFloor)cache[key]={height:cacheHeight,value:structuredClone(value)};
    return value;
   };
   const resolved=await resolveBuyPolicy(config,rpc,end);
   const scanStarted=performance.now();
   const project=config.indexer?.scanMode==='pons-project-events-v1';
   const suffix=end>base?await scanWithRpc(resolved.manifest,read,end,config.lifecycle,{fromBlock:base+1,mode:config.indexer?.scanMode,watchAddresses:[config.buyPolicy?.source,config.recognition?.source]}):{blocks:[]};
   if(project&&suffix.blocks.length)require('./project-history.cjs').validate(suffix.blocks[0],resolved.manifest,{number:base,hash:keep?prior.blocks[keep-1].hash.toLowerCase():m.anchor.hash.toLowerCase()});
   await require('./purchase-recognition.cjs').hydrate(resolved.manifest,suffix.blocks,config.recognition,read);
   const joined=[...prior.blocks.slice(0,keep),...suffix.blocks];
   const input={manifest:resolved.manifest,blocks:project?require('./project-history.cjs').compact(joined,resolved.manifest,config.lifecycle,{tail:128,extra:[config.buyPolicy?.source,config.recognition?.source]}):joined};
   const scanMs=performance.now()-scanStarted,replayStarted=performance.now();
   const sameReplay=!resolved.manifest.recognition&&!project&&!fullRewardAudit&&!removed&&prior.replayRevision===REPLAY_REVISION&&prior.ledger&&hash(prior.manifest)===hash(input.manifest);
   const unchanged=sameReplay&&end===base&&prior.replayCheckpoint?.schema==='buy-replay-checkpoint-v1';
   const continued=sameReplay&&end>base&&prior.replayCheckpoint?.schema==='buy-replay-checkpoint-v1'
    &&prior.replayCheckpoint.head?.number===base&&prior.replayCheckpoint.head.hash===prior.blocks[keep-1]?.hash;
   const rebuilt=end>anchor&&!unchanged?replayWithCheckpoint(input.manifest,continued?suffix.blocks:input.blocks,continued?{ledger:prior.ledger,checkpoint:prior.replayCheckpoint}:null):null;
   const ledger=end>anchor?(unchanged?prior.ledger:rebuilt.ledger):null;
   const replayCheckpoint=unchanged?prior.replayCheckpoint:rebuilt?.checkpoint??null;
   const replayMs=performance.now()-replayStarted,rewardStarted=performance.now();
   const rewards=config.lifecycle&&end>anchor?(unchanged&&prior.rewards?prior.rewards:await require('./reward-observation.cjs').observeRewards({blocks:input.blocks,vault:config.lifecycle.vault,rpc,blockTag:tag(end),previous:removed?null:prior.rewards,fullAudit:fullRewardAudit})):null;
   let publicObservation=null,publicProjection=null;
   if(config.publicStatus===true&&end>anchor){
    const binding={head:end,blockHash:input.blocks.at(-1).hash,manifestHash:hash(input.manifest)};
    try{publicObservation=await require('./public-observation.cjs').observePublic({config,manifest:input.manifest,rpc,blockTag:tag(end),blockHash:binding.blockHash});publicProjection={...binding,state:'available'};}
    catch(e){if(e.code!=='RPC_READ_UNAVAILABLE')throw Object.assign(Error('Public projection integrity/read failure'),{code:'PUBLIC_PROJECTION_FAILURE',cause:e});publicProjection={...binding,state:'unavailable',reason:'rpcUnavailable'};}
   }
   check((await rpc('eth_getBlockByNumber',[finalized.number,false])).hash===finalized.hash,'Finalized branch changed during indexing');
   // Publish evidence and derived ledger together; failure leaves the last good snapshot intact.
   state.index={head:end,observedAt:new Date().toISOString(),blocks:input.blocks,cache,manifest:input.manifest,ledger,ledgerHash:unchanged?prior.ledgerHash:replayCheckpoint?.ledgerHash??null,replayCheckpoint,replayRevision:REPLAY_REVISION,rewards,publicObservation,publicProjection,policyStatus:resolved.policyStatus,...(project?{evidenceMode:'pons-project-events-v1'}:{})};
   state.status={state:end===target?'caughtUp':'catchingUp',processedBlock:end,targetBlock:target,removedBlocks:removed,cacheHits,updatedAt:new Date().toISOString()};
   state.status.metrics={lagBlocks:target-end,coveredBlocks:end-anchor,historyBlocks:input.blocks.length,scannedBlocks:suffix.blocks.length,replayedBlocks:unchanged?0:continued?suffix.blocks.length:input.blocks.length,replayMode:unchanged?'reused':continued?'checkpoint':'full',scanMs,replayMs,rewardMs:performance.now()-rewardStarted,beforeSaveMs:performance.now()-started};
   const saveStarted=performance.now();save(state);
   // Final write timing is returned/logged, not followed by another state write.
   return {...state.status,observedAt:state.index.observedAt,policyMode:resolved.policyStatus.mode,processedTimestamp:input.blocks.at(-1)?.timestamp??null,metrics:{...state.status.metrics,saveMs:performance.now()-saveStarted,totalMs:performance.now()-started,stateBytes:fs.statSync(statePath).size}};
  }catch(e){
   if(e.code==='SCHEDULER_STORAGE_ERROR')throw e;
   state.status={state:'waiting',processedBlock:state.index?.head??Number(config.manifest.anchor.number),reason:e.code==='PUBLIC_PROJECTION_FAILURE'?'publicProjectionIntegrityOrReadFailure':'Read or validation failed; last good snapshot retained',updatedAt:new Date().toISOString()};
   save(state);throw e;
  }
 },{indexerFormat:true});
}
async function main(){
 const [configFile,statePath,mode='once']=process.argv.slice(2);
 check(configFile&&statePath&&['once','watch','audit'].includes(mode),'Usage: CONFIG STATE [once|watch|audit], RH_RPC_URL required');
 check(process.env.RH_RPC_URL,'RH_RPC_URL required');
 const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
 const rpc=require('./public-rpc-qualification.cjs').httpRpc(process.env.RH_RPC_URL);
 let stopping=false;process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
 do{let status;try{status=await indexOnce({config,rpc,statePath,fullRewardAudit:mode==='audit'});console.log(JSON.stringify(status));}catch{console.error('Indexer waiting: RPC, policy, state or branch validation failed');if(mode!=='watch'){process.exitCode=1;return;}}
 if(mode!=='watch'||stopping)break;await new Promise(r=>setTimeout(r,nextDelay(status)));
 }while(!stopping);
}
module.exports={indexOnce,readSnapshot,nextDelay};
if(require.main===module)main().catch(()=>{console.error('Indexer configuration failure');process.exitCode=1;});
