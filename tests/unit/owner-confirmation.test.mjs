import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerFinality,verifyOwnerHistory} from '../../server/owner-launch/confirmation.mjs';
const history=[{hash:'tx',blockNumber:12,blockHash:'block12'}];
const provider={getBlock:async n=>n==='finalized'?{number:10,hash:'block10'}:{number:n,hash:'block'+n},getTransactionReceipt:async()=>({status:1,blockNumber:12,blockHash:'block12'})};
test('canonical receipt permits progress but lagging finality blocks completion',async()=>{
 await verifyOwnerHistory(provider,history);
 assert.deepEqual(await ownerFinality(provider,history),{ready:false,target:12,finalized:10});
 const caughtUp={...provider,getBlock:async n=>n==='finalized'?{number:12,hash:'block12'}:provider.getBlock(n)};
 assert.equal((await ownerFinality(caughtUp,history)).ready,true);
});
test('missing receipt, reverted receipt and replaced block halt the prefix',async()=>{
 for(const receipt of [null,{status:0,blockNumber:12,blockHash:'block12'},{status:1,blockNumber:13,blockHash:'block13'}])await assert.rejects(verifyOwnerHistory({...provider,getTransactionReceipt:async()=>receipt},history),/receipt changed/);
 await assert.rejects(verifyOwnerHistory({...provider,getBlock:async()=>({hash:'other'})},history),/branch changed/);
});
test('missing finality fails closed without discarding successful steps',async()=>{
 const p={...provider,getBlock:async n=>{if(n==='finalized')throw Error('offline');return provider.getBlock(n);}};
 assert.deepEqual(await ownerFinality(p,history),{ready:false,target:12,finalized:null});
});
