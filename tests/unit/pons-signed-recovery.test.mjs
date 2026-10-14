import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Wallet,keccak256,Transaction} from 'ethers';
const {createBoundary,reconcilePending}=createRequire(import.meta.url)('../../server/adapters/qianqi/runtime/scripts/pons-transaction-journal.cjs');
const signer=new Wallet('0x'+'11'.repeat(32));
const request={to:'0x'+'22'.repeat(20),data:'0x1234',value:0,nonce:3,chainId:4663,gasLimit:30000,maxFeePerGas:10,maxPriorityFeePerGas:0,type:2};
test('budget denial after signing retains exact raw transaction; recovery sends only its original hash',async()=>{
 const state={};let saved,raw;
 const save=s=>{saved=structuredClone(s);};
 const provider={broadcastTransaction:async r=>{raw=r;throw Object.assign(Error('budget'),{code:'RPC_BUDGET_EXHAUSTED'});}};
 const boundary=createBoundary({state,save,provider,sender:signer.address,guard:async()=>{},signer:{populateTransaction:async r=>r,signTransaction:r=>signer.signTransaction(r)}});
 await boundary.before(request,'test');await assert.rejects(boundary.broadcast(request),{code:'RPC_BUDGET_EXHAUSTED'});
 assert.equal(saved.pending.transactionHash,keccak256(raw));assert.equal(saved.pending.signedTransaction,raw);
 let sent=0;const hash=keccak256(raw);
 const recovering={getTransactionReceipt:async()=>null,getTransaction:async()=>null,getTransactionCount:async()=>3,broadcastTransaction:async r=>{assert.equal(r,raw);sent++;return {hash};}};
 assert.equal((await reconcilePending(saved,save,recovering,signer.address,{recoverSigned:true})).reason,'pendingReceipt');assert.equal(sent,1);
 recovering.getTransactionCount=async()=>4;assert.equal((await reconcilePending(saved,save,recovering,signer.address,{recoverSigned:true})).reason,'signedNonceConflict');assert.equal(sent,1);
 const tampered=structuredClone(saved);tampered.pending.target=signer.address;await assert.rejects(reconcilePending(tampered,save,recovering,signer.address,{recoverSigned:true}),/Invalid saved/);
 assert.equal(Transaction.from(raw).nonce,3);
});
test('only new durable-raw unsigned intents are recoverable without a hash',async()=>{
 for(const mode of [undefined,'durable-raw-v1']){
  const state={pending:{...(mode?{signingMode:mode}:{})}};let saves=0;
  const result=await reconcilePending(state,()=>saves++,{},signer.address,{recoverSigned:true});
  if(mode){assert.equal(result,null);assert.equal(saves,1);assert.equal(state.pending,undefined);}
  else{assert.equal(result.reason,'unknownHash');assert.equal(saves,0);}
 }
});
