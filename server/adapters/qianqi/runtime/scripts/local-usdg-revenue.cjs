// One local collection pass. Existing funds are drained before touching the source.
const {ethers}=require('ethers');
const {validateFundingJob,runFunding}=require('./local-usdg-funding.cjs');
const {sendLocalTransaction,receiptOptions}=require('./local-receipt.cjs');
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
function validateRevenueJob(job){
  check(job.schema==='local-usdg-revenue-v1','Invalid revenue job');validateFundingJob(job.funding);
  check(ethers.isAddress(job.source?.vault)&&job.source.vault!==ethers.ZeroAddress,'Invalid source');
  check(BigInt(job.source.positionId)>=0n&&BigInt(job.source.epoch)>0n,'Invalid source binding');
  check(Number.isInteger(job.pollSeconds)&&job.pollSeconds>=60&&job.pollSeconds<=86400,'Invalid collection interval');
  return job;
}
async function runRevenue(options,{onStep=()=>{},signal,maxSteps=32}={}){
  const {provider,router,vault,executor,job,receiptTimeoutMs=30000}=options;
  signal=signal??options.signal;validateRevenueJob(job);receiptOptions(receiptTimeoutMs);
  const fundingOptions={provider,router,vault,executor,job:job.funding,signal,receiptTimeoutMs};
  const skipRecipients=new Set(),failures=[];
  // Includes the local chain, assets, recipient policy and campaign checks.
  let funding=await runFunding(fundingOptions,{maxSteps,onStep,signal,skipRecipients,failures});
  if(!['idle','degraded'].includes(funding.status))return {status:funding.status,funding};
  const sourceResults={};
  async function record(action,result){sourceResults[action]=result;await onStep({action,...result});}
  const failure=e=>({status:'error',message:e.shortMessage||e.message,...(e.transactionHash?{transactionHash:e.transactionHash}:{})});
  async function guard(){
    if(signal?.aborted)return {status:'stopped'};
    if(!executor)return {status:'waiting',reason:'executor'};
    if(await router.campaignId()!==BigInt(job.funding.campaignId))return {status:'waiting',reason:'campaignChanged'};
    const price=(await provider.getFeeData()).gasPrice;
    if(price==null||price>BigInt(job.funding.maxGasPrice))return {status:'waiting',reason:'gasPrice'};
    const address=await executor.getAddress();
    if(await provider.getTransactionCount(address,'pending')>await provider.getTransactionCount(address,'latest'))return {status:'waiting',reason:'pendingTransaction'};
    return {price};
  }
  async function send(action,args){
    const ready=await guard();if(ready.status)return ready;
    const receipt=await sendLocalTransaction(router.connect(executor)[action],args,
      {type:2,maxFeePerGas:ready.price,maxPriorityFeePerGas:0},{signal,receiptTimeoutMs});
    return {status:'progress',transactionHash:receipt.hash};
  }
  try{
    check(same(await router.pairVault(),job.source.vault)&&await router.positionId()===BigInt(job.source.positionId)
      &&await router.sourceEpoch()===BigInt(job.source.epoch),'Source binding mismatch');
    const source=new ethers.Contract(job.source.vault,[
      'function epoch() view returns(uint64)',
      'function claimable(uint64,address,address) view returns(uint256)'],provider);
    if(await source.epoch()!==BigInt(job.source.epoch)){
      await record('collect',{status:'error',message:'Source epoch changed; collection disabled'});
    }else{
      try{
        const result=await send('collect',[]);await record('collect',result);
        if(result.status!=='progress')return {status:result.status,source:sourceResults,funding};
      }catch(e){
        // Only a definite EVM rejection permits another transaction in this pass.
        if(!e.definiteRejection)throw e;
        await record('collect',failure(e));
      }
    }
    // Old bound-epoch claims remain useful even if a new collection failed or epoch drifted.
    if(await source.claimable(job.source.epoch,router.target,job.funding.quote)>0n){
      try{
        const result=await send('harvest',[job.funding.quote,job.source.epoch]);await record('harvest',result);
        if(result.status!=='progress')return {status:result.status,source:sourceResults,funding};
      }catch(e){if(!e.definiteRejection)throw e;await record('harvest',failure(e));}
    }else await record('harvest',{status:'idle'});
  }catch(e){
    if(e.code==='LOCAL_EXECUTION_STOPPED')return {status:'stopped',transactionHash:e.transactionHash,source:sourceResults,funding};
    // Unknown RPC/broadcast/receipt outcomes stop further writes. Prior funding already ran.
    await record('source',failure(e));return {status:'error',source:sourceResults,funding};
  }
  funding=await runFunding(fundingOptions,{maxSteps,onStep,signal,skipRecipients,failures});
  return {status:funding.status!=='idle'?funding.status:Object.values(sourceResults).some(r=>r.status==='error')?'degraded':'idle',source:sourceResults,funding};
}
module.exports={validateRevenueJob,runRevenue};
