import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, Transaction, id } from 'ethers';
import { advanceTransaction } from '../../src/worker/journal.mjs';

function fixture() {
  const signer=Wallet.createRandom(),state={history:[]},request={to:Wallet.createRandom().address,data:'0x',value:0};
  const f={signer,state,request,action:'test',limits:{maxGasPrice:'10',maxGasLimit:'100000',nativeFloor:'1'},save:async()=>{},guard:async()=>{}};
  let transaction,receipt;
  f.provider={getTransactionCount:async()=>0,getFeeData:async()=>({gasPrice:1n}),estimateGas:async()=>21000n,getBalance:async()=>1000000n,getBlockNumber:async()=>1,
    getTransactionReceipt:async()=>receipt,getTransaction:async()=>transaction,getBlock:async()=>({hash:id('block')}),
    broadcastTransaction:async raw=>{transaction=Transaction.from(raw);receipt={hash:transaction.hash,blockNumber:2,blockHash:id('block'),status:1};return {hash:transaction.hash};}};
  return f;
}
test('Gas and native balance limits wait before signing, and native-value intent is rejected',async()=>{
  for(const [key,value,reason] of [['maxGasPrice','0','gas-price'],['maxGasLimit','1','gas-limit'],['nativeFloor','1000000','native-balance']]){
    const f=fixture();f.limits[key]=value;assert.equal((await advanceTransaction(f)).reason,reason);assert.equal(f.state.pending,undefined);
  }
  const f=fixture();f.request.value=1n;await assert.rejects(advanceTransaction(f),/native value/);assert.equal(f.state.pending,undefined);
});
test('A pending signed intent cannot be redirected or replaced after interruption',async()=>{
  const f=fixture();await assert.rejects(advanceTransaction({...f,hook:async phase=>{if(phase==='prepared')throw Error('crash');}}),/crash/);
  const original=structuredClone(f.state.pending);f.state.pending.to=Wallet.createRandom().address;
  await assert.rejects(advanceTransaction(f),/Pending intent mismatch/);
  f.state.pending=original;f.provider.getTransactionCount=async()=>1;
  await assert.rejects(advanceTransaction(f),/Nonce consumed/);assert.deepEqual(f.state.pending,original);
});
test('Receipt from another branch or transaction does not resolve pending intent',async()=>{
  const f=fixture();await assert.rejects(advanceTransaction({...f,hook:async phase=>{if(phase==='broadcast')throw Error('crash');}}),/crash/);
  const before=structuredClone(f.state.pending),read=f.provider.getTransactionReceipt;
  f.provider.getTransactionReceipt=async()=>({...await read(),blockHash:id('other')});
  await assert.rejects(advanceTransaction(f),/Noncanonical/);assert.deepEqual(f.state.pending,before);assert.equal(f.state.history.length,0);
  f.provider.getTransactionReceipt=async()=>({...await read(),hash:id('other')});
  await assert.rejects(advanceTransaction(f),/Noncanonical/);
});
test('Reverted receipt is recorded without raw signature and halts automatic continuation',async()=>{
  const f=fixture();await assert.rejects(advanceTransaction({...f,hook:async phase=>{if(phase==='broadcast')throw Error('crash');}}),/crash/);
  const read=f.provider.getTransactionReceipt;f.provider.getTransactionReceipt=async()=>({...await read(),status:0});
  const result=await advanceTransaction(f);assert.equal(result.status,'blocked');assert.equal(f.state.pending,undefined);
  assert.equal(f.state.history[0].raw,undefined);assert.ok(f.state.failure);
  await assert.rejects(advanceTransaction(f),/reverted transaction/);
});
