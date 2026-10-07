const {transientRpc,retryableRead}=require('./local-rpc-watch.cjs');
// Bounded local orchestration; job configuration is trusted, not a production deployment attestation.
const {ethers}=require('ethers');
const {sendLocalTransaction,receiptOptions}=require('./local-receipt.cjs');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const lower=a=>String(a).toLowerCase(),same=(a,b)=>lower(a)===lower(b);
const MAX_LEGACY=8,DEFAULT_MAX_STEPS=128;
// Maximum: two distributions (vault sync, 2 router syncs, 2 pays/entry,
// two forwards/converter), source collect + 2 harvests, swap + forward/converter.
// Replacing a legacy converter with usdgVault adds one sync but removes two forwards.
const WORST_CASE_ATTEMPTS=2*((MAX_LEGACY+1)+2+2*(MAX_LEGACY+3)+2*(MAX_LEGACY+1))+3+2*(MAX_LEGACY+1);
check(DEFAULT_MAX_STEPS>=WORST_CASE_ATTEMPTS,'Default pass limit below schema bound');
const address=a=>ethers.isAddress(a)&&a!==ethers.ZeroAddress;
const vaultABI=['function projectToken() view returns(address)','function quoteToken() view returns(address)',
  'function unrecognizedUSDG() view returns(uint256)','function syncUSDG()'];
const converterABI=['function projectToken() view returns(address)','function quoteToken() view returns(address)',
  'function vault() view returns(address)','function adapter() view returns(address)',
  ...['floorNumerator','floorDenominator','maxInput','maxHorizon'].map(k=>`function ${k}() view returns(uint256)`),
  'function convert(uint256,uint256)','function forwardQuote()'];
const marketABI=converterABI.filter(x=>!x.includes('floorNumerator')&&!x.includes('floorDenominator')&&!x.includes('convert(')).concat([
  'function executor() view returns(address)','function adapterVersion() view returns(uint256)',
  'function capacity() view returns(uint256)','function refillSeconds() view returns(uint256)',
  'function availableToSell() view returns(uint256)','function convert(uint256,uint256,uint256,uint256)']);
function validatePrizeFlowJob(j){
  check(j.schema==='local-prize-flow-v1'&&String(j.chainId)==='31337','Local prize flow only');
  for(const k of ['router','token','quote'])check(address(j[k]),'Invalid '+k);
  check(!same(j.token,j.quote)&&BigInt(j.campaignId)>0n&&BigInt(j.maxGasPrice)>0n,'Invalid assets or limits');
  check(j.distribution==='GENERAL','Explicit GENERAL required');
  check(Array.isArray(j.recipients)&&j.recipients.length===3&&j.recipients.every(ethers.isAddress),'Invalid recipients');
  check(Array.isArray(j.bps)&&j.bps.length===3&&j.bps.every(n=>Number.isInteger(n)&&n>=0&&n<=10000)&&j.bps.reduce((a,b)=>a+b,0)===10000,'Invalid shares');
  check(address(j.source?.vault)&&BigInt(j.source.positionId)>=0n&&BigInt(j.source.epoch)>0n,'Invalid source');
  check(Number.isInteger(j.pollSeconds)&&j.pollSeconds>=60&&j.pollSeconds<=86400,'Invalid poll interval');
  check(Array.isArray(j.legacy)&&j.legacy.length<=MAX_LEGACY,'At most eight explicit legacy recipients');
  check(j.active?.kind==='converter'&&same(j.active.address,j.recipients[0])&&j.bps[0]>0,'Active prize recipient must be converter');
  const seen=new Set();
  for(const e of [j.active,...j.legacy]){
    check(address(e.address)&&!seen.has(lower(e.address)),'Invalid or duplicate recipient');seen.add(lower(e.address));
    check(['converter','usdgVault','project'].includes(e.kind),'Unknown recipient kind');
    if(e!==j.active){
      check(BigInt(e.campaignId)>0n&&BigInt(e.campaignId)<BigInt(j.campaignId)&&Number.isInteger(e.slot)&&e.slot>=0&&e.slot<=2,'Invalid legacy policy witness');
      check(e.kind==='project'?e.slot>0:e.slot===0,'Legacy kind must match policy slot');
      check(!j.recipients.some(a=>same(a,e.address)),'Legacy duplicates active recipient');
    }
    if(e.kind==='converter'){
      check(e.execution===undefined||e.execution==='market-v1','Unknown execution mode');
      check(address(e.vault)&&address(e.adapter),'Invalid converter bindings');
      for(const k of [...(e.execution==='market-v1'?['capacity','refillSeconds','version','maxQuoteAge','minUSDG']:['floorNumerator','floorDenominator']),'maxInput','maxHorizon','swapLimit','deadlineSeconds'])check(BigInt(e[k])>0n,'Invalid '+k);
      if(e.execution==='market-v1'){
        if(e.marketQuote)require('./v4-market-quote.cjs').validateMarketQuote(e.marketQuote);
        check(address(e.executor)&&BigInt(e.capacity)>=BigInt(e.maxInput),'Invalid market authority/limits');
        check(Number.isInteger(e.slippageBps)&&e.slippageBps>=0&&e.slippageBps<10000,'Invalid slippage');
      }
      check(BigInt(e.swapLimit)<=BigInt(e.maxInput)&&BigInt(e.deadlineSeconds)<=BigInt(e.maxHorizon),'Swap limits exceed contract');
    }
  }
  const vaults=[j.active.vault,...j.legacy.filter(e=>e.kind==='converter').map(e=>e.vault),...j.legacy.filter(e=>e.kind==='usdgVault').map(e=>e.address)];
  for(let i=1;i<3;i++){
    check(!same(j.recipients[i],j.active.address)&&!vaults.some(v=>same(v,j.recipients[i])),'Project recipient conflicts with prize custody');
    check(j.bps[i]===0||address(j.recipients[i]),'Missing project recipient');
  }
  for(const e of j.legacy.filter(e=>e.kind==='project'))check(!vaults.some(v=>same(v,e.address)),'Project recipient is a prize vault');
  return j;
}
async function runPrizeFlow({provider,router,executor,job,signal,receiptTimeoutMs=30000,getSwapQuote},{maxSteps=DEFAULT_MAX_STEPS,onStep=()=>{},signal:overrideSignal}={}){
  signal=overrideSignal??signal;
  const failures=[],unsafe=new Map(),skipped=new Set();let steps=0,current,lastConfirmed;
  const summary=()=>({failures:[...failures],unsafeDebt:[...unsafe.values()],steps,lastConfirmed});
  const halt=(status,reason)=>{throw Object.assign(new Error(reason),{flowStatus:status,reason});};
  try{
    validatePrizeFlowJob(job);receiptOptions(receiptTimeoutMs);
    if(!getSwapQuote&&[job.active,...job.legacy].some(e=>e.execution==='market-v1'&&e.marketQuote))
      getSwapQuote=require('./v4-market-quote.cjs').createV4MarketQuote({provider,job,
        onQuote:report=>onStep({status:'observation',action:'marketQuote',...report})});
    check(Number.isInteger(maxSteps)&&maxSteps>0&&maxSteps<=256,'Invalid step limit');
    if(signal?.aborted)halt('stopped','aborted');
    check((await provider.getNetwork()).chainId===31337n&&same(router.target,job.router),'Wrong chain/router');
    const anchor=await provider.getBlock('latest'),at={blockTag:anchor.number};
    check(await router.campaignId(at)===BigInt(job.campaignId),'Campaign mismatch');
    check(same(await router.projectToken(at),job.token)&&same(await router.quoteToken(at),job.quote),'Router assets mismatch');
    const policy=await router.policy(job.campaignId,at);
    check(policy.recipients.every((a,i)=>same(a,job.recipients[i]))&&policy.bps.every((n,i)=>n===BigInt(job.bps[i])),'Policy mismatch');
    check(same(await router.pairVault(at),job.source.vault)&&await router.positionId(at)===BigInt(job.source.positionId)&&await router.sourceEpoch(at)===BigInt(job.source.epoch),'Source binding mismatch');
    const entries=[job.active];
    for(let i=1;i<3;i++)if(address(job.recipients[i])&&!entries.some(e=>same(e.address,job.recipients[i])))entries.push({kind:'project',address:job.recipients[i]});
    entries.push(...job.legacy);
    const converters=[],vaults=new Map();
    for(const e of entries){
      if(job.legacy.includes(e)){
        const old=await router.policy(e.campaignId,at);
        check(same(old.recipients[e.slot],e.address)&&(e.slot===0||old.bps[e.slot]>0n),'Legacy recipient not in historical policy');
      }
      if(e.kind==='project')continue;
      const vAddress=e.kind==='converter'?e.vault:e.address;
      const vault=new ethers.Contract(vAddress,vaultABI,provider);
      check(same(await vault.projectToken(at),job.token)&&same(await vault.quoteToken(at),job.quote),'Vault assets mismatch');
      vaults.set(lower(vAddress),vault);
      if(e.kind==='converter'){
        const market=e.execution==='market-v1';
        const c=new ethers.Contract(e.address,market?marketABI:converterABI,provider);
        check(same(await c.projectToken(at),job.token)&&same(await c.quoteToken(at),job.quote)&&same(await c.vault(at),e.vault)&&same(await c.adapter(at),e.adapter),'Converter binding mismatch');
        for(const k of [...(market?['capacity','refillSeconds']:['floorNumerator','floorDenominator']),'maxInput','maxHorizon'])check(await c[k](at)===BigInt(e[k]),'Converter '+k+' mismatch');
        if(market){
          check(same(await c.executor(at),e.executor)&&await c.adapterVersion(at)===BigInt(e.version),'Market executor/version mismatch');
          if(executor)check(same(await executor.getAddress(),e.executor),'Wrong market executor');
        }
        const adapter=new ethers.Contract(e.adapter,['function tokenIn() view returns(address)','function tokenOut() view returns(address)'],provider);
        check(same(await adapter.tokenIn(at),job.token)&&same(await adapter.tokenOut(at),job.quote),'Adapter assets mismatch');
        converters.push({...e,contract:c});
      }
    }
    const token=new ethers.Contract(job.token,['function balanceOf(address) view returns(uint256)'],provider);
    const quote=new ethers.Contract(job.quote,['function balanceOf(address) view returns(uint256)'],provider);
    const source=new ethers.Contract(job.source.vault,['function epoch() view returns(uint64)','function claimable(uint64,address,address) view returns(uint256)'],provider);
    const key=(action,target,asset='')=>[action,lower(target),lower(asset)].join(':');
    async function send(action,target,method,args=[],asset='',isolated=true,recipient=''){
      const id=key(action,target.target,asset)+(recipient?':'+lower(recipient):'');if(skipped.has(id))return false;
      current={action,target:target.target,...(asset?{asset}:{}),...(recipient?{recipient}:{})};
      if(steps>=maxSteps)halt('yielded','stepLimit');
      if(signal?.aborted)halt('stopped','aborted');
      if(!executor)halt('waiting','executor');
      if((await provider.getBlock(anchor.number))?.hash!==anchor.hash)halt('waiting','chainChanged');
      if(await router.campaignId()!==BigInt(job.campaignId))halt('waiting','campaignChanged');
      const price=(await provider.getFeeData()).gasPrice;
      if(price==null||price>BigInt(job.maxGasPrice))halt('waiting','gasPrice');
      const sender=await executor.getAddress();
      if(await provider.getTransactionCount(sender,'pending')>await provider.getTransactionCount(sender,'latest'))halt('waiting','pendingTransaction');
      steps++;
      let receipt;
      try{receipt=await sendLocalTransaction(target.connect(executor)[method],args,
        {from:sender,type:2,maxFeePerGas:price,maxPriorityFeePerGas:0},{signal,receiptTimeoutMs});}
      catch(e){
        if(!isolated||!e.definiteRejection)throw e;
        skipped.add(id);const failure={...current,message:e.message,code:e.code,stage:e.stage,transactionHash:e.transactionHash};
        failures.push(failure);current=undefined;await onStep({status:'failed',...failure});return false;
      }
      lastConfirmed={...current,transactionHash:receipt.hash};current=undefined;
      await onStep({status:'progress',...lastConfirmed});return true;
    }
    async function forward(c){
      if(await quote.balanceOf(c.address)>0n)await send('forwardQuote',c.contract,'forwardQuote');
    }
    async function distribute(){
      for(const v of vaults.values())if(await v.unrecognizedUSDG()>0n)await send('allocatePrizes',v,'syncUSDG');
      for(const asset of [job.quote,job.token]){
        const currency=same(asset,job.quote)?quote:token;
        const balance=await currency.balanceOf(router.target),accounted=await router.accounted(asset);
        check(balance>=accounted,'Router asset deficit');
        if(balance>accounted)await send('recognizeRevenue',router,'sync',[asset],asset,false);
        for(const e of entries){
          const due=await router.credit(asset,e.address);
          if(e.kind==='usdgVault'&&same(asset,job.token)){
            if(due>0n)unsafe.set(lower(e.address),{recipient:e.address,asset,amount:due.toString(),reason:'TOKEN credit to USDG-only legacy vault; public pay remains possible'});
            else unsafe.delete(lower(e.address));
            continue;
          }
          if(due>0n)await send('payRecipient',router,'pay',[asset,e.address],asset,true,e.address);
          if(same(asset,job.quote)&&e.kind==='converter')await forward(converters.find(c=>same(c.address,e.address)));
          if(same(asset,job.quote)&&e.kind==='usdgVault'){
            const v=vaults.get(lower(e.address));if(await v.unrecognizedUSDG()>0n)await send('allocatePrizes',v,'syncUSDG');
          }
        }
      }
      // Also forwards direct donations when no router debt exists.
      for(const c of converters)await forward(c);
    }
    // Catch only source eth_call transport failures, never sends or observer callbacks.
    // A failed read skips the rest of the source lane for this pass, not local inventory.
    async function readSource(method,args=[],asset){
      let failure;
      try{return await source[method](...args);}
      catch(e){
        if(!retryableRead(e))throw e;
        failure={action:'sourceRead',method,target:source.target,reason:'sourceReadUnavailable',
          ...(asset?{asset}:{}),code:e.code,message:e.message};
      }
      failures.push(failure);
      await onStep({status:'degraded',...failure});
      return undefined;
    }
    await distribute();
    const sourceEpoch=await readSource('epoch');
    if(sourceEpoch!==undefined){
      if(sourceEpoch===BigInt(job.source.epoch))await send('collect',router,'collect');
      else failures.push({action:'collect',reason:'sourceEpochChanged'});
      for(const asset of [job.quote,job.token]){
        const due=await readSource('claimable',[job.source.epoch,router.target,asset],asset);
        if(due===undefined)break;
        if(due>0n)await send('harvest',router,'harvest',[asset,job.source.epoch],asset);
      }
    }
    await distribute();
    // At most one portion per converter/pass. This is NOT an on-chain rate limit.
    for(const c of converters){
      if(skipped.has(key('forwardQuote',c.address)))continue;
      const balance=await token.balanceOf(c.address),portion=BigInt(c.swapLimit);
      if(balance>0n){
        const head=await provider.getBlock('latest'),deadline=BigInt(head.timestamp)+BigInt(c.deadlineSeconds);
        let amount=balance<portion?balance:portion,args=[amount,deadline];
        if(c.execution==='market-v1'){
          const allowed=await c.contract.availableToSell({blockTag:head.number});
          amount=amount<allowed?amount:allowed;
          const waiting=async reason=>onStep({status:'waiting',action:'convert',target:c.address,reason});
          if(amount===0n){await waiting('saleLimit');continue;}
          if(!getSwapQuote){await waiting('quoteUnavailable');continue;}
          // Quote selection/impact/cost policy is trusted executor logic, not an oracle.
          let q;
          try{q=await getSwapQuote({converter:c.address,adapter:c.adapter,token:job.token,quote:job.quote,amountIn:amount,version:BigInt(c.version),block:head});}
          catch(e){await waiting('quoteUnavailable');continue;}
          if(!q){await waiting('quoteUnavailable');continue;}
          check(q.blockHash===head.hash&&typeof q.amountIn==='bigint'&&q.amountIn>0n&&q.amountIn<=amount&&q.version===BigInt(c.version)&&same(q.adapter,c.adapter)&&typeof q.amountOut==='bigint'&&q.amountOut>0n,'Invalid market quote binding');
          amount=q.amountIn;
          const latest=await provider.getBlock('latest');
          if(latest.timestamp<head.timestamp||BigInt(latest.timestamp-head.timestamp)>BigInt(c.maxQuoteAge)||latest.timestamp>Number(deadline)){
            await waiting('staleQuote');continue;
          }
          if((await provider.getBlock(head.number))?.hash!==head.hash){await waiting('quoteChainChanged');continue;}
          const minimum=(q.amountOut*BigInt(10000-c.slippageBps)+9999n)/10000n;
          if(minimum<BigInt(c.minUSDG)){await waiting('uneconomicPortion');continue;}
          const quoteDeadline=BigInt(head.timestamp)+BigInt(c.maxQuoteAge);
          args=[amount,minimum,deadline<quoteDeadline?deadline:quoteDeadline,BigInt(c.version)];
        }
        if(await send('convert',c.contract,'convert',args))await forward(c);
      }
    }
    const remainingInventory=[];
    for(const c of converters){const amount=await token.balanceOf(c.address);if(amount>0n)remainingInventory.push({converter:c.address,amount:amount.toString()});}
    return {...summary(),status:failures.length||unsafe.size?'degraded':remainingInventory.length?'yielded':'idle',remainingInventory};
  }catch(e){
    return {...summary(),status:e.flowStatus||(e.code==='LOCAL_EXECUTION_STOPPED'?'stopped':'error'),reason:e.reason,
      error:{...current,message:e.message,code:e.code,stage:e.stage,transactionHash:e.transactionHash,transientRpc:transientRpc(e),retryableRpcRead:retryableRead(e)}};
  }
}
module.exports={validatePrizeFlowJob,runPrizeFlow,MAX_LEGACY,DEFAULT_MAX_STEPS,WORST_CASE_ATTEMPTS};
