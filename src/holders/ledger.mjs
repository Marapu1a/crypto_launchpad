import {address,check,hash,identity,key,scope,uint} from './values.mjs';
import {verifyAcceptedSnapshot} from './snapshot.mjs';

// Pure, replayable fixture journal. No signer, RPC, database or production adapter.
export function createHolderBook(input){return {schema:'holder-book-fixture-v1',scope:scope(input),events:[]};}
export const holderScopeId=book=>identity(scope(book.scope));
const positive=value=>{const n=uint(value);check(n>0n,'Amount must be positive');return n;};
function policy(input){
 check(input?.weight==='snapshot-balance','Explicit snapshot-balance weight required');
 positive(input.minimumPayment);uint(input.minimumHolding);
 check(Array.isArray(input.exclusions),'Explicit exclusions required');
 const exclusions=input.exclusions.map(address);check(new Set(exclusions).size===exclusions.length,'Duplicate exclusion');
 return {weight:input.weight,minimumPayment:input.minimumPayment,minimumHolding:input.minimumHolding,exclusions:exclusions.sort()};
}

export function replayHolderBook(book){
 check(book?.schema==='holder-book-fixture-v1'&&Array.isArray(book.events),'Invalid holder journal');
 const instance=scope(book.scope),scopeId=identity(instance),events=new Map(),credits=new Set(),periods=new Set(),rounds=new Map(),accounts=new Map(),payouts=new Map(),transactions=new Set();
 let received=0n,available=0n,paid=0n,latestRound=null;
 const account=wallet=>{if(!accounts.has(wallet))accounts.set(wallet,{earned:0n,paid:0n,reserved:0n});return accounts.get(wallet);};
 for(const e of book.events){
  key(e.id);check(e.scopeId===scopeId,'Cross-project or asset event');
  const fingerprint=identity(e);
  if(events.has(e.id)){check(events.get(e.id)===fingerprint,'Conflicting event replay');continue;}
  events.set(e.id,fingerprint);
  if(e.type==='credit'){
   key(e.receiptId);check(!credits.has(e.receiptId),'Receipt already credited');
   const amount=positive(e.amount);credits.add(e.receiptId);received+=amount;uint(String(received));available+=amount;
  }else if(e.type==='round'){
   key(e.roundId);key(e.periodId);check(!rounds.has(e.roundId)&&!periods.has(e.periodId),'Round or period already allocated');
   const snapshot=verifyAcceptedSnapshot(e.accepted),rules=policy(e.policy),budget=positive(e.budget);
   check(snapshot.token===instance.token&&snapshot.chainId===instance.chainId,'Wrong snapshot token or chain');check(budget<=available,'Insufficient unreserved holder funds');
   const excluded=new Set(rules.exclusions),holders=snapshot.holders.filter(h=>!excluded.has(h.wallet)&&uint(h.balance)>=uint(rules.minimumHolding));
   const weight=holders.reduce((n,h)=>n+uint(h.balance),0n);check(weight>0n,'No eligible holders');
   let allocated=0n;const allocations=[];
   for(const h of holders){const amount=budget*uint(h.balance)/weight;account(h.wallet).earned+=amount;allocated+=amount;allocations.push({wallet:h.wallet,amount:String(amount)});}
   available-=allocated;periods.add(e.periodId);latestRound=e.roundId;
   rounds.set(e.roundId,{periodId:e.periodId,snapshotId:snapshot.id,policy:rules,budget:String(budget),allocated:String(allocated),remainder:String(budget-allocated),allocations});
  }else if(e.type==='payout.prepare'){
   key(e.payoutId);check(!payouts.has(e.payoutId),'Payout already exists');
   const round=rounds.get(e.roundId);check(round&&latestRound===e.roundId,'Use latest accepted payout policy');
   const wallet=address(e.wallet),a=account(wallet),amount=positive(e.amount);
   check(amount>=uint(round.policy.minimumPayment),'Below minimum payment: carry forward');
   check(amount<=a.earned-a.paid-a.reserved,'Insufficient unreserved entitlement');
   a.reserved+=amount;payouts.set(e.payoutId,{wallet,amount:String(amount),roundId:e.roundId,status:'prepared',txHash:null});
  }else if(e.type==='payout.submit'){
   const p=payouts.get(e.payoutId);check(p?.status==='prepared','Payout is not prepared');
   const txHash=hash(e.txHash);check(!transactions.has(txHash),'Transaction already used');
   transactions.add(txHash);p.txHash=txHash;p.status='submitted';
  }else if(e.type==='payout.unknown'){
   const p=payouts.get(e.payoutId);check(p&&['submitted','unknown'].includes(p.status),'No submitted payout to reconcile');p.status='unknown';
  }else if(e.type==='payout.cancel'){
   const p=payouts.get(e.payoutId);check(p?.status==='prepared','Only unsubmitted payout can be cancelled');
   check(typeof e.reason==='string'&&e.reason.trim(),'Cancellation reason required');
   account(p.wallet).reserved-=uint(p.amount);p.status='cancelled';
  }else if(e.type==='payout.resolve'){
   const p=payouts.get(e.payoutId);check(p&&['submitted','unknown'].includes(p.status),'Payout does not need reconciliation');
   const proof=e.evidence;
   check(proof?.mode==='fixture-only'&&proof.finalized===true&&typeof proof.success==='boolean','Finalized fixture evidence required');
   check(hash(proof.txHash)===p.txHash&&proof.chainId===instance.chainId&&address(proof.asset)===instance.asset&&address(proof.wallet)===p.wallet&&proof.amount===p.amount,'Payout evidence mismatch');
   const a=account(p.wallet),amount=uint(p.amount);a.reserved-=amount;
   if(proof.success){a.paid+=amount;paid+=amount;p.status='confirmed';}else p.status='failed';
  }else throw Error('Unknown holder event');
 }
 let owed=0n,reserved=0n;
 const balances=Object.fromEntries([...accounts].sort(([a],[b])=>a.localeCompare(b)).map(([wallet,a])=>{
  const due=a.earned-a.paid;check(due>=a.reserved&&a.reserved>=0n,'Invalid wallet liabilities');owed+=due;reserved+=a.reserved;
  return [wallet,{earned:String(a.earned),paid:String(a.paid),owed:String(due),reserved:String(a.reserved),unreserved:String(due-a.reserved)}];
 }));
 check(available>=0n&&received===available+owed+paid,'Holder fund conservation failed');
 return {scope:instance,scopeId,received:String(received),available:String(available),owed:String(owed),reserved:String(reserved),paid:String(paid),accounts:balances,rounds:Object.fromEntries(rounds),payouts:Object.fromEntries(payouts)};
}

export function applyHolderEvent(previous,event){
 replayHolderBook(previous); // Never trust a cached balance supplied by the caller.
 const existing=previous.events.find(e=>e.id===event.id);
 if(existing){check(identity(existing)===identity(event),'Conflicting event replay');return structuredClone(previous);}
 const next=structuredClone(previous);next.events.push(structuredClone(event));replayHolderBook(next);return next;
}
