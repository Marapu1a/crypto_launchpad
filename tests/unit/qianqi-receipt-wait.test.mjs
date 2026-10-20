import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingFinality} from '../../server/adapters/qianqi/pons-receipt-wait.mjs';

const transactionHash='0x'+'a'.repeat(64);
function fixture(){
 const calls=[];
 const state={migration:{controllerReceipts:{}},lastResolved:{status:1,transactionHash,blockNumber:100}};
 const provider={getNetwork:async()=>{calls.push('chain');return {chainId:4663n};},
  getBlock:async tag=>{calls.push(tag);return {number:99};}};
 return {state,provider,calls};
}
test('unfinalized saved receipt needs only chain and finalized head; state is unchanged',async()=>{
 const f=fixture(),before=structuredClone(f.state);
 const r=await pendingFinality({...f,now:1000});
 assert.equal(r.reason,'receiptFinality');assert.equal(r.retryAt,61000);
 assert.deepEqual(r.waitingFor,{transactionHash,blockNumber:100});
 assert.deepEqual(f.calls,['chain','finalized']);assert.deepEqual(f.state,before);
});
test('finality permits normal canonical receipt verification, never marks the receipt accounted',async()=>{
 const f=fixture();f.provider.getBlock=async()=>({number:100});
 assert.equal(await pendingFinality(f),null);assert.deepEqual(f.state.migration.controllerReceipts,{});
});
test('pending broadcast, already applied receipt and reverted receipt stay in normal recovery',async()=>{
 for(const change of [s=>s.pending={},s=>s.lastResolved.status=0,s=>s.migration.controllerReceipts[transactionHash]={},s=>delete s.lastResolved]){
  const f=fixture();change(f.state);assert.equal(await pendingFinality(f),null);assert.deepEqual(f.calls,[]);
 }
});
test('wrong chain, missing finality, invalid journal and RPC cap are not idle evidence',async()=>{
 const f=fixture();f.provider.getNetwork=async()=>({chainId:1n});await assert.rejects(pendingFinality(f),/Wrong/);
 const g=fixture();g.provider.getBlock=async()=>null;await assert.rejects(pendingFinality(g),/Missing/);
 const h=fixture();h.state.lastResolved.blockNumber=-1;await assert.rejects(pendingFinality(h),/Invalid/);
 const i=fixture();i.provider.getBlock=async()=>{throw Object.assign(Error('cap'),{code:'RPC_BUDGET_EXHAUSTED',retryAt:9000});};
 await assert.rejects(pendingFinality(i),{code:'RPC_BUDGET_EXHAUSTED',retryAt:9000});
});
