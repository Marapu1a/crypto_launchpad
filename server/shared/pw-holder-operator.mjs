import {Transaction} from 'ethers';
import {check,uint} from '../../src/holders/values.mjs';
import {checkpointExecution,executionCall,validateSignedExecution} from '../../src/holders/execution.mjs';
import {readHolderExecution,recordHolderTransaction,resolveHolderTransaction,resumeHolderReconciliation} from './holder-execution.mjs';

// On-demand operator. No polling, private keys, eager dust consolidation or
// implicit signing. Broadcast accepts only bytes already reserved in the DB.
export function createPwHolderOperator({pool,provider,scope,allowPublicTransactions=false}){
 check(typeof allowPublicTransactions==='boolean','Explicit holder send switch required');
 const read=()=>readHolderExecution(pool,scope);
 const gate=policy=>check(policy.schema!=='holder-execution-production-v1'||allowPublicTransactions,'Public holder sending is disabled');
 return {
  read,
  reconcile:options=>resumeHolderReconciliation(pool,scope,{...options,provider}),
  async quote(period,operation){
   const state=await read(),{policy}=state;check(!state.transactions.some(t=>t.status==='unknown'),'Resolve pending holder transaction');
   const plan=state.plans.find(p=>p.period===period);check(plan,'Unknown holder period');
   const {block,authority}=await checkpointExecution(provider,policy,scope);
   const nonce=await provider.getTransactionCount(authority.publisher,block.number);
   check(nonce===await provider.getTransactionCount(authority.publisher,'latest')&&nonce===await provider.getTransactionCount(authority.publisher,'pending'),'Publisher nonce not finalized');
   const fee=await provider.getFeeData(),maxFeePerGas=fee.maxFeePerGas??fee.gasPrice,maxPriorityFeePerGas=fee.maxPriorityFeePerGas??0n;
   check(maxFeePerGas>0n&&maxFeePerGas<=uint(policy.maxFeePerGas)&&maxPriorityFeePerGas<=maxFeePerGas,'Holder fee exceeds budget');
   const request={from:authority.publisher,to:policy.vault,chainId:scope.chainId,nonce,type:2,value:0n,data:executionCall(plan,operation),maxFeePerGas,maxPriorityFeePerGas};
   const estimate=await provider.estimateGas(request),gasLimit=(estimate*120n+99n)/100n;
   check(gasLimit<=uint(policy.maxGasLimit),'Holder gas exceeds budget');
   const maximumCost=gasLimit*maxFeePerGas;
   check(await provider.getBalance(authority.publisher)>=maximumCost+uint(policy.nativeFloor??'0'),'Publisher gas reserve insufficient');
   return JSON.parse(JSON.stringify({period,operation,request:{...request,gasLimit},estimatedGas:estimate,maximumNativeCost:maximumCost,authorizationToSend:false},(_,v)=>typeof v==='bigint'?String(v):v));
  },
  async record({period,operation,raw}){const {policy}=await read();gate(policy);return recordHolderTransaction(pool,scope,{provider,period,operation,raw});},
  async resolve(txHash){return resolveHolderTransaction(pool,scope,{provider,txHash});},
  async broadcast(txHash){
   const state=await read(),{policy}=state;gate(policy);
   const stored=state.transactions.find(t=>t.body.txHash===txHash);check(stored,'No reserved holder transaction');
   if(stored.status!=='unknown'){await resolveHolderTransaction(pool,scope,{provider,txHash});return {hash:txHash,replayed:true};}
   const body=stored.body,plan=state.plans.find(p=>p.period===body.period);
   validateSignedExecution(body.raw,policy,scope,plan,body.operation,body.sender);
   await checkpointExecution(provider,policy,scope);
   if(await provider.getTransaction(txHash))return {hash:txHash,replayed:true};
   const tx=Transaction.from(body.raw);
   check(await provider.getTransactionCount(body.sender,'latest')===tx.nonce&&await provider.getTransactionCount(body.sender,'pending')===tx.nonce,'Publisher nonce changed; resolve first');
   check(await provider.getBalance(body.sender)>=tx.gasLimit*tx.maxFeePerGas+uint(policy.nativeFloor??'0'),'Publisher gas reserve insufficient');
   const sent=await provider.broadcastTransaction(body.raw);check(sent.hash===txHash,'Holder broadcast hash mismatch');return {hash:txHash,replayed:false};
  }
 };
}
