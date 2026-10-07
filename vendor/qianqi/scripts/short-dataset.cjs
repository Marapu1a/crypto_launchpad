const {pagedLogs}=require('./paged-log-read.cjs');
const {ethers}=require('ethers');
const outcome=require('./short-outcome.cjs');
const {replayAttempts,domainFor,snapshotFor,emptyEpochHash}=require('./attempt-lifecycle.cjs');
const {hash,canonical}=require('./direct-buy.cjs');
const coder=ethers.AbiCoder.defaultAbiCoder();
const REQUEST='tuple(bytes32 drawId,uint64 campaignId,uint64 rulesEpoch,uint256 cutoffBlockNumber,bytes32 cutoffBlockHash,bytes32 snapshotHash,bytes32 expectedRoot,uint256 expectedCount,uint256 expectedAttempts,uint256 budget)';
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
function rootFor(participants){
  outcome.participantsHash(participants); // Same canonical address/range validation.
  let root=ethers.id('SHORT_DATASET_V1');
  for(const p of participants)root=ethers.keccak256(coder.encode(['bytes32','address','uint128','uint128'],[root,p.wallet,p.firstAttempt,p.lastAttempt]));
  return root;
}
function rulesHash(rules,weights,minimumUnit){return ethers.keccak256(coder.encode(
  ['bytes32','bytes32','uint256[]','uint256'],[ethers.id('SHORT_DATASET_RULES_V1'),outcome.rulesHash(rules),weights,minimumUnit]));}
function basketFor(budget,weights,minimumUnit){
  coder.encode(['uint256','uint256[]','uint256'],[budget,weights,minimumUnit]);
  const ws=weights.map(BigInt),sum=ws.reduce((a,b)=>a+b,0n);
  check(ws.length>0&&ws.length<=64&&ws.every(w=>w>0n)&&sum<=ethers.MaxUint256&&BigInt(minimumUnit)>0n,'Invalid basket template');
  const unit=BigInt(budget)/sum;check(unit>=BigInt(minimumUnit),'Budget not ready');
  return ws.map(w=>w*unit);
}
function contextFor(binding,request,policyHash,basketHash){return ethers.keccak256(coder.encode(
  ['bytes32','uint256','address','bytes32','address','address','address',REQUEST,'bytes32','bytes32'],
  [ethers.id('SHORT_DATASET_CONTEXT_V1'),binding.chainId,binding.controller,binding.instance,binding.registry,binding.vault,binding.quote,request,policyHash,basketHash]));}
function buildFromHistory(input){
  const ledger=replayAttempts(input.manifest,input.lifecycle,input.blocks);
  check(!ledger.pending.SHORT,'A Short draw is already pending at cutoff');
  const r=input.request;
  check(!ledger.draws.some(d=>d.drawId.toLowerCase()===r.drawId.toLowerCase()),'Draw identity already used');
  check(BigInt(ledger.head.number)===BigInt(r.cutoffBlockNumber)&&ledger.head.hash.toLowerCase()===r.cutoffBlockHash.toLowerCase(),'Replay must end exactly at cutoff');
  const snapshotDomain=domainFor(input.manifest,input.lifecycle,ledger.head.number);
  let participants=ledger.wallets.filter(w=>BigInt(w.SHORT.open)>0n).map(w=>({wallet:w.wallet,
    count:w.SHORT.open,firstAttempt:String(BigInt(w.SHORT.mintedTotal)-BigInt(w.SHORT.open)+1n),lastAttempt:w.SHORT.mintedTotal}));
  const policyHash=rulesHash(input.rules,input.weights,input.minimumUnit);
  if(ledger.shortRules){
    const state=ledger.shortRules,target=state.drainingEpoch||state.currentEpoch;
    check(BigInt(r.rulesEpoch)===BigInt(target),'Wrong target epoch');
    check(policyHash===state.epochs.find(e=>e.epoch===target).rulesHash,'Wrong epoch policy');
    check(ledger.head.number>=state.epochs.find(e=>e.epoch===state.currentEpoch).firstBlock,'Boundary block incomplete');
    participants=ledger.wallets.flatMap(w=>{const e=w.SHORT.byEpoch.find(e=>e.epoch===String(target));
      return e&&BigInt(e.open)>0n?[{wallet:w.wallet,count:e.open,firstAttempt:e.firstOpenAttempt,lastAttempt:e.lastOpenAttempt}]:[];});
  }
  if(participants.length===0&&ledger.shortRules?.drainingEpoch){
    const epoch=ledger.shortRules.drainingEpoch,cutoff={blockNumber:ledger.head.number,blockHash:ledger.head.hash};
    return {schema:'short-empty-epoch-artifact-v1',domain:snapshotDomain,epoch:String(epoch),cutoff,rulesHash:policyHash,
      snapshotHash:emptyEpochHash(snapshotDomain,epoch,cutoff,policyHash)};
  }
  check(participants.length>0,'No OPEN Short participants');
  const snapshot=snapshotFor(snapshotDomain,r.drawId,'SHORT',{blockNumber:ledger.head.number,blockHash:ledger.head.hash},policyHash,participants,r.rulesEpoch);
  const request={...r,snapshotHash:hash(snapshot),expectedRoot:rootFor(participants),expectedCount:participants.length,
    expectedAttempts:String(participants.reduce((sum,p)=>sum+BigInt(p.count),0n))};
  coder.encode([REQUEST],[request]);
  check(request.drawId!==ethers.ZeroHash&&BigInt(request.campaignId)>0n&&BigInt(request.rulesEpoch)>0n,'Invalid identity');
  basketFor(request.budget,input.weights,input.minimumUnit);
  return {schema:'short-dataset-artifact-v1',snapshot,request,rules:input.rules,weights:input.weights,minimumUnit:input.minimumUnit};
}
async function verifyEpochGenesis(provider,address,domain){
  const source=new ethers.Contract(address,[
    'function shortEpochPolicy(uint64) view returns(tuple(tuple(uint32 version,uint32 pNumerator,uint32 pDenominator,uint32 hNumerator,uint32 hDenominator) outcome,uint256[] weights,uint256 minimumUnit,bytes32 hash,uint256 firstBlock))',
    'function shortRulesNotice() view returns(uint256)','function shortRulesStartedAt() view returns(uint256)'],provider);
  const genesis=await source.shortEpochPolicy(1);
  check(hash({rulesHash:genesis.hash,noticeSeconds:String(await source.shortRulesNotice()),
    startedAt:String(await source.shortRulesStartedAt()),firstBlock:String(genesis.firstBlock)})===domain.shortRulesGenesisHash,'Epoch genesis mismatch');
  return source;
}
async function verifyPublication(provider,source,id,artifact,{blockTag='latest'}={}){
  if(!Number.isSafeInteger(Number(blockTag)))blockTag=(await provider.getBlock(blockTag)).number;
  const at={blockTag},p=await source.datasetProposal(id,at),r=artifact.request,domain=artifact.snapshot.domain;
  if(['attempt-lifecycle-v3','attempt-lifecycle-v4'].includes(domain.schema))require('./draw-id.cjs').validateDrawId(r.drawId,'SHORT');
  await require('./dual-bindings.cjs').verifyDualBindings(provider,domain);
  const network=await provider.getNetwork();
  check(BigInt(domain.chainId)===network.chainId&&domain.source.toLowerCase()===source.target.toLowerCase()
    &&domain.sourceCodeHash===ethers.keccak256(await provider.getCode(source.target))
    &&domain.instanceId===await source.datasetInstance()
    &&domain.registry.toLowerCase()===(await source.datasetRegistry()).toLowerCase(),'Deployment domain mismatch');
  for(const key of Object.keys(r))check(String(p.request[key]).toLowerCase()===String(r[key]).toLowerCase(),'Request mismatch: '+key);
  check(hash(artifact.snapshot)===r.snapshotHash&&rootFor(artifact.snapshot.participants)===r.expectedRoot,'Artifact commitment mismatch');
  check(p.rulesHash===rulesHash(artifact.rules,artifact.weights,artifact.minimumUnit),'Rules mismatch');
  const snapshot=artifact.snapshot;
  check(['attempt-snapshot-v1','attempt-snapshot-v2','attempt-snapshot-v3','attempt-snapshot-v4'].includes(snapshot.schema)&&snapshot.kind==='SHORT'&&snapshot.drawId===r.drawId
    &&snapshot.rulesHash===p.rulesHash&&BigInt(snapshot.cutoff.blockNumber)===BigInt(r.cutoffBlockNumber)
    &&snapshot.cutoff.blockHash===r.cutoffBlockHash,'Snapshot metadata mismatch');
  if(snapshot.schema!=='attempt-snapshot-v1'){
    check(BigInt(snapshot.rulesEpoch)===BigInt(r.rulesEpoch),'Snapshot epoch mismatch');
    const epochSource=await verifyEpochGenesis(provider,source.target,domain),target=await epochSource.shortEpochPolicy(r.rulesEpoch);
    check(target.hash===p.rulesHash,'On-chain epoch policy mismatch');
  }
  check(snapshot.participants.every(x=>BigInt(x.count)===BigInt(x.lastAttempt)-BigInt(x.firstAttempt)+1n)
    &&snapshot.participants.reduce((sum,x)=>sum+BigInt(x.count),0n)===BigInt(r.expectedAttempts),'Snapshot attempts mismatch');
  const prizes=Array.from(await source.datasetBasket(id,at));
  const expectedPrizes=basketFor(r.budget,artifact.weights,artifact.minimumUnit);
  check(prizes.length===expectedPrizes.length&&prizes.every((v,i)=>v===expectedPrizes[i]),'Basket mismatch');
  const basketHash=ethers.keccak256(coder.encode(['uint256[]'],[prizes]));
  check(p.basketHash===basketHash,'Basket hash mismatch');
  const events=await pagedLogs(Number(r.cutoffBlockNumber)+1,Number(blockTag),(from,to)=>source.queryFilter(source.filters.DatasetChunk(id),from,to)),participants=[],publications=[];
  for(const event of events){
    check(event.args.index===BigInt(publications.length),'Publication index mismatch');
    const tx=await provider.getTransaction(event.transactionHash);
    check(tx&&tx.to?.toLowerCase()===source.target.toLowerCase()&&tx.blockHash===event.blockHash&&tx.blockNumber===event.blockNumber,'Publication transaction unavailable');
    const decoded=source.interface.parseTransaction({data:tx.data});
    check(decoded?.name==='publish'&&decoded.args[0]===id,'Unsupported publication transport');
    const chunk=Array.from(decoded.args[1],x=>({wallet:x.wallet.toLowerCase(),firstAttempt:String(x.firstAttempt),lastAttempt:String(x.lastAttempt)}));
    const digest=ethers.keccak256(coder.encode([outcome.PARTICIPANTS],[chunk]));
    check(digest===event.args.chunkHash&&digest===await source.datasetChunkHash(id,event.args.index,at)
      &&BigInt(chunk.length)===event.args.count,'Publication hash/count mismatch');
    participants.push(...chunk);publications.push({transactionHash:event.transactionHash,index:String(event.args.index),hash:digest,count:chunk.length});
  }
  const expected=artifact.snapshot.participants.map(({wallet,firstAttempt,lastAttempt})=>({wallet:wallet.toLowerCase(),firstAttempt:String(firstAttempt),lastAttempt:String(lastAttempt)}));
  check(canonical(participants)===canonical(expected),'Published participants differ from replay');
  check(BigInt(publications.length)===await source.datasetChunkCount(id,at)&&p.count===BigInt(expected.length)
    &&p.totalAttempts===BigInt(r.expectedAttempts)&&p.root===rootFor(participants),'Actual dataset mismatch');
  check(p.status===2n||p.status===4n,'Dataset is not READY or SEALED');
  const vault=await source.datasetVault(),quote=await new ethers.Contract(vault,['function quoteToken() view returns(address)'],provider).quoteToken();
  const context=contextFor({chainId:network.chainId,controller:source.target,instance:domain.instanceId,registry:domain.registry,vault,quote},r,p.rulesHash,basketHash);
  if(p.status===4n)check(p.context===context,'Sealed context mismatch');
  return {proposalId:id,status:p.status===4n?'SEALED':'READY',context,publications,artifactHash:hash(artifact)};
}
module.exports={rootFor,rulesHash,contextFor,buildFromHistory,verifyPublication,verifyEpochGenesis,REQUEST};
