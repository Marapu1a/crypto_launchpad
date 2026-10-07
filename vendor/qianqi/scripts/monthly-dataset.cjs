const {pagedLogs}=require('./paged-log-read.cjs');
const {ethers}=require('ethers'),{hash,canonical}=require('./direct-buy.cjs'),outcome=require('./short-outcome.cjs');
const {replayAttempts,domainFor,snapshotFor,emptyMonthlyEpochHash}=require('./attempt-lifecycle.cjs');
const monthlyOutcome=require('./monthly-outcome.cjs');
const {validateDrawId}=require('./draw-id.cjs');
const INPUT='tuple(bytes32 drawId,bytes32 snapshotHash,bytes32 root,uint64 campaign,uint64 rulesEpoch,uint256 cutoff,bytes32 cutoffHash,uint256 count,uint256 attempts)';
const coder=ethers.AbiCoder.defaultAbiCoder(),check=(ok,msg)=>{if(!ok)throw Error(msg);};
function rootFor(ps){
  outcome.participantsHash(ps);
  return ps.reduce((root,p)=>ethers.keccak256(coder.encode(['bytes32','address','uint128','uint128'],[root,p.wallet,p.firstAttempt,p.lastAttempt])),ethers.id('MONTHLY_DATASET_V1'));
}
function buildFromHistory(input){
  check(input.lifecycle.schema==='attempt-lifecycle-v4','Monthly epochs require lifecycle v4');
  const ledger=replayAttempts(input.manifest,input.lifecycle,input.blocks),r=input.request,state=ledger.monthlyRules;
  check(!ledger.pending.MONTHLY,'Monthly already pending');validateDrawId(r.drawId,'MONTHLY');
  check(!ledger.draws.some(d=>d.drawId===r.drawId.toLowerCase()),'Draw identity already used');
  check(BigInt(ledger.head.number)===BigInt(r.cutoff)&&ledger.head.hash.toLowerCase()===r.cutoffHash.toLowerCase(),'Replay must end exactly at cutoff');
  const snapshotDomain=domainFor(input.manifest,input.lifecycle,ledger.head.number);
  const target=state.drainingEpoch||state.currentEpoch,policyHash=monthlyOutcome.rulesHash(input.rules);
  check(BigInt(r.rulesEpoch)===BigInt(target),'Wrong monthly target epoch');
  check(policyHash===state.epochs.find(e=>e.epoch===target).rulesHash,'Wrong monthly epoch policy');
  check(ledger.head.number>=state.epochs.find(e=>e.epoch===state.currentEpoch).firstBlock,'Monthly boundary incomplete');
  const participants=ledger.wallets.flatMap(w=>{const e=w.MONTHLY.byEpoch.find(e=>e.epoch===String(target));
    return e&&BigInt(e.open)>0n?[{wallet:w.wallet,count:e.open,firstAttempt:e.firstOpenAttempt,lastAttempt:e.lastOpenAttempt}]:[];});
  const cutoff={blockNumber:ledger.head.number,blockHash:ledger.head.hash};
  if(!participants.length&&state.drainingEpoch)return {schema:'monthly-empty-epoch-artifact-v1',domain:snapshotDomain,epoch:String(target),cutoff,rulesHash:policyHash,
    snapshotHash:emptyMonthlyEpochHash(snapshotDomain,target,cutoff,policyHash)};
  check(participants.length>0,'No OPEN Monthly participants');
  const snapshot=snapshotFor(snapshotDomain,r.drawId,'MONTHLY',cutoff,policyHash,participants,target);
  const request={...r,snapshotHash:hash(snapshot),root:rootFor(participants),count:participants.length,attempts:String(participants.reduce((s,p)=>s+BigInt(p.count),0n))};
  coder.encode([INPUT],[request]);check(BigInt(r.campaign)>0,'Invalid campaign');
  return {schema:'monthly-dataset-artifact-v1',snapshot,request,rules:input.rules};
}
async function verifyPublication(provider,source,artifact,{blockTag='latest'}={}){
  if(!Number.isSafeInteger(Number(blockTag)))blockTag=(await provider.getBlock(blockTag)).number;
  const {snapshot,request:r}=artifact,domain=snapshot.domain;
  check(domain.schema==='attempt-lifecycle-v4'&&snapshot.schema==='attempt-snapshot-v4','Monthly publication requires v4');
  validateDrawId(r.drawId,'MONTHLY');
  check(source.target.toLowerCase()===domain.monthlySource.toLowerCase(),'Monthly source mismatch');
  await require('./dual-bindings.cjs').verifyDualBindings(provider,domain);
  await require('./short-dataset.cjs').verifyEpochGenesis(provider,domain.source,domain);
  const at={blockTag},m=await source.month(r.drawId,at),policy=await source.monthlyEpochPolicy(r.rulesEpoch,at);
  for(const key of Object.keys(r))check(String(m.input[key]).toLowerCase()===String(r[key]).toLowerCase(),'Monthly request mismatch: '+key);
  check(snapshot.kind==='MONTHLY'&&snapshot.drawId===r.drawId&&BigInt(snapshot.rulesEpoch)===BigInt(r.rulesEpoch)
    &&BigInt(snapshot.cutoff.blockNumber)===BigInt(r.cutoff)&&snapshot.cutoff.blockHash===r.cutoffHash,'Monthly snapshot metadata mismatch');
  check(hash(snapshot)===r.snapshotHash&&rootFor(snapshot.participants)===r.root,'Monthly commitment mismatch');
  check(monthlyOutcome.rulesHash(artifact.rules)===policy.hash&&snapshot.rulesHash===policy.hash,'Monthly rules mismatch');
  check(snapshot.participants.every(p=>BigInt(p.count)===BigInt(p.lastAttempt)-BigInt(p.firstAttempt)+1n)
    &&snapshot.participants.reduce((s,p)=>s+BigInt(p.count),0n)===BigInt(r.attempts),'Monthly attempts mismatch');
  const events=await pagedLogs(Number(r.cutoff)+1,Number(blockTag),(from,to)=>source.queryFilter(source.filters.MonthChunk(r.drawId),from,to)),participants=[],publications=[];
  for(const event of events){
    check(event.args.index===BigInt(publications.length),'Monthly publication index mismatch');
    const tx=await provider.getTransaction(event.transactionHash);check(tx&&tx.to?.toLowerCase()===source.target.toLowerCase()&&tx.blockHash===event.blockHash&&tx.blockNumber===event.blockNumber,'Monthly publication unavailable');
    const decoded=source.interface.parseTransaction({data:tx.data});check(decoded?.name==='publishMonth'&&decoded.args[0]===r.drawId,'Unsupported monthly publication transport');
    const chunk=Array.from(decoded.args[1],p=>({wallet:p.wallet.toLowerCase(),firstAttempt:String(p.firstAttempt),lastAttempt:String(p.lastAttempt)}));
    const digest=ethers.keccak256(coder.encode([outcome.PARTICIPANTS],[chunk]));
    check(digest===event.args.hash&&digest===await source.monthChunkHash(r.drawId,event.args.index,at),'Monthly chunk hash mismatch');
    participants.push(...chunk);publications.push({index:String(event.args.index),transactionHash:event.transactionHash,hash:digest,count:chunk.length});
  }
  const expected=snapshot.participants.map(p=>({wallet:p.wallet.toLowerCase(),firstAttempt:String(p.firstAttempt),lastAttempt:String(p.lastAttempt)}));
  check(canonical(participants)===canonical(expected)&&m.count===BigInt(participants.length)&&m.attempts===BigInt(r.attempts)
    &&m.root===rootFor(participants)&&BigInt(publications.length)===await source.monthChunkCount(r.drawId,at),'Monthly dataset mismatch');
  check([2n,3n,4n,5n].includes(m.phase),'Monthly dataset not ready/sealed');
  if(Number(artifact.rules.version)===2)check(m.totalWeight===snapshot.participants.reduce((n,p)=>n+monthlyOutcome.weight(BigInt(p.count)),0n),'Monthly total weight mismatch');
  let context=null;
  if(m.phase!==2n){
    context=ethers.keccak256(coder.encode(['bytes32','uint256','address','bytes32','address','address','address',INPUT,'bytes32','uint256'],
      [ethers.id('MONTHLY_DATASET_CONTEXT_V2'),domain.chainId,source.target,domain.monthlyInstanceId,domain.registry,domain.vault,domain.vaultQuote,r,policy.hash,m.budget]));
    check(context===m.context,'Monthly context mismatch');
  }
  return {drawId:r.drawId,status:m.phase===2n?'READY':'SEALED',context,publications,artifactHash:hash(artifact)};
}
module.exports={buildFromHistory,rootFor,INPUT,verifyPublication};
