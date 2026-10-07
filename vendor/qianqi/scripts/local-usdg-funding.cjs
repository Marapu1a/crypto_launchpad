// Local orchestration of existing custody APIs. No swap, new shares or prize withdrawal.
const {ethers}=require('ethers');
const {sendLocalTransaction,receiptOptions}=require('./local-receipt.cjs');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
function validateFundingJob(j){
  check(j.schema==='local-usdg-funding-v1'&&String(j.chainId)==='31337','Local funding job only');
  for(const k of ['router','vault','token','quote'])check(ethers.isAddress(j[k])&&j[k]!==ethers.ZeroAddress,'Invalid '+k);
  check(j.distribution==='GENERAL','Explicit GENERAL prize distribution required');
  check(BigInt(j.campaignId)>0n&&BigInt(j.maxGasPrice)>0n,'Invalid funding limits');
  check(Array.isArray(j.recipients)&&j.recipients.length===3&&j.recipients.every(ethers.isAddress),'Invalid recipients');
  check(Array.isArray(j.bps)&&j.bps.length===3&&j.bps.every(n=>Number.isInteger(n)&&n>=0&&n<=10000)
    &&j.bps.reduce((a,b)=>a+b,0)===10000,'Invalid shares');
  check(same(j.recipients[0],j.vault)&&j.bps[0]>0,'Promo must be first recipient');
  for(let i=1;i<3;i++)check(!same(j.recipients[i],j.vault),'Project recipient cannot be prize vault');
  return j;
}
async function stepFunding({provider,router,vault,executor,job,signal,receiptTimeoutMs=30000,skipRecipients=new Set()}){
  validateFundingJob(job);receiptOptions(receiptTimeoutMs);
  if(signal?.aborted)return {status:'stopped'};
  check((await provider.getNetwork()).chainId===31337n,'Local chain 31337 only');
  check(same(router.target,job.router)&&same(vault.target,job.vault),'Wrong funding contracts');
  const head=await provider.getBlock('latest'),at={blockTag:head.number};
  for(const c of [router,vault]){
    check(same(await c.quoteToken(at),job.quote)&&same(await c.projectToken(at),job.token),'Funding asset mismatch');
  }
  check(await router.campaignId(at)===BigInt(job.campaignId),'Funding campaign changed; explicit new job required');
  const p=await router.policy(job.campaignId,at);
  check(p.recipients.every((r,i)=>same(r,job.recipients[i]))&&p.bps.every((n,i)=>n===BigInt(job.bps[i])),'Funding policy mismatch');
  const quote=new ethers.Contract(job.quote,['function balanceOf(address) view returns(uint256)'],provider);
  const balance=await quote.balanceOf(router.target,at),accounted=await router.accounted(job.quote,at);
  check(balance>=accounted,'Router USDG deficit');
  let target,method,args,action;
  // Finish recognition of an earlier payment even if a source is unavailable.
  if(await vault.unrecognizedUSDG(at)>0n){target=vault;method='syncUSDG';args=[];action='allocatePrizes';}
  else if(balance>accounted){target=router;method='sync';args=[job.quote];action='recognizeRevenue';}
  else for(const recipient of [...new Set(job.recipients.map(r=>r.toLowerCase()))]){
    if(!skipRecipients.has(job.quote.toLowerCase()+':'+recipient)&&await router.credit(job.quote,recipient,at)>0n){target=router;method='pay';args=[job.quote,recipient];action='payRecipient';break;}
  }
  if(!target)return {status:'idle',campaignId:job.campaignId};
  if(!executor)return {status:'waiting',reason:'executor'};
  const price=(await provider.getFeeData()).gasPrice;
  check(price!=null,'Missing gas price');
  if(price>BigInt(job.maxGasPrice))return {status:'waiting',reason:'gasPrice'};
  const address=await executor.getAddress();
  if(await provider.getTransactionCount(address,'pending')>await provider.getTransactionCount(address,'latest'))return {status:'waiting',reason:'pendingTransaction'};
  if((await provider.getBlock(head.number))?.hash!==head.hash)return {status:'waiting',reason:'chainChanged'};
  if(await router.campaignId()!==BigInt(job.campaignId))return {status:'waiting',reason:'campaignChanged'};
  if(signal?.aborted)return {status:'stopped'};
  try{
    const receipt=await sendLocalTransaction(target.connect(executor)[method],args,
      {type:2,maxFeePerGas:price,maxPriorityFeePerGas:0},{signal,receiptTimeoutMs});
    return {status:'progress',action,transactionHash:receipt.hash,...(method==='pay'?{recipient:args[1]}:{})};
  }catch(error){
    if(method==='pay'&&error.definiteRejection){
      error.recipientFailure={asset:job.quote,recipient:args[1],stage:error.stage,
        message:error.message,...(error.transactionHash?{transactionHash:error.transactionHash}:{})};
    }
    throw error;
  }
}
async function runFunding(options,{maxSteps=32,onStep=()=>{},signal,skipRecipients=new Set(),failures=[]}={}){
  check(Number.isInteger(maxSteps)&&maxSteps>0&&maxSteps<=10000,'Invalid step limit');
  for(let i=0;i<maxSteps;i++){
    let result;
    try{result=await stepFunding({...options,signal:signal??options.signal,skipRecipients});}
    catch(e){
      if(e.recipientFailure){
        const failure=e.recipientFailure;failures.push(failure);
        skipRecipients.add(failure.asset.toLowerCase()+':'+failure.recipient.toLowerCase());
        await onStep({status:'recipientFailed',action:'payRecipient',...failure});continue;
      }
      if(e.code!=='LOCAL_EXECUTION_STOPPED')throw e;
      result={status:'stopped',transactionHash:e.transactionHash};
    }
    await onStep(result);if(result.status!=='progress')return {...result,status:result.status==='idle'&&failures.length?'degraded':result.status,failures:[...failures]};
  }
  return {status:'yielded',reason:'stepLimit',failures:[...failures]};
}
module.exports={validateFundingJob,stepFunding,runFunding};
