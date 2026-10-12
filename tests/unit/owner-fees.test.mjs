import test from 'node:test';
import assert from 'node:assert/strict';
import {repriceOwnerRequest,checkRetryFee} from '../../server/owner-launch/fees.mjs';
import {matchesOwnerTransaction} from '../../server/owner-launch/coordinator.mjs';
const owner='0x0000000000000000000000000000000000000001';
const request={from:owner,to:null,chainId:4663,nonce:30,data:'0x1234',value:'0',gasLimit:'120000',gasPrice:'20'};
const pending={id:'reserved',state:'requesting',request};
const profile={limits:{maxGasPrice:'100',maxGasLimit:'200000'},totalNativeLimit:'10000000'};
function provider(overrides={}){return {getFeeData:async()=>({gasPrice:21n}),getBlock:async()=>({baseFeePerGas:25n}),getTransactionCount:async()=>30,estimateGas:async r=>{assert.equal(r.gasPrice,50n);assert.equal(r.nonce,30);return 110000n;},getBalance:async()=>10000000n,...overrides};}
test('stale fee rejected; repricing changes only fee/limit and accepts original or replacement once',async()=>{
 const p=provider();await assert.rejects(checkRetryFee(p,request),/Комиссия устарела/);
 const updated=await repriceOwnerRequest(p,profile,pending,'0');
 assert.deepEqual(updated,{...request,gasPrice:'50',gasLimit:'132000'});
 assert.equal(pending.request.gasPrice,'20');
 for(const r of [request,updated])assert.ok(matchesOwnerTransaction({...r,gasLimit:BigInt(r.gasLimit)}, {request:updated},owner));
 assert.equal(matchesOwnerTransaction({...updated,nonce:31},{request:updated},owner),false);
 assert.equal(matchesOwnerTransaction({...updated,data:'0xabcd'},{request:updated},owner),false);
});
test('repricing rejects known hash, used nonce and nonce race',async()=>{
 await assert.rejects(repriceOwnerRequest(provider(),profile,{...pending,hash:'known'},'0'),/unresolved/);
 await assert.rejects(repriceOwnerRequest(provider({getTransactionCount:async()=>31}),profile,pending,'0'),/Nonce/);
 let reads=0;await assert.rejects(repriceOwnerRequest(provider({getTransactionCount:async()=>++reads>2?31:30}),profile,pending,'0'),/Nonce/);
});
test('all budgets and insufficient funds fail closed',async()=>{
 await assert.rejects(repriceOwnerRequest(provider(),{...profile,limits:{...profile.limits,maxGasPrice:'40'}},pending,'0'),/Gas price budget/);
 await assert.rejects(repriceOwnerRequest(provider(),{...profile,limits:{...profile.limits,maxGasLimit:'125000'}},pending,'0'),/Gas limit budget/);
 await assert.rejects(repriceOwnerRequest(provider(),profile,pending,'5000000'),/Total native budget/);
 await assert.rejects(repriceOwnerRequest(provider({getBalance:async()=>1n}),profile,pending,'0'),/Insufficient/);
});
