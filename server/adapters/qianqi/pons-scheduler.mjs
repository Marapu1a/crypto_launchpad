// Internal Hardhat-only integration. No production/config/HTTP switch exposes this runner.
import {createRequire} from 'node:module';
import {ZeroHash,id,Contract} from 'ethers';
import {digest} from '../../../src/tickets/digest.mjs';
import {validateMigration,advanceMigration,prepareMigrationJob,sealMigration} from './pons-migration.mjs';
import {applyControllerReceipt} from './pons-controller-events.mjs';
import {fundFromPons} from './pons-funding.mjs';
import {rememberPublications,receiptPublicationSource} from './pons-publications.mjs';
import {validatePonsExecutionBinding} from './pons-execution-binding.mjs';
const require=createRequire(import.meta.url),base='./runtime/scripts/';
const network=require(base+'runtime-network.cjs'),{withState}=require(base+'local-scheduler-state.cjs');
const {createBoundary,reconcilePending}=require(base+'pons-transaction-journal.cjs');
const {withTransactionBoundary,sendLocalTransaction}=require(base+'local-receipt.cjs');
const {domainFor}=require(base+'attempt-lifecycle.cjs'),{drawIdFor}=require(base+'draw-id.cjs');
const sw=require(base+'local-short-executor.cjs'),mw=require(base+'local-monthly-executor.cjs');
const check=(ok,m)=>{if(!ok)throw Error(m);},same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const object=r=>Object.fromEntries(['version','pNumerator','pDenominator','hNumerator','hDenominator'].map(k=>[k,Number(r[k])]));
export async function runPonsScheduler({provider,short,monthly,executor,config,rpcUrl,statePath,bootstrap,loadReport,deliveryJob,getBeacon,funding,execution,receiptHashes=[],now=()=>Math.floor(Date.now()/1000),hook=async()=>{}}){
 let meta,publicGuard;
 if(execution){
  check(execution.allowPublicTransactions===true,'Explicit Pons activation required');
  await require('./fence.cjs').checkFence({required:true});
  const c=execution.config;
  require(base+'pons-automation.cjs').validate(c,{publicMode:true});
  validatePonsExecutionBinding({config,funding,deliveryJob,publicConfig:c,sender:await executor.getAddress()});
  publicGuard=require(base+'pons-public-execution.cjs').createGuard({provider,config:c,publicProfile:execution.profile,compiled:require(base+'compile.cjs').compile()});
 }else{
  meta=await provider.send('hardhat_metadata',[]);
  check(/^(Hardhat|edr\/)/.test(meta?.clientVersion??'')&&meta.chainId===4663&&/^0x[0-9a-f]{64}$/i.test(meta.instanceId),'Pons scheduler is rehearsal-only');
 }
 validateMigration(bootstrap);check(same(short.target,bootstrap.domain.source)&&same(monthly.target,bootstrap.domain.monthlySource),'Wrong migration controllers');
 check(digest(domainFor(config.manifest,config.lifecycle))===digest(bootstrap.domain),'Scheduler migration domain mismatch');
 if(deliveryJob)check(same(deliveryJob.short,short.target)&&same(deliveryJob.monthly,monthly.target),'RNG controller mismatch');
 if(funding)check(same(funding.quote,config.manifest.quote),'Funding quote mismatch');
 const sender=await executor.getAddress(),identity={schema:execution?'pons-scheduler-production-v1':'pons-scheduler-rehearsal-v1',...(execution?{executionHash:digest(execution)}:{instance:meta.instanceId}),sender:sender.toLowerCase(),config,...(deliveryJob?{deliveryJob}:{}),...(funding?{funding}:{}),legacyHash:bootstrap.legacyHash,boundary:bootstrap.boundary};
 return network.withRobinhoodNetwork({provider,rpcUrl,sharedReader:provider,mode:execution?'robinhood-public':'robinhood-rehearsal',publicGuard},()=>withState(statePath,identity,async(state,save)=>{
  if(!state.migration){state.migration=structuredClone(bootstrap);save(state);}
  validateMigration(state.migration);
  check((await provider.getBlock(state.migration.boundary.number))?.hash===state.migration.boundary.hash,'Migration boundary changed');
  let startedTransactions=state.pending?1:0;
  const unresolved=await reconcilePending(state,save,provider,sender,{recoverSigned:true});if(unresolved)return unresolved;
  const sync=async hash=>{
   const receipt=await provider.getTransactionReceipt(hash);check(receipt&&receipt.status===1,'Controller transaction failed/unavailable');
   const block=await provider.getBlock(receipt.blockNumber),finalized=await provider.getBlock('finalized');
   check(block?.hash===receipt.blockHash,'Controller receipt reorg');
   if(!finalized||finalized.number<block.number)return false;
   state.migration=applyControllerReceipt(state.migration,{receipt,block,manifest:config.manifest,lifecycle:config.lifecycle});rememberPublications(state,receipt,[short,monthly]);save(state);return true;
  };
  // Last resolved is persisted before accounting, so a crash between them is recoverable.
  if(state.lastResolved&&!await sync(state.lastResolved.transactionHash))return {status:'waiting',reason:'receiptFinality'};
  const external=[];for(const hash of receiptHashes){const receipt=await provider.getTransactionReceipt(hash);check(receipt,'Missing external receipt');external.push(receipt);}
  external.sort((a,b)=>a.blockNumber-b.blockNumber||a.index-b.index);
  for(const receipt of external)if(!await sync(receipt.hash))return {status:'waiting',reason:'receiptFinality'};
  const steps=[],notifications=[],gas=execution?require(base+'pons-gas-budget.cjs').createGasBudget({provider,sender,maxGasLimit:execution.config.gasLimit,state,save,notifications}):null;
  const guard=async(request,action)=>{
   check(!state.pending,'Unresolved transaction');
   if(execution){
    await require('./fence.cjs').checkFence({required:true});network.checkChain((await provider.getNetwork()).chainId);
    check(startedTransactions<execution.config.maxTransactions,'Pons transaction limit');
    const price=(await provider.getFeeData()).gasPrice;check(price!==null&&price<=BigInt(execution.config.maxGasPrice)&&BigInt(request.maxFeePerGas??request.gasPrice??price)<=BigInt(execution.config.maxGasPrice),'Pons gas price limit');
    await gas.check(request,action,price);
   }else{const m=await provider.send('hardhat_metadata',[]);check(m.instanceId===meta.instanceId,'Rehearsal instance changed');}
   check(await provider.getTransactionCount(sender,'pending')===await provider.getTransactionCount(sender,'latest'),'Pending signer transaction');
   await hook('beforeTransaction',{action,request});
  };
  const boundary=createBoundary({state,save,provider,sender,guard,signer:executor,onConfirmed:async resolved=>{steps.push(resolved);await hook('confirmed',resolved);if(!await sync(resolved.transactionHash))throw Error('Await finalized controller receipt');}});
  const before=boundary.before;boundary.before=async(...args)=>{await before(...args);startedTransactions++;};
  if(execution)Object.assign(boundary,{maxGasPrice:execution.config.maxGasPrice,gasLimit:gas.gasLimit,estimateFailed:gas.estimateFailed});
  const sent=boundary.sent;boundary.sent=async tx=>{await sent(tx);await hook('sent',{transactionHash:tx.hash});};
  return withTransactionBoundary(boundary,async()=>{
   const send=async(method,args)=>sendLocalTransaction(method,args,{type:2,maxFeePerGas:(await provider.getFeeData()).gasPrice,maxPriorityFeePerGas:0});
   // Do not run the old coordinator: its independent purchase indexer is not needed here.
   let fundingResults=null,fundingError=false;
   try{fundingResults=funding?await fundFromPons({provider,executor,config:funding,domain:state.migration.domain,send}):null;}
   catch(error){if(state.pending||error.code==='SCHEDULER_STORAGE_ERROR')throw error;fundingError=true;}
   const head=await provider.getBlock('latest'),finalized=await provider.getBlock('finalized');check(head&&finalized,'Missing chain head');
   const controllers={SHORT:receiptPublicationSource(short,provider,()=>state.publications),MONTHLY:receiptPublicationSource(monthly,provider,()=>state.publications)},at={blockTag:head.number};
   // Unexpected outside state never turns into duplicate jobs or guessed consumption.
   for(const [kind,source] of Object.entries(controllers)){
    const isShort=kind==='SHORT',r=state.migration.ledger[isShort?'shortRules':'monthlyRules'];
    const current=await source[isShort?'currentShortEpoch':'currentMonthlyEpoch'](at),draining=await source[isShort?'drainingShortEpoch':'drainingMonthlyEpoch'](at),pending=await source[isShort?'pendingDatasetDraw':'pendingMonth'](at),last=await source[isShort?'lastShortTerminalAt':'lastMonthAt'](at);
    if(Number(current)!==r.currentEpoch||Number(draining)!==r.drainingEpoch||pending!==(state.migration.ledger.pending[kind]??ZeroHash)||Number(last)!==r.lastTerminalAt)return {status:'waiting',reason:'controllerReceiptsRequired',kind};
    const active=await source[isShort?'activeProposal':'activeMonth'](at);
    if(active!==ZeroHash&&!state.jobs[kind].some(e=>(isShort?e.job?.proposalId:e.job?.artifact.request.drawId)===active))return {status:'waiting',reason:'unknownControllerJob',kind};
   }
   if(deliveryJob&&Object.values(state.migration.ledger.pending).some(Boolean)){
    const adapter=new Contract(deliveryJob.adapter,require(base+'drand-delivery-worker.cjs').abi,provider);
    const rng=await require(base+'drand-delivery-worker.cjs').runDrandDelivery({provider,adapter,executor,job:deliveryJob,statePath:statePath+'.rng',durableSigning:true,...(execution?{transactionGasLimit:gas.gasLimit,transactionEstimateFailed:gas.estimateFailed,transactionGuard:async(request,action,committing)=>{await guard(request,action);if(committing)startedTransactions++;}}:{})},getBeacon?{getBeacon}:{});
    steps.push(...rng.steps);
    if(['blocked','error','stopped','degraded'].includes(rng.status))return {status:rng.status,reason:'rng',rng,steps};
   }
   const vault=new Contract(state.migration.domain.vault,['function reward(bytes32,address) view returns(uint256)','function claim(bytes32,address)','function freeCurrent() view returns(uint256)','function freeNext() view returns(uint256)','function nextStartTarget() view returns(uint256)','function freeShort() view returns(uint256)'],executor);
   for(const reward of state.migration.controllerRewards??[])if(!reward.paid){
    if(await vault.reward(reward.drawId,reward.winner)===0n)return {status:'waiting',reason:'rewardReceiptRequired'};
    await send(vault.claim,[reward.drawId,reward.winner]);return {status:'progress',action:'claim',steps};
   }
   const kinds=state.lastKind==='SHORT'?['MONTHLY','SHORT']:['SHORT','MONTHLY'];
   let sourceError;
   try{state.migration=advanceMigration({state:state.migration,report:await loadReport(),head:{number:finalized.number,hash:finalized.hash,timestamp:finalized.timestamp},now:now()});save(state);}catch(e){if(e.code==='SCHEDULER_STORAGE_ERROR')throw e;sourceError=e.message;}
   const waits=[];
   for(const kind of kinds){
    const source=controllers[kind],isShort=kind==='SHORT',r=state.migration.ledger[isShort?'shortRules':'monthlyRules'];
    let entry=state.jobs[kind].find(e=>!e.terminal);
    if(!entry){
     if(fundingError){waits.push({kind,reason:'fundingUnavailable'});continue;}
     if(sourceError){waits.push({kind,reason:'sourceUnavailable',detail:sourceError});continue;}
     if(state.migration.ledger.pending[kind]){waits.push({kind,reason:'missingFrozenJob'});continue;}
     const interval=Number(await source[isShort?'SHORT_INTERVAL':'monthlyInterval'](at));
     if(head.timestamp<r.lastTerminalAt+interval){waits.push({kind,reason:'schedule',nextCheckAt:r.lastTerminalAt+interval});continue;}
     if(finalized.number<r.epochs.find(e=>e.epoch===r.currentEpoch).firstBlock){waits.push({kind,reason:'epochBoundary'});continue;}
     const epoch=r.drainingEpoch||r.currentEpoch,open=state.migration.ledger.wallets.some(w=>w[kind].byEpoch.some(e=>Number(e.epoch)===epoch&&BigInt(e.open)>0n));
     if(!open&&!r.drainingEpoch){waits.push({kind,reason:'empty'});continue;}
     let policy=await source[isShort?'shortEpochPolicy':'monthlyEpochPolicy'](epoch,{blockTag:finalized.number});
     let budget=isShort?config.shortBudgetMode==='FREE_SHORT'?String(await vault.freeShort({blockTag:finalized.number})):config.shortBudget:undefined;
     if(open&&isShort&&BigInt(budget)/Array.from(policy.weights).reduce((n,x)=>n+x,0n)<policy.minimumUnit){waits.push({kind,reason:'prizeFunding'});continue;}
     state.cutoffs??={};
     if(!state.cutoffs[kind]){
      const number=Math.max(head.number-1,state.migration.ledger.head.number),block=await provider.getBlock(number);
      check(block?.hash,'Missing fresh cutoff');
      state.cutoffs[kind]={number,hash:block.hash,migration:structuredClone(state.migration)};save(state);
     }
     const candidate=state.cutoffs[kind];
     if(execution&&candidate.number>=head.number){waits.push({kind,reason:'cutoffDelay'});continue;}
     const checkpoint=await require(base+'cutoff-checkpoint.cjs').prepareCutoff({provider,source,publisher:executor,kind,state,save,finalized});
     if(checkpoint.status!=='ready'){state.lastKind=kind;save(state);return {...checkpoint,kind,steps};}
     const cutoffHead=checkpoint.block,view=structuredClone(candidate.migration);
     validateMigration(view);
     const savedRules=view.ledger[isShort?'shortRules':'monthlyRules'];
     if((savedRules.drainingEpoch||savedRules.currentEpoch)!==epoch||savedRules.lastTerminalAt!==r.lastTerminalAt){delete state.cutoffs[kind];save(state);return {status:'progress',action:'discardCutoff',kind,steps};}
     check(cutoffHead.number>=view.ledger.head.number,'Cutoff precedes captured admissions');
     view.ledger.head={number:cutoffHead.number,hash:cutoffHead.hash,timestamp:cutoffHead.timestamp};view.accounting.head={...view.ledger.head};
     policy=await source[isShort?'shortEpochPolicy':'monthlyEpochPolicy'](epoch,{blockTag:cutoffHead.number});
     budget=isShort?config.shortBudgetMode==='FREE_SHORT'?String(await vault.freeShort({blockTag:cutoffHead.number})):config.shortBudget:undefined;
     const identity=digest({kind,cutoff:cutoffHead.hash,revision:view.accounting.revision,domain:view.domain,epoch});
     const drawId=drawIdFor(kind,'0x'+identity),input={manifest:config.manifest,lifecycle:config.lifecycle,rules:object(policy.outcome),...(isShort?{weights:Array.from(policy.weights,String),minimumUnit:String(policy.minimumUnit)}:{}),request:isShort?{drawId,campaignId:config.campaignId,rulesEpoch:String(epoch),cutoffBlockNumber:cutoffHead.number,cutoffBlockHash:cutoffHead.hash,budget}:{drawId,campaign:config.campaignId,rulesEpoch:String(epoch),cutoff:cutoffHead.number,cutoffHash:cutoffHead.hash}};
     const prepared=prepareMigrationJob(sealMigration(view),kind,input);
     state.migration.artifacts[kind+':'+drawId]=prepared.state.artifacts[kind+':'+drawId];state.migration=sealMigration(state.migration);
     const artifact=prepared.artifact;
     entry=artifact.schema.includes('empty-epoch')?{empty:artifact}:{job:isShort?sw.makeJob(artifact,id('pons proposal '+identity),config.chunkSize):mw.makeMonthlyJob(artifact,config.chunkSize)};
     state.jobs[kind].push(entry);delete state.cutoffs[kind];save(state);await hook('savedJob',{kind});
    }
    const artifact=entry.empty??entry.job.artifact,cutoff=artifact.snapshot?.cutoff??artifact.cutoff;
    check((await provider.getBlock(cutoff.blockNumber))?.hash===cutoff.blockHash,'Job cutoff reorg');
    if(await source.cutoffHashes(cutoff.blockNumber)===ZeroHash){
     // A durable job precedes checkpoint/begin. Never substitute its participants on restart.
     await send(source.connect(executor).checkpointCutoff,[cutoff.blockNumber]);state.lastKind=kind;save(state);return {status:'progress',action:'checkpointCutoff',kind,steps};
    }
    if(entry.empty){await send(source.connect(executor).closeEmpty,[cutoff.blockNumber,cutoff.blockHash,artifact.snapshotHash]);entry.terminal=true;state.lastKind=kind;save(state);return {status:'progress',action:'closeEmpty',kind,steps};}
    const result=await (isShort?sw.stepShort:mw.stepMonthly)({provider,source,publisher:executor,executor,job:entry.job});
    if(result.status==='terminal'){entry.terminal=true;save(state);continue;}
    if(result.status==='progress'){state.lastKind=kind;save(state);return {...result,kind,steps};}
    waits.push({kind,...result});
   }
   return {status:'waiting',results:waits,steps,funding:fundingResults,sourceStatus:sourceError?'unavailable':'current'};
  });
 }));
}
