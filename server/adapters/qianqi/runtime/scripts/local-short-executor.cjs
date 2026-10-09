const network=require('./runtime-network.cjs');
const {sendLocalTransaction,receiptOptions}=require('./local-receipt.cjs');
// Local-only, single-job executor. The chain is the progress journal.
const {ethers}=require('ethers');
const dataset=require('./short-dataset.cjs'),settlement=require('./short-settlement.cjs');
const {hash}=require('./direct-buy.cjs');
const {verifyDualBindings}=require('./dual-bindings.cjs');
const cache=require('./verified-draw-cache.cjs');
const validateCachedJob=(provider,job)=>cache.validate(provider,'SHORT',job,validateJob);
const check=(ok,message)=>{if(!ok)throw Error(message);};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
function makeJob(artifact,proposalId,chunkSize=64){
  const job={schema:'local-short-job-v1',proposalId,chunkSize,artifact};
  job.commitment=hash(job);validateJob(job);return job;
}
function validateJob(job){
  const {commitment,...payload}=job;
  check(job.schema==='local-short-job-v1'&&hash(payload)===commitment,'Job checksum mismatch');
  check(ethers.isHexString(job.proposalId,32)&&job.proposalId!==ethers.ZeroHash,'Invalid proposal identity');
  check(Number.isInteger(job.chunkSize)&&job.chunkSize>0&&job.chunkSize<=64,'Invalid chunk size');
  const a=job.artifact,r=a.request,s=a.snapshot;
  check(a.schema==='short-dataset-artifact-v1'&&s.kind==='SHORT'&&s.domain.schema==='attempt-lifecycle-v4','Expected v4 Short artifact');
  require('./draw-id.cjs').validateDrawId(r.drawId,'SHORT');
  check(hash(s)===r.snapshotHash&&s.drawId===r.drawId&&String(s.rulesEpoch)===String(r.rulesEpoch)
    &&String(s.cutoff.blockNumber)===String(r.cutoffBlockNumber)&&s.cutoff.blockHash===r.cutoffBlockHash,'Snapshot metadata mismatch');
  check(s.participants.length>0&&s.participants.length===Number(r.expectedCount)
    &&dataset.rootFor(s.participants)===r.expectedRoot,'Artifact participants mismatch');
  check(s.participants.every(p=>BigInt(p.count)===BigInt(p.lastAttempt)-BigInt(p.firstAttempt)+1n)
    &&s.participants.reduce((n,p)=>n+BigInt(p.count),0n)===BigInt(r.expectedAttempts),'Artifact attempts mismatch');
  check(dataset.rulesHash(a.rules,a.weights,a.minimumUnit)===s.rulesHash,'Artifact rules mismatch');
  return a;
}

async function stepShort(options){return cache.guarded(options.provider,'SHORT',()=>stepVerified(options));}
async function stepVerified({provider,source,job,publisher,executor,gasPrice,signal,receiptTimeoutMs=30000}){
  receiptOptions(receiptTimeoutMs);
  const verified=cache.get(provider,'SHORT',job,validateJob);job=verified.job;
  const a=job.artifact,r=a.request,domain=a.snapshot.domain;
  network.checkChain((await provider.getNetwork()).chainId);network.checkChain(domain.chainId);
  check(same(source.target,domain.source),'Wrong controller');
  await verifyDualBindings(provider,domain);
  await dataset.verifyEpochGenesis(provider,source.target,domain);
  const cutoff=await provider.getBlock(Number(r.cutoffBlockNumber));
  check(cutoff&&same(cutoff.hash,r.cutoffBlockHash),'Cutoff no longer canonical; do not replace frozen job');
  const policy=await source.shortEpochPolicy(r.rulesEpoch);
  check(policy.hash===a.snapshot.rulesHash,'On-chain policy mismatch');
  const p=await source.datasetProposal(job.proposalId);
  const wait=reason=>({status:'waiting',reason,drawId:r.drawId});
  async function send(signer,method,args){
    if(!signer)return wait(method==='begin'||method==='publish'?'publisher':'executor');
    if(price>await source.maxGasPrice())return wait('gasPrice');
    const address=await signer.getAddress();
    // No replacement transaction/nonce guessing after an ambiguous send.
    if(await provider.getTransactionCount(address,'pending')>await provider.getTransactionCount(address,'latest'))return wait('pendingTransaction');
    // Typed transactions retain an explicit chainId in Hardhat's raw RPC history.
    // price is a conservative fee cap; actual effective price may be lower.
    if(signal?.aborted)return {status:'stopped'};
    const receipt=await sendLocalTransaction(source.connect(signer)[method],args,
      {type:2,maxFeePerGas:price,maxPriorityFeePerGas:0},{signal,receiptTimeoutMs});
    check(receipt&&receipt.status===1,'Transaction not confirmed');
    return {status:'progress',action:method,drawId:r.drawId,transactionHash:receipt.hash};
  }
  const price=gasPrice==null?(await provider.getFeeData()).gasPrice:BigInt(gasPrice);
  check(price!=null&&price>=0n,'Missing gas price');
  const ps=a.snapshot.participants;
  if(p.status===3n)throw Error('Proposal superseded; explicit new job required');
  if(p.status!==0n){
    for(const key of Object.keys(r))check(same(p.request[key],r[key]),'Existing proposal differs: '+key);
    check(p.rulesHash===a.snapshot.rulesHash,'Existing proposal rules differ');
  }
  if(p.status===0n||p.status===1n){
    if(!publisher||!same(await publisher.getAddress(),await source.publisher()))return wait('publisher');
    if(p.status===0n){
      if(await source.activeProposal()!==ethers.ZeroHash||await source.pendingDatasetDraw()!==ethers.ZeroHash)return wait('otherDraw');
      const head=await provider.getBlock('latest');
      check(head.number+1-Number(r.cutoffBlockNumber)<=256||await source.cutoffHashes(r.cutoffBlockNumber)===r.cutoffBlockHash,'Cutoff expired before begin; rebuild unfrozen job');
      if(BigInt(head.timestamp)<await source.lastShortTerminalAt()+await source.SHORT_INTERVAL())return wait('schedule');
      if(BigInt(head.number+1)<BigInt(r.cutoffBlockNumber)+await source.cutoffDelayBlocks())return wait('cutoffDelay');
      return send(publisher,'begin',[job.proposalId,r]);
    }
    const count=Number(p.count);
    const prefix=verified.prefix(count);
    check(count<ps.length&&p.root===prefix.root,'Published prefix differs');
    check(p.totalAttempts===prefix.attempts,'Published attempts differ');
    return send(publisher,'publish',[job.proposalId,ps.slice(count,count+job.chunkSize)]);
  }
  const binding=p=>({request:Array.from(p.request),root:p.root,count:p.count,totalAttempts:p.totalAttempts,rulesHash:p.rulesHash,basketHash:p.basketHash,context:p.context,status:p.status});
  const publication=await verified.publication(binding(p),async blockTag=>binding(await source.datasetProposal(job.proposalId,{blockTag})),
    blockTag=>dataset.verifyPublication(provider,source,job.proposalId,a,{blockTag}));
  if(p.status===2n){
    if(!executor)return wait('executor');
    if(!await require('./execution-readiness.cjs').executionReady(provider,source,price))return wait('executionReadiness');
    const rng=await require('./drand-preflight.cjs').drandPreflight(provider,source);
    if(rng&&rng.status!=='observedHealthy')return wait('rng:'+rng.reasons.join(','));
    // The journaled sender estimates the real reserve before any intent/broadcast.
    // A separate eth_call without gasLimit can require the RPC's entire gas cap
    // in sender ETH even when the actual transaction is affordable.
    try{return await send(executor,'seal',[job.proposalId]);}
    catch(error){
      if(error.stage==='estimate'&&error.definiteRejection&&error.cause?.data===ethers.id('InsufficientAvailable()').slice(0,10))return wait('prizeFunding');
      throw error;
    }
  }
  check(p.status===4n,'Unknown proposal phase');
  const state=await source.settlements(r.drawId);
  check(state.proposalId===job.proposalId,'Settlement proposal mismatch');
  if(state.phase===1n)return wait('seed');
  check(state.phase===2n||state.phase===3n,'Unknown settlement phase');
  check(await source.datasetChunkCount(job.proposalId)===BigInt(publication.publications.length),'Dataset chunk count changed');
  if(state.nextChunk<BigInt(publication.publications.length)){
    const part=publication.publications[Number(state.nextChunk)],chunk=ps.slice(part.offset,part.offset+part.count);
    check(state.phase===2n&&state.processed===BigInt(part.offset),'Short progress mismatch');
    check(await source.datasetChunkHash(job.proposalId,state.nextChunk)===part.hash,'Short chunk changed');
    return send(executor,'processShort',[r.drawId,state.nextChunk,chunk]);
  }
  check(state.nextChunk===BigInt(publication.publications.length)&&state.processed===p.count,'Incomplete settlement');
  const prizes=Array.from(await source.datasetBasket(job.proposalId));
  const expected=verified.expected({context:p.context,seed:state.seed,prizes},()=>settlement.compute(p.context,state.seed,ps,a.rules,prizes));
  check((await source.shortResult(r.drawId)).resultHash===expected.resultHash,'Independent result mismatch');
  if(state.phase===3n)return {status:'terminal',drawId:r.drawId,resultHash:expected.resultHash};
  return send(executor,'finishShort',[r.drawId]);
}

async function runShort(options,{maxSteps=128,onStep=()=>{},signal}={}){
  check(Number.isInteger(maxSteps)&&maxSteps>0&&maxSteps<=10000,'Invalid step limit');
  for(let i=0;i<maxSteps;i++){
    if(signal?.aborted)return {status:'stopped'};
    let result;
    try{result=await stepShort({...options,signal:signal??options.signal});}
    catch(error){
      if(error.code!=='LOCAL_EXECUTION_STOPPED')throw error;
      result={status:'stopped',transactionHash:error.transactionHash};
    }
    await onStep(result);
    if(result.status!=='progress')return result;
  }
  return {status:'yielded',reason:'stepLimit'};
}
module.exports={makeJob,validateJob,validateCachedJob,stepShort,runShort};
