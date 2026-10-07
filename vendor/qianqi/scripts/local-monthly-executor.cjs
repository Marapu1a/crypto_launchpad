const network=require('./runtime-network.cjs');
const {sendLocalTransaction,receiptOptions}=require('./local-receipt.cjs');
// Local single-job Monthly counterpart. No calendar/seed selection or reset.
const {ethers}=require('ethers');
const dataset=require('./monthly-dataset.cjs'),shortDataset=require('./short-dataset.cjs'),outcome=require('./monthly-outcome.cjs');
const {hash}=require('./direct-buy.cjs'),{verifyDualBindings}=require('./dual-bindings.cjs');
const cache=require('./verified-draw-cache.cjs');
const validateCachedJob=(provider,job)=>cache.validate(provider,'MONTHLY',job,validateMonthlyJob);
const check=(ok,message)=>{if(!ok)throw Error(message);},same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
function makeMonthlyJob(artifact,chunkSize=64){
  const job={schema:'local-monthly-job-v1',chunkSize,artifact};job.commitment=hash(job);validateMonthlyJob(job);return job;
}
function validateMonthlyJob(job){
  const {commitment,...payload}=job;
  check(job.schema==='local-monthly-job-v1'&&hash(payload)===commitment,'Monthly job checksum mismatch');
  check(Number.isInteger(job.chunkSize)&&job.chunkSize>0&&job.chunkSize<=64,'Invalid chunk size');
  const a=job.artifact,r=a.request,s=a.snapshot;
  check(a.schema==='monthly-dataset-artifact-v1'&&s?.kind==='MONTHLY'&&s.domain.schema==='attempt-lifecycle-v4','Expected v4 Monthly artifact');
  require('./draw-id.cjs').validateDrawId(r.drawId,'MONTHLY');
  check(hash(s)===r.snapshotHash&&s.drawId===r.drawId&&String(s.rulesEpoch)===String(r.rulesEpoch)
    &&String(s.cutoff.blockNumber)===String(r.cutoff)&&s.cutoff.blockHash===r.cutoffHash,'Monthly snapshot metadata mismatch');
  check(s.participants.length>0&&s.participants.length===Number(r.count)&&dataset.rootFor(s.participants)===r.root,'Monthly participants mismatch');
  check(s.participants.every(p=>BigInt(p.count)===BigInt(p.lastAttempt)-BigInt(p.firstAttempt)+1n)
    &&s.participants.reduce((n,p)=>n+BigInt(p.count),0n)===BigInt(r.attempts),'Monthly attempts mismatch');
  check(outcome.rulesHash(a.rules)===s.rulesHash,'Monthly rules mismatch');return a;
}
const expectedResult=outcome.expectedResult;
async function stepMonthly(options){return cache.guarded(options.provider,'MONTHLY',()=>stepVerified(options));}
async function stepVerified({provider,source,job,publisher,executor,gasPrice,signal,receiptTimeoutMs=30000}){
  receiptOptions(receiptTimeoutMs);
  const verified=cache.get(provider,'MONTHLY',job,validateMonthlyJob);job=verified.job;
  const a=job.artifact,r=a.request,d=a.snapshot.domain;
  network.checkChain((await provider.getNetwork()).chainId);network.checkChain(d.chainId);
  check(same(source.target,d.monthlySource),'Wrong Monthly controller');
  await verifyDualBindings(provider,d);await shortDataset.verifyEpochGenesis(provider,d.source,d);
  const cutoff=await provider.getBlock(Number(r.cutoff));
  check(cutoff&&same(cutoff.hash,r.cutoffHash),'Monthly cutoff no longer canonical');
  check((await source.monthlyEpochPolicy(r.rulesEpoch)).hash===a.snapshot.rulesHash,'Monthly on-chain policy mismatch');
  const m=await source.month(r.drawId),wait=reason=>({status:'waiting',reason,drawId:r.drawId});
  const price=gasPrice==null?(await provider.getFeeData()).gasPrice:BigInt(gasPrice);
  check(price!=null&&price>=0n,'Missing gas price');
  async function send(signer,method,args){
    if(!signer)return wait(['beginMonth','publishMonth'].includes(method)?'publisher':'executor');
    if(price>await source.maxGasPrice())return wait('gasPrice');
    const address=await signer.getAddress();
    if(await provider.getTransactionCount(address,'pending')>await provider.getTransactionCount(address,'latest'))return wait('pendingTransaction');
    if(signal?.aborted)return {status:'stopped'};
    const receipt=await sendLocalTransaction(source.connect(signer)[method],args,
      {type:2,maxFeePerGas:price,maxPriorityFeePerGas:0},{signal,receiptTimeoutMs});check(receipt&&receipt.status===1,'Transaction not confirmed');
    return {status:'progress',action:method,drawId:r.drawId,transactionHash:receipt.hash};
  }
  check(m.phase!==6n,'Monthly proposal superseded; explicit new job required');
  if(m.phase!==0n)for(const key of Object.keys(r))check(same(m.input[key],r[key]),'Monthly existing input differs: '+key);
  const ps=a.snapshot.participants;
  if(m.phase===0n||m.phase===1n){
    if(!publisher||!same(await publisher.getAddress(),await source.publisher()))return wait('publisher');
    if(m.phase===0n){
      if(await source.activeMonth()!==ethers.ZeroHash||await source.pendingMonth()!==ethers.ZeroHash)return wait('otherDraw');
      const head=await provider.getBlock('latest');
      check(head.number+1-Number(r.cutoff)<=256||await source.cutoffHashes(r.cutoff)===r.cutoffHash,'Monthly cutoff expired before begin; rebuild unfrozen job');
      if(BigInt(head.timestamp)<await source.lastMonthAt()+await source.monthlyInterval())return wait('schedule');
      if(BigInt(head.number+1)<BigInt(r.cutoff)+await source.cutoffDelayBlocks())return wait('cutoffDelay');
      return send(publisher,'beginMonth',[r]);
    }
    const count=Number(m.count);
    const prefix=verified.prefix(count);
    check(count<ps.length&&m.root===prefix.root,'Monthly published prefix differs');
    check(m.attempts===prefix.attempts,'Monthly attempts differ');
    return send(publisher,'publishMonth',[r.drawId,ps.slice(count,count+job.chunkSize)]);
  }
  const binding=m=>({input:Array.from(m.input),root:m.root,count:m.count,attempts:m.attempts,totalWeight:m.totalWeight,budget:m.budget,context:m.context,ready:m.phase===2n});
  const publication=await verified.publication(binding(m),async blockTag=>binding(await source.month(r.drawId,{blockTag})),
    blockTag=>dataset.verifyPublication(provider,source,a,{blockTag}));
  if(m.phase===2n){
    if(!executor)return wait('executor');
    if(!await source.executionReady({gasPrice:price}))return wait('executionReadiness');
    const rng=await require('./drand-preflight.cjs').drandPreflight(provider,source);
    if(rng&&rng.status!=='observedHealthy')return wait('rng:'+rng.reasons.join(','));
    try{await source.connect(executor).sealMonth.staticCall(r.drawId,{gasPrice:price});}
    catch(error){
      if(error.data===ethers.id('MonthlyBudgetNotReady()').slice(0,10))return wait('currentFunding');
      if(error.data===ethers.id('NextStartNotReady()').slice(0,10))return wait('nextStartFunding');
      if(error.data===ethers.id('InvalidDraw()').slice(0,10)){
        const vault=new ethers.Contract(d.vault,['function freeCurrent() view returns(uint256)'],provider);
        if(await vault.freeCurrent()===0n)return wait('currentFunding');
      }
      throw error;
    }
    return send(executor,'sealMonth',[r.drawId]);
  }
  if(m.phase===3n)return wait('seed');
  check(m.phase===4n||m.phase===5n,'Unknown Monthly phase');
  check(await source.monthChunkCount(r.drawId)===BigInt(publication.publications.length),'Monthly chunk count changed');
  if(m.nextChunk<BigInt(publication.publications.length)){
    const entry=publication.publications[Number(m.nextChunk)],chunk=ps.slice(entry.offset,entry.offset+entry.count);
    check(m.phase===4n&&m.processed===BigInt(entry.offset),'Monthly progress mismatch');
    check(await source.monthChunkHash(r.drawId,m.nextChunk)===entry.hash,'Monthly chunk changed');
    return send(executor,'processMonth',[r.drawId,m.nextChunk,chunk]);
  }
  check(m.nextChunk===BigInt(publication.publications.length),'Monthly progress mismatch');
  const expected=verified.expected({context:m.context,seed:m.seed,root:m.root,budget:m.budget},()=>expectedResult(m,a));
  if(Number(a.rules.version)===2)check(m.totalWeight===BigInt(expected.totalWeight)&&m.processedWeight===m.totalWeight,'Monthly weight mismatch');
  check(same(m.winner,expected.winner)&&m.admitted===BigInt(expected.admittedCount)
    &&m.processed===BigInt(r.count),'Monthly independent result mismatch');
  if(m.phase===5n){check(m.resultHash===expected.resultHash,'Monthly result mismatch');return {status:'terminal',drawId:r.drawId,...expected};}
  return send(executor,'finishMonth',[r.drawId]);
}
async function runMonthly(options,{maxSteps=128,onStep=()=>{},signal}={}){
  check(Number.isInteger(maxSteps)&&maxSteps>0&&maxSteps<=10000,'Invalid step limit');
  for(let i=0;i<maxSteps;i++){
    if(signal?.aborted)return {status:'stopped'};
    let result;
    try{result=await stepMonthly({...options,signal:signal??options.signal});}
    catch(error){
      if(error.code!=='LOCAL_EXECUTION_STOPPED')throw error;
      result={status:'stopped',transactionHash:error.transactionHash};
    }
    await onStep(result);if(result.status!=='progress')return result;
  }
  return {status:'yielded',reason:'stepLimit'};
}
module.exports={makeMonthlyJob,validateMonthlyJob,validateCachedJob,stepMonthly,runMonthly,expectedResult};
