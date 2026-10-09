const network=require('./runtime-network.cjs');
const {transientRpc,retryableRead}=require('./local-rpc-watch.cjs');
const {ethers}=require('ethers');
const {scan}=require('./replay-direct-buy.cjs');
const {hash,validateManifest,buyPolicyHistory}=require('./direct-buy.cjs');
const {domainFor,replayAttempts}=require('./attempt-lifecycle.cjs');
const {verifyDualBindings}=require('./dual-bindings.cjs');
const sd=require('./short-dataset.cjs'),md=require('./monthly-dataset.cjs');
const sw=require('./local-short-executor.cjs'),mw=require('./local-monthly-executor.cjs');
const {drawIdFor}=require('./draw-id.cjs');
const {withState}=require('./local-scheduler-state.cjs');
const {sendLocalTransaction,receiptOptions}=require('./local-receipt.cjs');
const check=(ok,msg)=>{if(!ok)throw Error(msg);},zero=ethers.ZeroHash;
const {resolveBuyPolicy}=require('./buy-policy-runtime.cjs');
const wait=reason=>({status:'waiting',reason});
async function history(o,manifest,cutoff){
 if(!o.config.indexer)return scan(manifest,o.rpcUrl,cutoff,o.config.lifecycle);
 const config=o.indexConfig?require('./shared-index-config.cjs').validateIndexConfig(o.config,o.indexConfig):o.config;
 return require('./persistent-buy-indexer.cjs').readSnapshot({config,statePath:config.indexer.statePath,manifest,cutoff,rpc:(m,p)=>o.provider.send(m,p)});
}
function validateConfig(c,rpcUrl){
  if(c.indexer)check(c.buyPolicy&&c.cutoffMode==='FINALIZED_CHECKPOINT'&&typeof c.indexer.statePath==='string'&&require('node:path').isAbsolute(c.indexer.statePath)&&Number.isInteger(c.indexer.maxAgeSeconds)&&c.indexer.maxAgeSeconds>0&&c.indexer.maxAgeSeconds<=3600,'Invalid indexer configuration');
  check(c.schema===network.schema('local-promo-scheduler-v1')&&['LOCAL_HEAD','FINALIZED_CHECKPOINT'].includes(c.cutoffMode),'Explicit local scheduler config required');
  if(c.cutoffMode==='FINALIZED_CHECKPOINT')check(c.buyPolicy,'Finalized checkpoint requires admitted BUY policy');
  const ponsResearch=c.ponsRehearsal===true&&network.current().mode==='robinhood-rehearsal'&&!!require('./pons-profiles.cjs').pool(c.manifest.schema)&&c.buyPolicyMode==='unadmitted'&&!c.buyPolicy;
  if(c.ponsRehearsal!==undefined)check(ponsResearch,'Pons research mode requires an identified local rehearsal');
  validateManifest(c.manifest);network.checkChain(c.manifest.chainId);check(c.lifecycle.schema==='attempt-lifecycle-v4','Lifecycle v4 required');
  if(network.isRobinhood())check(c.cutoffMode==='FINALIZED_CHECKPOINT'||ponsResearch&&c.cutoffMode==='LOCAL_HEAD','Public checkpoint mode required');
  if(c.buyPolicy)check(c.buyPolicy.genesisHash===hash(c.manifest)&&String(c.buyPolicy.chainId)===String(c.manifest.chainId)&&c.buyPolicy.instanceId===c.lifecycle.instanceId,'BUY policy binding mismatch');
  check(BigInt(c.campaignId)>0n,'Invalid campaign');
  check(c.shortBudgetMode===undefined||['FIXED','FREE_SHORT'].includes(c.shortBudgetMode),'Invalid Short budget mode');
  if(c.shortBudgetMode==='FREE_SHORT')check(c.shortBudget===undefined,'FREE_SHORT cannot contain a fixed budget');
  else check(BigInt(c.shortBudget)>0n,'Invalid campaign/budget');
  check(Number.isInteger(c.chunkSize)&&c.chunkSize>0&&c.chunkSize<=64,'Invalid chunk size');
  network.checkRpc(rpcUrl);
  return domainFor(c.manifest,c.lifecycle);
}
async function pendingSigner(provider,signers){
  for(const signer of signers.filter(Boolean)){
    const address=await signer.getAddress();
    if(await provider.getTransactionCount(address,'pending')>await provider.getTransactionCount(address,'latest'))return true;
  }
  return false;
}
const ruleObject=r=>Object.fromEntries(['version','pNumerator','pDenominator','hNumerator','hDenominator'].map(k=>[k,Number(r[k])]));
// Derive requests from pinned config and chain policy, never mutable job fields.
function datasetInput(kind,config,manifest,policy,epoch,cutoff,configHash,shortBudget=config.shortBudget){
  const isShort=kind==='SHORT';
  const identity=hash({config:configHash,kind,cutoff:cutoff.hash,epoch:String(epoch)});
  const drawId=drawIdFor(kind,identity);
  return {identity,drawId,input:{manifest,lifecycle:config.lifecycle,rules:ruleObject(policy.outcome),
    ...(isShort?{weights:Array.from(policy.weights,String),minimumUnit:String(policy.minimumUnit)}:{}),
    request:isShort?{drawId,campaignId:config.campaignId,rulesEpoch:String(epoch),cutoffBlockNumber:cutoff.number,cutoffBlockHash:cutoff.hash,budget:shortBudget}:
      {drawId,campaign:config.campaignId,rulesEpoch:String(epoch),cutoff:cutoff.number,cutoffHash:cutoff.hash}}};
}
async function shortBudgetAt(config,source,provider,blockTag){
  if(config.shortBudgetMode!=='FREE_SHORT')return config.shortBudget;
  check(await source.maxBudget({blockTag})===ethers.MaxUint256,'FREE_SHORT requires uncapped controller');
  const vault=new ethers.Contract(await source.datasetVault({blockTag}),['function freeShort() view returns(uint256)'],provider);
  return String(await vault.freeShort({blockTag}));
}
async function tickKind(kind,o,state,save){
  const {provider,config,publisher,executor,signal}=o,isShort=kind==='SHORT',source=isShort?o.short:o.monthly;
  if(signal?.aborted)return {status:'stopped'};
  // Execution state is live; finalized is only the admission/dataset cutoff.
  const head=await provider.getBlock('latest'),at={blockTag:head.number};
  const active=await source[isShort?'activeProposal':'activeMonth'](at);
  const pending=await source[isShort?'pendingDatasetDraw':'pendingMonth'](at);
  const current=await source[isShort?'currentShortEpoch':'currentMonthlyEpoch'](at);
  const draining=await source[isShort?'drainingShortEpoch':'drainingMonthlyEpoch'](at);
  let selected;
  for(const entry of state.jobs[kind]){
    if(entry.retired)continue;
    let frozen=false;
    if(entry.job){
      const p=isShort?await source.datasetProposal(entry.job.proposalId,at):await source.month(entry.job.artifact.request.drawId,at);
      check((isShort?p.status:p.phase)!==0n||!entry.started,'Previously started job disappeared; explicit reorg recovery required');
      frozen=isShort?p.status===4n:[3n,4n,5n].includes(p.phase);
    }
    if(o.obligationsOnly&&!frozen)continue;
    if(config.buyPolicy&&!frozen){
      const artifact=entry.empty||entry.job.artifact;
      const snapshot=artifact.snapshot||artifact;
      const cutoff=snapshot.cutoff.blockNumber;
      const historical=await resolveBuyPolicy(config,(m,p)=>provider.send(m,p),cutoff);
      check(cutoff<=historical.admission.checkpoint.number,'Stored job cutoff is not finalized');
      const expected=hash(buyPolicyHistory(historical.manifest).at(cutoff));
      check(snapshot.domain.buyManifestHash===expected,'Stored job BUY policy mismatch');
    }
    if(entry.empty){
      if(BigInt(entry.empty.epoch)===draining){selected=entry;break;}
      continue;
    }
    const job=entry.job;(isShort?sw.validateCachedJob:mw.validateCachedJob)(provider,job);
    const p=isShort?await source.datasetProposal(job.proposalId,at):await source.month(job.artifact.request.drawId,at);
    const phase=isShort?p.status:p.phase;
    // A surviving cutoff does not authorize replaying a previously observed begin/freeze.
    check(phase!==0n||!entry.started,'Previously started job disappeared; explicit reorg recovery required');
    const terminal=isShort?phase===4n&&(await source.settlements(job.artifact.request.drawId,at)).phase===3n:phase===5n;
    if(terminal&&entry.terminalChecked){
      const checked=await provider.getBlock(entry.terminalChecked.number);
      if(checked?.hash===entry.terminalChecked.hash)continue;
    }
    if(phase===(isShort?3n:6n))continue;
    const clearedTerminal=!terminal&&entry.terminalChecked!==undefined;
    if(!terminal)delete entry.terminalChecked;
    // Progress lives on chain. Persist transitions, not the unchanged large artifact.
    if(phase!==0n&&(!entry.started||clearedTerminal)){entry.started=true;save(state);}
    selected=entry;break;
  }
  if(selected){
    const a=selected.empty||selected.job.artifact;
    const cutoff=selected.empty?a.cutoff:a.snapshot.cutoff;
    const anchor=await provider.getBlock(Number(cutoff.blockNumber));
    if(!anchor||anchor.hash!==cutoff.blockHash||(head.number+1-Number(cutoff.blockNumber)>256&&await source.cutoffHashes(cutoff.blockNumber)!==cutoff.blockHash)){
      // Expiration matters only before begin. An anchored on-chain proposal may finish later.
      const begun=selected.empty?false:(isShort?
        (await source.datasetProposal(selected.job.proposalId,at)).status!==0n:
        (await source.month(a.request.drawId,at)).phase!==0n);
      if(!begun){
        check(!selected.started,'Previously started job disappeared; explicit reorg recovery required');
        if(await pendingSigner(provider,[publisher,executor]))return wait('pendingTransaction');
        check(active===zero&&pending===zero,'Other on-chain job requires recovery');
        selected.retired='unsubmitted cutoff changed/expired';save(state);
        return {status:'progress',action:'retireUnsubmitted'};
      }
    }
    if(selected.empty){
      if(!publisher||(await publisher.getAddress()).toLowerCase()!==(await source.publisher()).toLowerCase())return wait('publisher');
      if(active!==zero||pending!==zero)return wait('otherDraw');
      // Rebuild from public history rather than trusting an empty assertion from disk.
      const historical=await resolveBuyPolicy(config,(m,p)=>provider.send(m,p),cutoff.blockNumber);
      const blocks=(await history(o,historical.manifest,cutoff.blockNumber)).blocks;
      const rebuilt=(isShort?sd:md).buildFromHistory({...selected.input,manifest:historical.manifest,blocks});
      check(hash(rebuilt)===hash(selected.empty),'Empty epoch differs from replay');
      const price=(await provider.getFeeData()).gasPrice;
      if(price==null||price>await source.maxGasPrice())return wait('gasPrice');
      if(await pendingSigner(provider,[publisher,executor]))return wait('pendingTransaction');
      if(BigInt(head.number+1)<BigInt(cutoff.blockNumber)+await source.cutoffDelayBlocks())return wait('cutoffDelay');
      if(signal?.aborted)return {status:'stopped'};
      const receipt=await sendLocalTransaction(source.connect(publisher).closeEmpty,[cutoff.blockNumber,cutoff.blockHash,a.snapshotHash],
        {type:2,maxFeePerGas:price,maxPriorityFeePerGas:0},{signal,receiptTimeoutMs:o.receiptTimeoutMs});
      return {status:'progress',action:'closeEmpty',transactionHash:receipt.hash};
    }
    const begun=isShort?(await source.datasetProposal(selected.job.proposalId)).status!==0n:
      (await source.month(a.request.drawId)).phase!==0n;
    if(!begun){
      check(!selected.started,'Previously started job disappeared; explicit reorg recovery required');
      // Under scheduler lock; no durable "verified" flag that could outlive a reorg/edit.
      const historical=await resolveBuyPolicy(config,(m,p)=>provider.send(m,p),cutoff.blockNumber);
      const blocks=(await history(o,historical.manifest,cutoff.blockNumber)).blocks;
      const ledger=replayAttempts(historical.manifest,config.lifecycle,blocks);
      check(ledger.head.hash===cutoff.blockHash,'Stored job cutoff differs from replay');
      const epochs=isShort?ledger.shortRules:ledger.monthlyRules;
      const epoch=BigInt(epochs.drainingEpoch||epochs.currentEpoch);
      const policy=await source[isShort?'shortEpochPolicy':'monthlyEpochPolicy'](epoch,{blockTag:cutoff.blockNumber});
      const rebuiltInput=datasetInput(kind,config,historical.manifest,policy,epoch,
        {number:cutoff.blockNumber,hash:cutoff.blockHash},state.configHash,
        isShort?await shortBudgetAt(config,source,provider,cutoff.blockNumber):undefined);
      const rebuilt=(isShort?sd:md).buildFromHistory({...rebuiltInput.input,blocks});
      check(hash(rebuilt)===hash(a),'Stored job differs from independent replay');
      if(isShort)check(selected.job.proposalId===ethers.id('scheduler proposal '+rebuiltInput.identity),'Stored proposal identity differs from replay');
      // Recheck cutoff after policy reads; executors also check canonicality and on-chain state.
      check((await provider.getBlock(Number(cutoff.blockNumber)))?.hash===cutoff.blockHash,'Stored job cutoff changed during verification');
    }
    if(config.ponsRehearsal&&await source.cutoffHashes(cutoff.blockNumber)===zero){
      check(publisher,'Checkpoint publisher required');
      const price=(await provider.getFeeData()).gasPrice;
      const receipt=await sendLocalTransaction(source.connect(publisher).checkpointCutoff,[cutoff.blockNumber],{type:2,maxFeePerGas:price,maxPriorityFeePerGas:0},{signal,receiptTimeoutMs:o.receiptTimeoutMs});
      return {status:'progress',action:'checkpointCutoff',transactionHash:receipt.hash};
    }
    const result=await (isShort?sw.stepShort:mw.stepMonthly)({provider,source,publisher,executor,job:selected.job,signal,receiptTimeoutMs:o.receiptTimeoutMs});
    if(result.status==='progress'&&!selected.started){selected.started=true;save(state);}
    if(result.status==='terminal'){
      const checked=await provider.getBlock('latest');selected.terminalChecked={number:checked.number,hash:checked.hash};save(state);
    }
    return result;
  }
  if(o.obligationsOnly)return wait(pending!==zero?'missingFrozenJob':'obligationsOnly');
  if(active!==zero||pending!==zero)return wait('missingJob');
  if(o.allowNewJobs===false)return wait('newJobsDeferred');
  const last=await source[isShort?'lastShortTerminalAt':'lastMonthAt'](at);
  const interval=await source[isShort?'SHORT_INTERVAL':'monthlyInterval'](at);
  if(BigInt(head.timestamp)<last+interval)return wait('schedule');
  const resolved=await resolveBuyPolicy(config,(m,p)=>provider.send(m,p));
  let buyManifest=resolved.manifest;
  if(!publisher||(await publisher.getAddress()).toLowerCase()!==(await source.publisher(at)).toLowerCase())return wait('publisher');
  if(await pendingSigner(provider,[publisher,executor]))return wait('pendingTransaction');
  const epoch=draining||current;
  const policy=await source[isShort?'shortEpochPolicy':'monthlyEpochPolicy'](epoch,at);
  const currentPolicy=await source[isShort?'shortEpochPolicy':'monthlyEpochPolicy'](current,at);
  if(BigInt(head.number)<currentPolicy.firstBlock)return wait('epochBoundary');
  let cutoffHead=resolved.admission?await provider.getBlock(resolved.admission.checkpoint.number):head;
  const readinessHead=cutoffHead;
  if(config.cutoffMode==='FINALIZED_CHECKPOINT'){
    if(!state.cutoffs?.[kind]){
      // Do not pay for periodic checkpoints when no finalized attempts need a draw.
      const preliminary=replayAttempts(buyManifest,config.lifecycle,
        (await history(o,buyManifest,cutoffHead.number)).blocks);
      check(preliminary.head.hash===cutoffHead.hash,'Chain changed during readiness scan');
      const pe=isShort?preliminary.shortRules:preliminary.monthlyRules;
      if(BigInt(pe.drainingEpoch||pe.currentEpoch)!==epoch)return wait('finalizedPolicyBoundary');
      if(!draining&&!preliminary.wallets.some(w=>w[kind].byEpoch.some(e=>BigInt(e.epoch)===epoch&&BigInt(e.open)>0n)))return wait('empty');
    }
    const result=await require('./cutoff-checkpoint.cjs').prepareCutoff({provider,source,publisher,kind,state,save,
      finalized:cutoffHead,signal,receiptTimeoutMs:o.receiptTimeoutMs});
    if(result.status!=='ready')return result;
    cutoffHead=result.block;
    if(BigInt(cutoffHead.number)<currentPolicy.firstBlock){
      state.lastCutoffDiscard={kind,...state.cutoffs[kind],reason:'rules boundary advanced before proposal'};
      delete state.cutoffs[kind];save(state);return {status:'progress',action:'discardCutoff'};
    }
    buyManifest=(await resolveBuyPolicy(config,(m,p)=>provider.send(m,p),cutoffHead.number)).manifest;
  }
  const blocks=(await history(o,buyManifest,cutoffHead.number)).blocks;
  const ledger=replayAttempts(buyManifest,config.lifecycle,blocks);
  check(ledger.head.hash===cutoffHead.hash,'Chain changed during scheduler scan');
  const epochs=isShort?ledger.shortRules:ledger.monthlyRules;
  if(BigInt(epochs.drainingEpoch||epochs.currentEpoch)!==epoch)return wait('finalizedPolicyBoundary');
  const open=ledger.wallets.some(w=>w[kind].byEpoch.some(e=>BigInt(e.epoch)===epoch&&BigInt(e.open)>0n));
  if(!open&&!draining){if(state.cutoffs?.[kind]){delete state.cutoffs[kind];save(state);}return wait('empty');}
  const budget=isShort?await shortBudgetAt(config,source,provider,cutoffHead.number):undefined;
  if(isShort&&open&&config.shortBudgetMode==='FREE_SHORT'){
    const funded=value=>BigInt(value)/Array.from(policy.weights).reduce((a,b)=>a+b,0n)>=policy.minimumUnit;
    if(!funded(budget)){
      // Only an unused, finalized checkpoint reaches this branch; saved jobs are
      // handled above. Keep the candidate while funding is still insufficient,
      // avoiding checkpoint transactions on every poll. Latest-only funds do not
      // authorize a refresh and an unresolved checkpoint send is never discarded.
      if(config.cutoffMode==='FINALIZED_CHECKPOINT'&&readinessHead.number>cutoffHead.number){
        const available=await shortBudgetAt(config,source,provider,readinessHead.number);
        if(funded(available)){
          check((await provider.getBlock(readinessHead.number))?.hash===readinessHead.hash,'Funding readiness block changed');
          state.lastCutoffDiscard={kind,...state.cutoffs[kind],reason:'finalized funding now covers basket',fundingBlock:readinessHead.number,fundingBlockHash:readinessHead.hash};
          delete state.cutoffs[kind];save(state);
          return {status:'progress',action:'discardCutoff'};
        }
      }
      return wait('prizeFunding');
    }
  }
  const {identity,drawId,input}=datasetInput(kind,config,buyManifest,policy,epoch,cutoffHead,state.configHash,budget);
  if(isShort&&open)check(BigInt(budget)<=await source.maxBudget(at),'Configured Short budget exceeds controller limit');
  const artifact=(isShort?sd:md).buildFromHistory({...input,blocks});
  const entry=artifact.schema.includes('empty-epoch')?{empty:artifact,input}:
    {job:isShort?sw.makeJob(artifact,ethers.id('scheduler proposal '+identity),config.chunkSize):mw.makeMonthlyJob(artifact,config.chunkSize)};
  state.jobs[kind].push(entry);if(state.cutoffs)delete state.cutoffs[kind];save(state); // Durable artifact precedes all broadcasts.
  return {status:'progress',action:'saveJob',...(entry.job?{drawId}:{epoch:String(epoch)})};
}
async function runScheduler(options,{maxTicks=32,onTick=()=>{}}={}){
  receiptOptions(options.receiptTimeoutMs??30000);
  check(!options.kinds||(Array.isArray(options.kinds)&&options.kinds.length>0&&new Set(options.kinds).size===options.kinds.length&&options.kinds.every(k=>['SHORT','MONTHLY'].includes(k))),'Invalid scheduler kinds');
  check(Number.isInteger(maxTicks)&&maxTicks>0&&maxTicks<=1000,'Invalid tick limit');
  const domain=validateConfig(options.config,options.rpcUrl);
  network.checkChain((await options.provider.getNetwork()).chainId);
  check(options.short.target.toLowerCase()===domain.source&&options.monthly.target.toLowerCase()===domain.monthlySource,'Wrong scheduler controllers');
  await verifyDualBindings(options.provider,domain);await sd.verifyEpochGenesis(options.provider,domain.source,domain);
  return withState(options.statePath,options.config,async(state,save)=>{
    let results;
    for(let i=0;i<maxTicks;i++){
      results={};
      let kinds=options.kinds??['SHORT','MONTHLY'];
      if(options.prioritizeStarted){
        const ranks=[];
        for(const [kind,source] of [['SHORT',options.short],['MONTHLY',options.monthly]]){
          if(!kinds.includes(kind))continue;
          const s=kind==='SHORT',pending=await source[s?'pendingDatasetDraw':'pendingMonth']();
          const active=await source[s?'activeProposal':'activeMonth']();
          ranks.push({kind,rank:pending!==zero?2:active!==zero?1:0});
        }
        kinds=ranks.sort((a,b)=>b.rank-a.rank).map(r=>r.kind);
      }
      for(const kind of kinds){
        try{results[kind]=await tickKind(kind,options,state,save);}
        catch(e){if(e.code==='SCHEDULER_STORAGE_ERROR')throw e;
          if(e.code==='INDEXER_WAIT'){results[kind]=wait(e.reason);continue;}
          if(e.code==='LOCAL_BUDGET_WAIT'&&e.stage==='estimate'){
            results[kind]={status:'waiting',reason:'executionBudget',budget:e.budget};continue;
          }
          results[kind]=e.code==='LOCAL_EXECUTION_STOPPED'?{status:'stopped',code:e.code,stage:e.stage,transactionHash:e.transactionHash}:
          {status:'error',message:e.shortMessage||e.message,code:e.code,stage:e.stage,action:e.action,revertSelector:e.revertSelector,rpcReason:e.rpcReason,transactionHash:e.transactionHash,transientRpc:transientRpc(e),retryableRpcRead:retryableRead(e),...(e.code==='PONS_PUBLIC_ADMISSION'?{admissionReasons:e.admissionReasons}:{})};
          // Unknown send/receipt and unclassified RPC errors stop ALL subsequent kinds/ticks.
          if(!e.definiteRejection&&(e.stage||e.code)){
            await onTick(results);
            return {status:results[kind].status,results,haltedKind:kind,
              requiresReconciliation:['broadcast','confirm'].includes(e.stage)};
          }
        }
        if(results[kind].status==='stopped'){await onTick(results);return {status:'stopped',results};}
      }
      await onTick(results);
      if(options.signal?.aborted)return {status:'stopped',results};
      if(!Object.values(results).some(r=>r.status==='progress'))return {status:Object.values(results).some(r=>r.status==='error')?'error':'waiting',results};
    }
    return {status:'yielded',results};
  });
}
module.exports={runScheduler,validateConfig};
