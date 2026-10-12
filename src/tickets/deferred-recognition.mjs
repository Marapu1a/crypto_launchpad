import {recognize} from './recognition.mjs';
import {recognizeDraw,captureBatchContext} from './draw-recognition.mjs';
import {ROUTE_PROFILE,ROUTER} from './draw-router.mjs';
import direct from './direct-curve.cjs';
import {ticketProfile,check,same} from '../worker/production-template.mjs';
import {digest} from './digest.mjs';

export const DEFERRED='deferred-purchases-v1';
export const deferred=p=>p.purchaseAccounting===DEFERRED;
const view=p=>({...p,routes:ROUTE_PROFILE,contracts:{...p.contracts,program:p.contracts.fundingRouter}});
const profile=p=>ticketProfile(view(p));
const basic=(p,row)=>recognize(profile(p),row.transaction,row.receipt);
const isBuy=(p,l)=>same(l.address,p.contracts.curve.address)&&l.topics[0]===direct.EVENTS.getEvent('CurveBuy').topicHash;

// Discovery uses canonical receipts only. It never needs a trace or assigns an
// unverified sender/beneficiary a balance. Original observations stay immutable.
export function discoverPurchases(p,transaction,receipt){
 const ordinary=basic(p,{transaction,receipt});
 return ordinary.map(event=>{
  const log=receipt.logs.find(l=>Number(BigInt(l.logIndex))===event.logIndex&&isBuy(p,l));
  if(!log)return event;
  check(BigInt(receipt.status)===1n,'Failed transaction has BUY logs');
  return {...event,status:'WAITING_RECOGNITION',reason:event.status==='ELIGIBLE'?'AWAITING_CONFIRMATION':'ROUTE_NOT_IDENTIFIED',
   observedSender:transaction.from.toLowerCase(),observedRecipient:direct.EVENTS.parseLog(log).args.recipient.toLowerCase(),
   payer:null,recipient:null,grossQuoteRaw:null,netQuoteDebitRaw:null,refundQuoteRaw:null};
 });
}

// Append reviewed versions here; never replace a verifier already referenced by
// a confirmed bundle. No HTTP/file supplied executable verifier or trusted amount.
const adapters=Object.freeze({
 'direct-curve-opening-v1':Object.freeze({
  matches:(p,row)=>basic(p,row).some(e=>e.status==='ELIGIBLE'),
  collect:async()=>null,
  verify:(p,row)=>basic(p,row),
 }),
 'pons-router-65050-20261012-v1':Object.freeze({
  matches:(_p,row)=>same(row.transaction.to,ROUTER),
  collect:(provider,p,row,block)=>captureBatchContext(provider,view(p),block,row.transaction,row.receipt),
  verify:(p,row,context)=>recognizeDraw(view(p),row.transaction,row.receipt,context),
 }),
 'pons-usdg-self-batch-v1':Object.freeze({
  matches:(_p,row)=>same(row.transaction.to,row.transaction.from),
  collect:(provider,p,row,block)=>captureBatchContext(provider,view(p),block,row.transaction,row.receipt),
  verify:(p,row,context)=>recognizeDraw(view(p),row.transaction,row.receipt,context),
 }),
});
export const adapterIds=Object.freeze(Object.keys(adapters));
export function validateAdapters(ids){check(Array.isArray(ids)&&new Set(ids).size===ids.length&&ids.every(id=>adapterIds.includes(id)),'Unreviewed adapter selection');return ids;}

export function verifyDeferredProof(p,ledger,id,proof){
 check(deferred(p)&&proof&&Object.keys(proof).every(k=>['candidateId','adapter','context'].includes(k))&&proof.candidateId===id,'Invalid deferred proof');
 const adapter=adapters[proof.adapter];check(adapter,'Unknown recognition adapter');
 const original=ledger.events.find(e=>e.candidateId===id),row=ledger.evidence[original?.transactionHash];
 check(original?.status==='WAITING_RECOGNITION'&&row&&same(row.receipt.blockHash,original.blockHash),'Missing original observation');
 const observed=discoverPurchases(p,row.transaction,row.receipt).find(e=>e.candidateId===id);
 check(observed&&digest(observed)===digest(original),'Original observation changed');
 if(proof.context){
  check(row.block&&same(proof.context.hash,row.block.hash)&&same(proof.context.parentHash,row.block.parentHash)&&Number(proof.context.timestamp)===Number(BigInt(row.block.timestamp)),'Proof block mismatch');
 }
 check(adapter.matches(p,row),'Adapter does not match purchase');
 const result=adapter.verify(p,row,proof.context),event=result.find(e=>e.candidateId===id);
 check(result.length===1&&event?.status==='ELIGIBLE'&&BigInt(event.netQuoteDebitRaw)>0n,'Unverified deferred purchase');
 return event;
}

export function deferredBundle(p,ledger,ids){
 const candidates=[...ids].sort(),proofs=candidates.map(id=>{
  const proof=ledger.recognitionQueue?.proofs?.[id];verifyDeferredProof(p,ledger,id,proof);return structuredClone(proof);
 });
 return {schema:'draw-recognition-v2',policyHash:digest(p),candidates,proofs};
}

// Bounded round-robin retry, independently of the discovery cursor. Failed or
// unknown candidates don't block later candidates, funds, or already due draws.
export async function prepareDeferredRecognition({provider,policy:p,ledger,creditedIds,now=Date.now(),limit=16,traceLimit=1,enabledAdapters=adapterIds}){
 check(deferred(p)&&Number.isSafeInteger(limit)&&limit>0&&limit<=50&&Number.isSafeInteger(traceLimit)&&traceLimit>=0&&traceLimit<=2,'Invalid recognition preparation');
 validateAdapters(enabledAdapters);const revision=digest(enabledAdapters);
 const q=ledger.recognitionQueue??={cursor:0,attempts:{},proofs:{}};
 const waiting=ledger.events.filter(e=>e.status==='WAITING_RECOGNITION'&&!creditedIds.has(e.candidateId));
 if(!waiting.length)return [];
 let traces=0;
 for(let n=0;n<Math.min(limit,waiting.length);n++){
  const event=waiting[q.cursor%waiting.length];q.cursor=(q.cursor+1)%waiting.length;
  const id=event.candidateId;if(q.proofs[id]){verifyDeferredProof(p,ledger,id,q.proofs[id]);continue;}
  const previous=q.attempts[id];if(previous?.revision===revision&&previous.nextAttemptAt>now)continue;
  const row=ledger.evidence[event.transactionHash];check(row,'Missing queued evidence');
  const matches=enabledAdapters.filter(k=>adapters[k].matches(p,row)),adapterIndex=(previous?.nextAdapter??0)%Math.max(1,matches.length),adapterId=matches[adapterIndex];
  const record=reason=>{q.attempts[id]={reason,revision,attempts:(previous?.attempts??0)+1,nextAdapter:adapterIndex+1,nextAttemptAt:now+60000};};
  if(!adapterId){record('route-not-identified');continue;}
  if(adapterId!=='direct-curve-opening-v1'&&traces>=traceLimit)continue;
  if(adapterId!=='direct-curve-opening-v1')traces++;
  let block,context;
  try{
   block=await provider.send('eth_getBlockByNumber',['0x'+BigInt(event.blockNumber).toString(16),true]);
   if(!block)throw Error('Unavailable');
  }catch{record('evidence-unavailable');continue;}
  check(same(block.hash,event.blockHash)&&same(block.parentHash,row.block.parentHash)&&same(block.transactions[Number(BigInt(row.transaction.transactionIndex))]?.hash,event.transactionHash),'Queued purchase branch changed');
  try{context=await adapters[adapterId].collect(provider,p,row,block);}
  catch{record('evidence-unavailable');continue;}
  const proof={candidateId:id,adapter:adapterId,context:context??null};
  try{verifyDeferredProof(p,ledger,id,proof);}catch{record('route-not-verified');continue;}
  q.proofs[id]=proof;record('awaiting-confirmation');
 }
 const ready=[];let bytes=0;
 for(const e of waiting){const proof=q.proofs[e.candidateId];if(!proof||!enabledAdapters.includes(proof.adapter))continue;
  const size=JSON.stringify(proof).length*3;
  if(size>1000000)continue; // Evidence stays queued for a separately reviewed size policy.
  if(ready.length>=50||bytes+size>1000000)break;bytes+=size;ready.push(e.candidateId);
 }
 return ready;
}

export function pendingPurchases(ledger,creditedIds){
 return ledger.events.filter(e=>e.status==='WAITING_RECOGNITION'&&!creditedIds.has(e.candidateId)).map(e=>({
  candidateId:e.candidateId,transactionHash:e.transactionHash,blockNumber:e.blockNumber,
  observedSender:e.observedSender,observedRecipient:e.observedRecipient,
  status:ledger.recognitionQueue?.proofs?.[e.candidateId]?'awaiting-confirmation':ledger.recognitionQueue?.attempts?.[e.candidateId]?.reason??'awaiting-recognition',
 }));
}
