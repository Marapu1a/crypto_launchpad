// Receipt reducer. Caller establishes canonical receipt/finality; no discovery RPC here.
import {createRequire} from 'node:module';
import {Interface,ZeroHash} from 'ethers';
import {digest} from '../../../src/tickets/digest.mjs';
import {validateMigration,validateLedger,sealMigration} from './pons-migration.mjs';
const require=createRequire(import.meta.url),{ABI,domainFor}=require('./runtime/scripts/attempt-lifecycle.cjs');
const {hash}=require('./runtime/scripts/direct-buy.cjs');
const vaultABI=new Interface(['event RewardAssigned(bytes32 indexed drawId,address indexed winner,uint256 amount)','event RewardPaid(bytes32 indexed drawId,address indexed asset,address indexed winner,uint256 amount)']);
const check=(v,m)=>{if(!v)throw Error(m);},lower=x=>String(x).toLowerCase();
const json=x=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v));
export function applyControllerReceipt(state,{receipt,block,manifest,lifecycle}){
 validateMigration(state);
 check(digest(domainFor(manifest,lifecycle,state.ledger.head.number))===digest(state.domain),'Controller receipt domain mismatch');
 check(receipt.status===1&&receipt.blockNumber===block.number&&lower(receipt.blockHash)===lower(block.hash)&&Number.isSafeInteger(block.timestamp),'Invalid controller receipt');
 check(/^0x[0-9a-f]{64}$/i.test(receipt.hash)&&Array.isArray(receipt.logs),'Invalid receipt identity');
 const evidence={hash:lower(receipt.hash),blockNumber:block.number,blockHash:lower(block.hash),timestamp:block.timestamp,logs:receipt.logs.map(l=>({address:lower(l.address),topics:l.topics.map(lower),data:lower(l.data),index:l.index}))};
 const key=evidence.hash,commitment=digest(evidence),old=state.controllerReceipts?.[key];
 if(old){check(old.digest===commitment,'Previously applied receipt changed');return structuredClone(state);}
 check(block.number>state.boundary.number,'Receipt precedes migration boundary');
 const s=structuredClone(state);s.controllerReceipts??={};s.controllerTransitions??=[];
 for(const log of receipt.logs){
  const address=lower(log.address),kind=address===s.domain.source?'SHORT':address===s.domain.monthlySource?'MONTHLY':null;
  if(!kind&&address!==s.domain.vault)continue;
  check(!log.removed&&lower(log.transactionHash)===key&&log.blockNumber===block.number&&lower(log.blockHash)===lower(block.hash)&&Number.isSafeInteger(log.index),'Receipt log provenance mismatch');
  const abi=kind?ABI:vaultABI;let event;try{event=abi.parseLog(log);}catch{continue;}if(!event)continue;
  const position=[block.number,receipt.index??0,log.index];
  if(s.lastControllerPosition)check(position.some((n,i)=>n!==s.lastControllerPosition[i]&&position.slice(0,i).every((v,j)=>v===s.lastControllerPosition[j])&&n>s.lastControllerPosition[i]),'Controller events out of order');
  s.lastControllerPosition=position;
  const a=event.args,type=event.name,ref={transactionHash:key,blockNumber:block.number,blockHash:block.hash,logIndex:log.index};
  if(!kind){
   s.controllerRewards??=[];const winner=lower(a.winner),drawId=lower(a.drawId),reward=s.controllerRewards.find(r=>r.drawId===drawId&&r.winner===winner);
   if(type==='RewardAssigned'){
    check(s.ledger.draws.some(d=>d.drawId===drawId),'Reward has no known draw');
    check(!reward&&a.amount>0n,'Duplicate/empty reward');s.controllerRewards.push({drawId,winner,amount:String(a.amount),paid:false,assigned:ref});
   }else{
    check(reward&&!reward.paid&&reward.amount===String(a.amount)&&lower(a.asset)===lower(manifest.quote),'Reward payment mismatch');reward.paid=true;reward.payment=ref;
   }
  }else{
   const r=s.ledger[kind==='SHORT'?'shortRules':'monthlyRules'];
   if(type.startsWith('Short')||type.startsWith('Monthly'))check(type.startsWith(kind==='SHORT'?'Short':'Monthly'),'Wrong epoch controller');
   if(type.endsWith('RulesAnnounced')){
    const notice=Number(lifecycle[kind==='SHORT'?'shortRules':'monthlyRules'].noticeSeconds);
    check(!r.announced&&!r.drainingEpoch&&Number(a.epoch)===r.currentEpoch+1&&Number(a.eligibleAt)===block.timestamp+notice,'Invalid rules announcement');
    r.announced={epoch:Number(a.epoch),rulesHash:lower(a.rulesHash),eligibleAt:Number(a.eligibleAt)};
   }else if(type.endsWith('RulesActivated')){
    const interval=kind==='SHORT'?21600:Number(lifecycle.monthlyPolicy.interval);
    check(r.announced&&!s.ledger.pending[kind]&&Number(a.oldEpoch)===r.currentEpoch&&Number(a.newEpoch)===r.announced.epoch&&Number(a.firstNewBlock)===block.number+1&&block.timestamp>=r.announced.eligibleAt&&block.timestamp>=r.lastTerminalAt+interval,'Invalid epoch activation');
    check(Number(a.firstNewBlock)>s.accounting.head.number,'Missed epoch boundary; replay source admissions first');
    r.drainingEpoch=r.currentEpoch;r.currentEpoch=Number(a.newEpoch);r.epochs.push({epoch:r.currentEpoch,rulesHash:r.announced.rulesHash,firstBlock:Number(a.firstNewBlock)});r.announced=null;
   }else if(type.endsWith('EpochEmpty')){
    const artifact=Object.values(s.artifacts).map(x=>x.artifact).find(x=>x.schema===(kind==='SHORT'?'short':'monthly')+'-empty-epoch-artifact-v1'&&x.snapshotHash===lower(a.snapshotHash));
    check(artifact&&r.drainingEpoch===Number(a.epoch)&&!s.ledger.pending[kind]&&artifact.cutoff.blockNumber===Number(a.cutoffBlockNumber)&&artifact.cutoff.blockHash===lower(a.cutoffBlockHash),'Empty epoch artifact mismatch');
    check(s.ledger.wallets.every(w=>!w[kind].byEpoch.some(e=>Number(e.epoch)===r.drainingEpoch&&BigInt(e.open)>0n)),'Epoch still has tickets');r.drainingEpoch=0;
   }else if(type==='AttemptsFrozen'){
    check(Number(a.kind)===(kind==='SHORT'?0:1),'Wrong freeze kind');const drawId=lower(a.drawId),record=s.artifacts[kind+':'+drawId],snapshot=record?.artifact.snapshot;
    check(snapshot&&!s.ledger.pending[kind]&&!s.ledger.draws.some(d=>d.drawId===drawId),'Unknown/duplicate freeze');
    check(hash(snapshot)===lower(a.snapshotHash)&&snapshot.rulesHash===lower(a.rulesHash)&&snapshot.cutoff.blockNumber===Number(a.cutoffBlockNumber)&&snapshot.cutoff.blockHash===lower(a.cutoffBlockHash),'Frozen artifact differs from receipt');
    check(Number(snapshot.rulesEpoch)===(r.drainingEpoch||r.currentEpoch),'Frozen epoch changed');
    for(const p of snapshot.participants){
     const lane=s.ledger.wallets.find(w=>w.wallet===p.wallet)?.[kind],e=lane?.byEpoch.find(e=>e.epoch===snapshot.rulesEpoch),n=BigInt(p.count);
     check(lane&&e&&Object.keys(lane.frozenByDraw).length===0&&e.firstOpenAttempt===p.firstAttempt&&BigInt(p.firstAttempt)===BigInt(lane.consumedTotal)+1n&&BigInt(p.lastAttempt)-BigInt(p.firstAttempt)+1n===n&&BigInt(e.open)>=n,'Freeze conflicts with open attempts');
     lane.open=String(BigInt(lane.open)-n);lane.frozenByDraw[drawId]={count:p.count,firstAttempt:p.firstAttempt,lastAttempt:p.lastAttempt};
     e.open=String(BigInt(e.open)-n);e.frozen=String(BigInt(e.frozen)+n);e.firstOpenAttempt=BigInt(e.open)?String(BigInt(p.lastAttempt)+1n):null;if(!BigInt(e.open))e.lastOpenAttempt=null;
    }
    s.ledger.pending[kind]=drawId;s.ledger.draws.push({drawId,kind,status:'FROZEN',snapshot:structuredClone(snapshot),snapshotHash:lower(a.snapshotHash),totalAttempts:String(snapshot.participants.reduce((n,p)=>n+BigInt(p.count),0n)),freeze:ref,terminal:null});
   }else if(type==='AttemptsConsumed'){
    const drawId=lower(a.drawId),draw=s.ledger.draws.find(d=>d.drawId===drawId);
    check(Number(a.kind)===(kind==='SHORT'?0:1)&&draw?.kind===kind&&draw.status==='FROZEN'&&s.ledger.pending[kind]===drawId&&draw.snapshotHash===lower(a.snapshotHash)&&[0,1].includes(Number(a.outcome))&&a.resultHash!==ZeroHash,'Terminal does not match frozen draw');
    for(const p of draw.snapshot.participants){
     const lane=s.ledger.wallets.find(w=>w.wallet===p.wallet)[kind],e=lane.byEpoch.find(e=>e.epoch===draw.snapshot.rulesEpoch),n=BigInt(p.count);
     check(lane.frozenByDraw[drawId]?.count===p.count,'Frozen balance mismatch');delete lane.frozenByDraw[drawId];lane.consumedTotal=String(BigInt(lane.consumedTotal)+n);e.consumed=String(BigInt(e.consumed)+n);e.frozen=String(BigInt(e.frozen)-n);
    }
    draw.status='CONSUMED';draw.terminal={outcome:Number(a.outcome)===0?'NO_WINNER':'WINNER',resultHash:lower(a.resultHash),source:ref};s.ledger.pending[kind]=null;r.lastTerminalAt=block.timestamp;
    if(r.drainingEpoch===Number(draw.snapshot.rulesEpoch))r.drainingEpoch=0;
   }
  }
  s.controllerTransitions.push({type,args:json(Array.from(a)),source:ref});
 }
 s.controllerReceipts[key]={digest:commitment,blockNumber:block.number,blockHash:block.hash};validateLedger(s.ledger);return sealMigration(s);
}
