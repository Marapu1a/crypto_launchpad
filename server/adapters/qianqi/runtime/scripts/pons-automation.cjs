// Shared Pons coordinator. Public execution requires an explicit profile and guard.
const {ethers}=require('ethers'),path=require('node:path');
const network=require('./runtime-network.cjs'),{withState}=require('./local-scheduler-state.cjs');
const {sendLocalTransaction,withTransactionBoundary}=require('./local-receipt.cjs');
const {runScheduler}=require('./local-promo-scheduler.cjs'),{runDrandDelivery}=require('./drand-delivery-worker.cjs');
const {inspect,ABI}=require('./pons-collector-manual.cjs');
const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const {reconcilePending,createBoundary}=require('./pons-transaction-journal.cjs');
function schedulerConfigFor(c){
 const base={schema:'robinhood-promo-scheduler-v1',manifest:c.manifest,lifecycle:c.lifecycle,campaignId:'1',shortBudgetMode:'FREE_SHORT',chunkSize:64,...(c.recognition?{recognition:c.recognition}:{})};
 check(!c.recognition||(c.buyPolicy&&c.indexer),'Late recognition requires the shared canonical index');
 if(c.indexer!==undefined||c.buyPolicy!==undefined){
  check(c.buyPolicy&&c.indexer,'Pons indexed mode requires policy and indexer together');
  check(c.buyPolicy.genesisHash===require('./direct-buy.cjs').hash(c.manifest)&&c.buyPolicy.instanceId===c.lifecycle.instanceId&&String(c.buyPolicy.chainId)===String(c.manifest.chainId),'Pons policy identity mismatch');
  check(typeof c.indexer.statePath==='string'&&path.isAbsolute(c.indexer.statePath)&&Number.isInteger(c.indexer.maxAgeSeconds)&&c.indexer.maxAgeSeconds>0&&c.indexer.maxAgeSeconds<=3600,'Invalid Pons indexer config');
  return {...base,cutoffMode:'FINALIZED_CHECKPOINT',buyPolicyMode:'admitted',buyPolicy:c.buyPolicy,indexer:c.indexer};
 }
 return {...base,cutoffMode:'LOCAL_HEAD',ponsRehearsal:true,buyPolicyMode:'unadmitted'};
}
function validate(c,{publicMode=false}={}){
 check(c.schema===(publicMode?'pons-public-automation-v1':'pons-rehearsal-automation-v1'),'Explicit Pons execution config required');const profile=require('./pons-profiles.cjs').pool(c.manifest.schema);check(profile,'Expected Pons pool-capable profile');profile.validate(c.manifest);
 check(c.lifecycle.schema==='attempt-lifecycle-v4'&&same(c.lifecycle.vault,c.vault),'Lifecycle binding mismatch');
 for(const k of ['collector','escrow','vault','executor'])check(ethers.isAddress(c[k]),'Invalid '+k);
 for(const k of ['collector','escrow'])check(/^0x[0-9a-f]{64}$/.test(c.codeHashes?.[k]||''),'Missing '+k+' runtime');
 for(const k of ['maxGasPrice','nativeFloor','gasLimit'])check(typeof c[k]==='string'&&/^[0-9]+$/.test(c[k]),'Invalid '+k);
 check(BigInt(c.maxGasPrice)>0n&&BigInt(c.gasLimit)>0n,'Invalid gas budget');
 check(Number.isInteger(c.maxTransactions)&&c.maxTransactions>0&&c.maxTransactions<=128,'Invalid transaction bound');
 check(Number.isInteger(c.pollSeconds)&&c.pollSeconds>=10&&c.pollSeconds<=3600,'Invalid poll interval');
 if(publicMode)check(c.instanceId===undefined&&c.buyPolicy&&c.indexer,'Public config requires policy/index and no Hardhat identity');
 else check(/^0x[0-9a-fA-F]{64}$/.test(c.instanceId),'Explicit Hardhat instance required');
 check(c.deliveryJob.adapter&&same(c.deliveryJob.short,c.lifecycle.source)&&same(c.deliveryJob.monthly,c.lifecycle.monthlySource),'RNG binding mismatch');
 check(c.campaignId==='1'&&Array.isArray(c.recipients)&&c.recipients.length===3&&same(c.recipients[0],c.vault)&&c.recipients.every(ethers.isAddress),'Funding policy required');
 schedulerConfigFor(c);
}
async function runPonsAutomation({provider,executor,config:c,rpcUrl,statePath,signal,drain=false,receiptTimeoutMs=30000,maxTransactions,publicProfile,rehearsalInstance},{onStep=()=>{},getBeacon}={}){
 c=structuredClone(c);publicProfile=publicProfile&&structuredClone(publicProfile);
 const publicMode=!!publicProfile,publicSends=publicMode&&!rehearsalInstance;
 const limit=require('./pons-cadence.cjs').transactionLimit(c,maxTransactions);
 validate(c,{publicMode});check(!rehearsalInstance||publicMode&&/^0x[0-9a-fA-F]{64}$/.test(rehearsalInstance),'Invalid public rehearsal identity');
 check(same(await executor.getAddress(),c.executor)&&executor.provider===provider,'Executor/provider mismatch');
 const compiled=require('./compile.cjs').compile(),contract=(name,address)=>new ethers.Contract(address,compiled[name].abi,provider);
 const publicGuard=publicMode?require('./pons-public-execution.cjs').createGuard({provider,config:c,publicProfile,compiled}):undefined;
 return network.withRobinhoodNetwork({provider,rpcUrl,mode:publicSends?'robinhood-public':'robinhood-rehearsal',publicGuard},async()=>{
  if(!publicSends){const meta=await provider.send('hardhat_metadata',[]);check(meta.instanceId===(rehearsalInstance||c.instanceId)&&(publicMode||Number(meta.forkedNetwork?.chainId)===4663),'Wrong local Robinhood fork');}
  const short=contract('RobinhoodShortController',c.lifecycle.source),monthly=contract('RobinhoodMonthlyController',c.lifecycle.monthlySource),vault=contract('DualControllerPromoVault',c.vault),adapter=contract('DrandRandomAdapter',c.deliveryJob.adapter),collector=new ethers.Contract(c.collector,ABI,provider);
  const schedulerConfig=schedulerConfigFor(c);
  const file=path.resolve(statePath),identity={config:c,rpcUrl:publicMode?network.rpcIdentity(rpcUrl):rpcUrl,sender:c.executor,...(publicMode?{publicProfile,executionScope:publicSends?'public':'public-rehearsal',...(rehearsalInstance?{rehearsalInstance}:{})}:{})};
  return withState(file,identity,async(state,save)=>{
   const steps=[],results={notifications:[]};let sentCount=0;const waits=new Set();
   const gas=require('./pons-gas-budget.cjs').createGasBudget({provider,sender:c.executor,maxGasLimit:c.gasLimit,state,save,notifications:results.notifications});
   const result=(status,reason)=>({continueImmediately:require('./pons-cadence.cjs').continuation({status,pending:state.pending,confirmed:steps.filter(s=>s.transactionHash&&s.status!==0).length,waits:[...waits],results:{...results,nativeFunding:gas.waiting()}}),maxTransactions:limit,status,reason:status==='waiting'&&gas.waiting().length?'nativeFunding':reason,steps,results:{...results,nativeFunding:gas.waiting()},publicSends});
   const wait=reason=>{waits.add(reason);throw Object.assign(Error(reason),{code:'LOCAL_BUDGET_WAIT',budget:{reason},workerWait:reason});};
   async function guard(request,action){
    check(!state.pending,'Unresolved intent');
    if(signal?.aborted)wait('stopped');if(sentCount>=limit)wait('transactionLimit');
    if(publicSends)network.checkChain((await provider.getNetwork()).chainId);
    else{const m=await provider.send('hardhat_metadata',[]);check(m.instanceId===(rehearsalInstance||c.instanceId),'Fork instance changed');}
    if(await provider.getTransactionCount(c.executor,'pending')>await provider.getTransactionCount(c.executor,'latest'))wait('pendingNonce');
    const price=(await provider.getFeeData()).gasPrice;if(price===null||price>BigInt(c.maxGasPrice))wait('gasPrice');
    if(BigInt(request.maxFeePerGas??request.gasPrice??price)>BigInt(c.maxGasPrice))wait('gasPrice');
    if(request.gasLimit&&BigInt(request.gasLimit)>BigInt(c.gasLimit))wait('gasBound');
    await gas.check(request,action,price);
   }
   const boundary={...createBoundary({state,save,provider,sender:c.executor,...(publicSends?{signer:executor}:{}),guard,onConfirmed:async s=>{steps.push(s);sentCount++;await onStep(s);}}),maxGasPrice:c.maxGasPrice,gasLimit:gas.gasLimit,estimateFailed:gas.estimateFailed};
   const deliver={provider,adapter,executor,job:c.deliveryJob,statePath:file+'.rng',signal,receiptTimeoutMs};
   const schedule={provider,short,monthly,publisher:executor,executor,config:schedulerConfig,...(schedulerConfig.indexer?{indexConfig:require('./shared-index-config.cjs').buildIndexConfigs(schedulerConfig).indexConfig}:{}),rpcUrl,statePath:file+'.scheduler',signal,receiptTimeoutMs};
   function fairSchedule(){return {...schedule,kinds:require('./pons-cadence.cjs').laneOrder(state.lastResolved?.target,short.target)};}
   async function send(method,args=[]){const observed=(await provider.getFeeData()).gasPrice;const padded=publicSends?(observed*120n+99n)/100n:observed;const price=padded>BigInt(c.maxGasPrice)?BigInt(c.maxGasPrice):padded;return sendLocalTransaction(method,args,{type:2,maxFeePerGas:price,maxPriorityFeePerGas:0},{signal,receiptTimeoutMs});}
   async function claims(){
    state.payouts??=[];
    await require('./pons-payout-scan.cjs').scanPayouts({provider,short,monthly,state,save,anchor:c.manifest.anchor,signal});
    for(const p of [...state.payouts]){
     check(same((await provider.getBlock(p.blockNumber))?.hash,p.blockHash),'Payout origin reorg');
     try{if(await vault.reward(p.draw,p.winner)>0n)await send(vault.connect(executor).claim,[p.draw,p.winner]);}
     catch(e){if(e.code==='LOCAL_BUDGET_WAIT'&&e.budget?.reason==='nativeFunding')continue;if(!e.definiteRejection)throw e;(results.claimFailures??=[]).push({draw:p.draw,winner:p.winner});continue;}
     state.payouts=state.payouts.filter(x=>x!==p);save(state);
    }
   }
   try{
    const unresolved=await reconcilePending(state,save,provider,c.executor);if(unresolved)return {...unresolved,steps,results,publicSends};
    if(state.lastResolved)check(same((await provider.getBlock(state.lastResolved.blockNumber))?.hash,state.lastResolved.blockHash),'Resolved transaction reorg; explicit recovery required');
    const child=await runDrandDelivery({...deliver,reconcileOnly:true});if(['blocked','error','stopped'].includes(child.status))return result(child.status,child.reason);
    for(const [address,digest]of [[c.vault,c.lifecycle.vaultCodeHash],[short.target,c.lifecycle.sourceCodeHash],[monthly.target,c.lifecycle.monthlySourceCodeHash],[adapter.target,c.deliveryJob.adapterCodeHash]])check(same(ethers.keccak256(await provider.getCode(address)),digest),'Obligation runtime changed');
    check(same(await short.randomProvider(),adapter.target)&&same(await monthly.randomProvider(),adapter.target),'RNG binding changed');
    return await withTransactionBoundary(boundary,async()=>{
     await claims();
     results.rng=await runDrandDelivery({...deliver,transactionGasLimit:gas.gasLimit,transactionEstimateFailed:gas.estimateFailed,transactionGuard:async(request,action,before)=>{await guard(request,action);if(before)sentCount++;}},{...(getBeacon?{getBeacon}:{}),onStep:async s=>{steps.push(s);await onStep(s);}});
     if(['blocked','error','stopped'].includes(results.rng.status))return result(results.rng.status,results.rng.reason);
     results.settlement=await runScheduler({...fairSchedule(),allowNewJobs:false,obligationsOnly:drain||publicMode},{maxTicks:16});
     if(state.pending)return result('blocked',state.pending.transactionHash?'pendingReceipt':'unknownHash');
     if(['error','blocked','stopped'].includes(results.settlement.status))return result(results.settlement.status,'settlement');
     await claims();
     if(!drain&&c.recognitionPublishing?.enabled){
      const source=new ethers.Contract(c.recognition.source,require('./purchase-recognition.cjs').ABI,executor);
      results.recognition=await require('./recognition-worker.cjs').run({config:c,provider,lastResolved:state.lastResolved,send:plan=>send(source.confirm,[plan.bundleHash,plan.count])});
      if(results.recognition.status==='waiting')return result('waiting',results.recognition.reason);
     }
     if(!drain){
      try{
       for(const k of ['collector','escrow'])check(same(ethers.keccak256(await provider.getCode(c[k])),c.codeHashes[k]),'Funding runtime changed');
       check(same(await collector.promoVault(),c.vault)&&same(await collector.quoteToken(),c.manifest.quote)&&same(await collector.escrow(),c.escrow),'Funding binding changed');
       check(String(await collector.campaignId())===c.campaignId,'Campaign changed');const policy=await collector.policy(c.campaignId);
       check(policy.recipients.every((a,i)=>same(a,c.recipients[i]))&&policy.bps.every((n,i)=>n===BigInt([9000,500,500][i])),'Funding allocation changed');
       results.funding=[];
       await require('./pons-funding-pass.cjs').runFundingPass({loadPlan:()=>inspect(provider,c.collector,c.executor),send:(method,args)=>send(collector.connect(executor)[method],args),results:results.funding});
      }catch(e){if(state.pending||['LOCAL_BUDGET_WAIT','SCHEDULER_STORAGE_ERROR'].includes(e.code))throw e;results.fundingError=publicMode?'Funding admission or execution unavailable':e.message;if(e.code==='PONS_PUBLIC_ADMISSION')results.fundingAdmission=e.admissionReasons;}
      if(!results.fundingError&&!gas.waiting().length){results.scheduler=await runScheduler(fairSchedule(),{maxTicks:16});if(state.pending)return result('blocked',state.pending.transactionHash?'pendingReceipt':'unknownHash');if(['error','blocked','stopped'].includes(results.scheduler.status))return result(results.scheduler.status,'scheduler');}
     }
     await claims();return result('waiting',drain?'draining':'poll');
    });
   }catch(e){if(state.pending)return result('blocked',state.pending.transactionHash?'pendingReceipt':'unknownHash');if(e.code==='LOCAL_BUDGET_WAIT')return result(signal?.aborted?'stopped':'waiting',e.message);return {...result('error',e.code||'runtimeError'),...(e.code==='PONS_PUBLIC_ADMISSION'?{admissionReasons:e.admissionReasons}:{}),error:publicMode?'Execution unavailable; retain journals for inspection':e.message};}
  });
 });
}
module.exports={validate,reconcilePending,runPonsAutomation,schedulerConfigFor};
