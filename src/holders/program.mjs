import {address,check,hash,identity,key,scope,uint} from './values.mjs';
import {validateHolderSnapshot} from './snapshot.mjs';
import {createHolderBook,applyHolderEvent,holderScopeId,replayHolderBook} from './ledger.mjs';
import {validateFundingPolicy,validateFundingObservation} from './funding-receipt.mjs';
import {validateSnapshotPolicy,validateSnapshotAdmission} from './admission.mjs';

export const HOLDER_PERIOD_SECONDS=30*24*60*60;
const stamp=n=>check(Number.isSafeInteger(n)&&n>0,'Explicit Unix seconds required');
// Accounting rehearsal only: neither API observations nor these events authorize payments.
export function createHolderProgram({scope:input,launchAt,minimumPayment,exclusions,preset,fundingPolicy,snapshotPolicy,schedulePolicy}){
 const instance=scope(input);stamp(launchAt);
 check(schedulePolicy===undefined||schedulePolicy==='first-accepted-carry-v1','Unsupported holder schedule');
 check(preset==='pw-v1-60-20-20','Explicit supported holder preset required');
 check(minimumPayment===null||uint(minimumPayment)>0n,'Invalid minimum payment');
 check(Array.isArray(exclusions),'Explicit exclusions required');
 const excluded=exclusions.map(address).sort();check(new Set(excluded).size===excluded.length,'Duplicate exclusion');
 return {schema:'holder-program-rehearsal-v1',preset,scope:instance,launchAt,minimumPayment,exclusions:excluded,...(schedulePolicy?{schedulePolicy}:{}),
  ...(fundingPolicy?{fundingPolicy:validateFundingPolicy(fundingPolicy,instance)}:{}),
  ...(snapshotPolicy?{snapshotPolicy:validateSnapshotPolicy(snapshotPolicy,instance)}:{}),events:[]};
}
export function replayHolderProgram(program){
 check(program?.schema==='holder-program-rehearsal-v1'&&Array.isArray(program.events),'Invalid holder program');
 const initial=createHolderProgram(program);
 check(identity({...program,events:[]})===identity(initial),'Noncanonical holder configuration');
 let book=createHolderBook(program.scope),received=0n,delivered=0n,lastPeriod=0,lastCalendarPeriod=0,observedAllocated=0n;
 const receipts=new Set(),events=new Map(),candidates=new Map(),admissions=new Map();
 for(const e of program.events){
  key(e.id);check(e.scopeId===holderScopeId(book),'Wrong holder scope');
  if(events.has(e.id)){check(events.get(e.id)===identity(e),'Conflicting holder event');continue;}
  events.set(e.id,identity(e));
  if(e.type==='fee.received'||e.type==='holder.deposited'){
   if(program.fundingPolicy)validateFundingObservation(e,program.fundingPolicy,program.scope);
   else check(e.evidence?.mode==='fixture-only'&&e.evidence.finalized===true,'Only finalized fixture receipts supported');
   check(identity(scope(e.evidence.scope))===identity(program.scope),'Receipt scope mismatch');
   key(e.evidence.receiptId);check(!receipts.has(e.evidence.receiptId),'Receipt already consumed');
   const amount=uint(e.amount);check(amount>0n&&e.evidence.amount===e.amount,'Receipt amount mismatch');
   receipts.add(e.evidence.receiptId);
   if(e.type==='fee.received'){
    received+=amount;uint(String(received));
    if(program.fundingPolicy)check(e.evidence.totalReceived===String(received),'Missing or out-of-order revenue receipt');
   }
   else{
    delivered+=amount;check(delivered<=received*6000n/10000n,'Deposit exceeds holder allocation');
    if(program.fundingPolicy)check(e.evidence.totalReceived===String(delivered),'Missing or out-of-order holder deposit');
    book=applyHolderEvent(book,{id:e.id,scopeId:e.scopeId,type:'credit',receiptId:e.evidence.receiptId,amount:e.amount});
   }
  }else if(e.type==='snapshot.observed'){
   const candidate=validateHolderSnapshot(e.candidate);
   check(candidate.chainId===program.scope.chainId&&candidate.token===program.scope.token,'Snapshot scope mismatch');
   candidates.set(candidate.id,candidate);
  }else if(e.type==='snapshot.admitted'){
   check(program.snapshotPolicy,'Snapshot policy required');
   const proof=e.proof,candidate=candidates.get(proof?.candidateId);check(candidate,'Persist candidate before admission');
   validateSnapshotAdmission(proof,candidate,program.snapshotPolicy,program.scope);
   check(proof.period===lastPeriod+1&&!admissions.has(proof.period),'Holder period already admitted or out of order');
   const calendar=(proof.dueAt-program.launchAt)/HOLDER_PERIOD_SECONDS;
   check(proof.until===proof.dueAt+HOLDER_PERIOD_SECONDS&&Number.isSafeInteger(calendar)&&calendar>lastCalendarPeriod,'Snapshot admission schedule mismatch');
   if(program.schedulePolicy!=='first-accepted-carry-v1')check(calendar===proof.period,'Snapshot admission schedule mismatch');
   admissions.set(proof.period,proof);
  }else if(e.type==='round.finalized'){
   check(program.fundingPolicy&&program.snapshotPolicy,'Observed holder profiles required');
   check(Number.isSafeInteger(e.period)&&e.period===lastPeriod+1,'Expected next finalized period');
   const proof=admissions.get(e.period);check(proof&&e.snapshot==='0x'+identity(proof),'Finalized round admission mismatch');
   const allocated=uint(e.allocated),budget=uint(e.budget);
   check(allocated<=budget&&budget<=delivered-observedAllocated,'Finalized allocation exceeds delivered funds');
   check(e.observation?.status==='succeeded'&&e.observation.allocated===e.allocated,'Finalized seal evidence required');
   hash(e.observation.txHash);hash(e.observation.block?.hash);
   check(Number.isSafeInteger(e.observation.block.number)&&e.observation.block.number>=proof.block.number,'Invalid finalized seal block');
   observedAllocated+=allocated;lastPeriod=e.period;lastCalendarPeriod=(proof.dueAt-program.launchAt)/HOLDER_PERIOD_SECONDS;
  }else if(e.type==='round.fixture'){
   check(!program.snapshotPolicy,'Fixture rounds forbidden for snapshot admission profiles');
   check(!program.fundingPolicy,'Fixture rounds forbidden for observed funding');
   check(Number.isSafeInteger(e.period)&&e.period===lastPeriod+1,'Expected next holder period');
   stamp(e.now);const end=program.launchAt+e.period*HOLDER_PERIOD_SECONDS;stamp(end+HOLDER_PERIOD_SECONDS);
   check(e.now>=end,'Holder period is not due');
   check(program.minimumPayment!==null,'ETH minimum payment not approved');
   const candidate=candidates.get(e.accepted?.snapshot?.id);check(candidate,'Persist snapshot before allocation');
   // A late observation must not be reused for missed historical periods.
   check(candidate.observedAt>=end&&candidate.observedAt<end+HOLDER_PERIOD_SECONDS&&candidate.observedAt<=e.now,'Snapshot outside period observation window');
   book=applyHolderEvent(book,{id:e.id,scopeId:e.scopeId,type:'round',roundId:'holder-'+e.period,periodId:'launch-period-'+e.period,
    budget:e.budget,accepted:e.accepted,policy:{weight:'snapshot-balance',minimumHolding:'0',minimumPayment:program.minimumPayment,exclusions:program.exclusions}});
   lastPeriod=e.period;lastCalendarPeriod=e.period;
  }else throw Error('Unsupported holder program event');
 }
 const holders=received*6000n/10000n,draw=received*2000n/10000n,project=received*2000n/10000n;
 const ledger=replayHolderBook(book);
 return {scope:program.scope,executionEnabled:false,lastPeriod,lastCalendarPeriod,nextDueAt:program.launchAt+(lastCalendarPeriod+1)*HOLDER_PERIOD_SECONDS,
  fees:{received:String(received),holders:String(holders),draw:String(draw),project:String(project),roundingReserve:String(received-holders-draw-project),holderDelivered:String(delivered),holderUndelivered:String(holders-delivered)},
  ledger,ledgerAuthority:program.fundingPolicy?'funding-and-fixtures-only':'fixture-only',
  observedAllocated:String(observedAllocated),availableForAllocation:program.fundingPolicy?String(delivered-observedAllocated):ledger.available,
  candidates:[...candidates.values()],admissions:Object.fromEntries(admissions)};
}
export function applyHolderProgramEvent(previous,event){
 replayHolderProgram(previous);const old=previous.events.find(e=>e.id===event.id);
 if(old){check(identity(old)===identity(event),'Conflicting holder event');return structuredClone(previous);}
 const next=structuredClone(previous);next.events.push(structuredClone(event));replayHolderProgram(next);return next;
}
export function previewHolderProgram(program,{now,candidateId=null}){
 stamp(now);const state=replayHolderProgram(program),admission=state.admissions[state.lastPeriod+1];
 const candidate=state.candidates.find(c=>c.id===(candidateId??admission?.candidateId));
 const window=holderObservationWindow(program,state,now);
 const blockers=['financial-execution-not-connected'];
 if(program.fundingPolicy)blockers.push('funding-reconciliation-required');
 if(now<state.nextDueAt)blockers.push('period-not-due');
 if(program.minimumPayment===null)blockers.push('minimum-payment-not-approved');
 if(!candidate)blockers.push('snapshot-missing');
 else{
  if(admission?.candidateId!==candidate.id){
   blockers.push('snapshot-atomicity-unverified');
   if(candidate.observedAt<window.dueAt||candidate.observedAt>=window.until||candidate.observedAt>now)blockers.push('snapshot-outside-period-window');
  }else if(program.schedulePolicy!=='first-accepted-carry-v1'&&now>=admission.until)blockers.push('holder-period-missed');
 }
 if(state.availableForAllocation==='0')blockers.push('no-delivered-holder-funds');
 const excluded=new Set(program.exclusions),eligible=(candidate?.holders??[]).filter(h=>!excluded.has(h.wallet));
 const weight=eligible.reduce((sum,h)=>sum+uint(h.balance),0n),budget=uint(state.availableForAllocation);
 if(candidate&&weight===0n)blockers.push('no-eligible-holders');
 const estimates=eligible.map(h=>{
  const amount=weight?budget*uint(h.balance)/weight:0n,prior=uint(state.ledger.accounts[h.wallet]?.owed??'0');
  return {wallet:h.wallet,balance:h.balance,newEntitlement:String(amount),existingDebt:program.fundingPolicy?null:String(prior),totalDebt:program.fundingPolicy?null:String(prior+amount)};
 });
 return {...state,candidates:undefined,candidate:candidate?{id:candidate.id,observedAt:candidate.observedAt,atomicity:candidate.atomicity}:null,
  period:state.lastPeriod+1,calendarPeriod:admission?(admission.dueAt-program.launchAt)/HOLDER_PERIOD_SECONDS:window.calendarPeriod,skippedCalendarPeriods:admission?(admission.dueAt-state.nextDueAt)/HOLDER_PERIOD_SECONDS:window.skippedCalendarPeriods,acceptedSnapshotAt:admission?.block.timestamp??null,blockers,eligibleCount:eligible.length,estimates,
  estimatedRemainder:String(budget-estimates.reduce((sum,h)=>sum+uint(h.newEntitlement),0n))};
}

// Round number is contiguous for on-chain debts; calendar windows may be skipped.
export function holderObservationWindow(program,state,now){
 stamp(now);
 const calendarPeriod=program.schedulePolicy==='first-accepted-carry-v1'?Math.max(state.lastCalendarPeriod+1,Math.floor((now-program.launchAt)/HOLDER_PERIOD_SECONDS)):state.lastPeriod+1;
 const dueAt=program.launchAt+calendarPeriod*HOLDER_PERIOD_SECONDS;
 return {calendarPeriod,dueAt,until:dueAt+HOLDER_PERIOD_SECONDS,skippedCalendarPeriods:calendarPeriod-state.lastCalendarPeriod-1};
}
