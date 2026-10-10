import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,AbiCoder,id} from 'ethers';
import {recognizeProduction} from '../../src/tickets/production-recognition.mjs';
import direct from '../../src/tickets/direct-curve.cjs';
import batch from '../../src/qianqi/routes/pons-batch-buy.cjs';
import pins from '../../src/qianqi/routes/genesis-fields.json' with {type:'json'};

const addr=n=>'0x'+n.toString(16).padStart(40,'0');
async function fixture(type=4) {
  const signer=new Wallet(id('isolated-unit-buyer')),payer=signer.address.toLowerCase();
  const policy={contracts:Object.fromEntries(['factory','router','curve','token','quote','hook','program'].map((k,i)=>[k,{address:addr(i+10)}]))};
  policy.contracts.batchExecutor={address:pins.pins.batchExecutor[0],codeHash:pins.pins.batchExecutor[1]};
  const a=k=>policy.contracts[k].address,logs=[],hash=id('tx'),blockHash=id('block');
  const add=(asset,abi,name,args)=>logs.push({address:asset,...abi.encodeEventLog(abi.getEvent(name),args),logIndex:logs.length,transactionIndex:0,blockNumber:2,blockHash,transactionHash:hash});
  add(a('quote'),direct.TRANSFER,'Transfer',[payer,a('curve'),100n]);
  add(a('token'),direct.TRANSFER,'Transfer',[a('curve'),payer,500n]);
  add(a('curve'),direct.EVENTS,'CurveBuy',[payer,payer,100n,500n,1n,2n]);
  const calls=[[a('quote'),0,batch.APPROVE.encodeFunctionData('approve',[a('curve'),100])],[a('curve'),0,direct.CALL.encodeFunctionData('buy',[100,1,payer])]];
  const transaction={hash,blockHash,blockNumber:2,transactionIndex:0,from:payer,to:payer,type,nonce:0,value:'0',
    input:batch.EXEC.encodeFunctionData('execute',[batch.MODE,AbiCoder.defaultAbiCoder().encode(batch.TYPES,[calls])])};
  if(type===4){const auth=await signer.authorize({address:a('batchExecutor'),chainId:4663,nonce:1});
    transaction.authorizationList=[{address:auth.address,chainId:String(auth.chainId),nonce:String(auth.nonce),r:auth.signature.r,s:auth.signature.s,yParity:auth.signature.yParity}];}
  const receipt={status:1,from:payer,to:payer,blockHash,blockNumber:2,transactionIndex:0,transactionHash:hash,logs};
  const context={hash:blockHash,parentHash:id('parent'),executorCodeHash:policy.contracts.batchExecutor.codeHash,parentExecutorCodeHash:policy.contracts.batchExecutor.codeHash,
    transactions:[{tx:transaction}],batchAccounts:{[payer]:{parentHash:id('parent'),code:'0xef0100'+a('batchExecutor').slice(2)}}};
  return {policy,transaction,receipt,context};
}
const decode=f=>recognizeProduction(f.policy,f.transaction,f.receipt,f.context);
test('Production self-batch requires reviewed runtime and signed chain/nonce authority',async()=>{
  const f=await fixture();assert.equal(decode(f)[0].reason,'SUPPORTED_SELF_BATCH_BUY');assert.equal(decode(f)[0].netQuoteDebitRaw,'100');
  for(const mutate of [g=>{g.transaction.authorizationList[0].chainId='1';},g=>{g.transaction.authorizationList[0].nonce='5';},
    g=>{g.transaction.authorizationList[0].r=id('forged signature');},g=>{g.transaction.authorizationList[0].address=addr(99);},g=>{g.transaction.authorizationList=[];}]){
    const g=structuredClone(f);mutate(g);assert.notEqual(decode(g)[0].status,'ELIGIBLE');
  }
  const changed=structuredClone(f);changed.policy.contracts.batchExecutor.codeHash=id('wrong');assert.throws(()=>decode(changed),/Unreviewed/);
  const missing=structuredClone(f);delete missing.context;assert.throws(()=>decode(missing),/provenance/);
});
test('Persistent delegation uses parent state; another authorization in the block rejects attribution',async()=>{
  const f=await fixture(2);assert.equal(decode(f)[0].status,'ELIGIBLE');
  const wrong=structuredClone(f);wrong.context.batchAccounts[f.transaction.from].code='0x';assert.notEqual(decode(wrong)[0].status,'ELIGIBLE');
  const changed=structuredClone(f),authorized=await fixture(4);changed.context.transactions.push({tx:authorized.transaction});
  assert.notEqual(decode(changed)[0].status,'ELIGIBLE');
  const runtime=structuredClone(f);runtime.context.parentExecutorCodeHash=id('other');assert.throws(()=>decode(runtime),/provenance/);
});
test('Ambiguous payment, foreign project and unpinned batch cannot issue tickets',async()=>{
  const f=await fixture();
  const payment=structuredClone(f);payment.receipt.logs=payment.receipt.logs.slice(1);assert.notEqual(decode(payment)[0].status,'ELIGIBLE');
  const other=structuredClone(f);other.policy.contracts.curve.address=addr(99);assert.ok(decode(other).every(e=>e.status!=='ELIGIBLE'));
  const unpinned=structuredClone(f);delete unpinned.policy.contracts.batchExecutor;assert.notEqual(decode(unpinned)[0].status,'ELIGIBLE');
});
