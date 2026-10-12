import {scanDrawHistory} from '../../src/tickets/draw-scan.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {id} from 'ethers';
import {DEFERRED,adapterIds,discoverPurchases,prepareDeferredRecognition,pendingPurchases} from '../../src/tickets/deferred-recognition.mjs';
import {scanProductionLedger,makeBundle,creditedPurchases,snapshotProductionTickets,bundlePurchases} from '../../src/tickets/draw-ledger.mjs';
import {bundleHash} from '../../src/tickets/late-recognition.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {replayTickets} from '../../src/tickets/ledger.mjs';
import direct from '../../src/tickets/direct-curve.cjs';
const raw=JSON.parse(fs.readFileSync('tests/fixtures/draw-router-86149336.json'));
const codes=JSON.parse(fs.readFileSync('tests/fixtures/pons-router-runtimes-86149336.json'));
function fixture(){
 const f=structuredClone(raw),number=Number(BigInt(f.tx.blockNumber));
 f.policy.purchaseAccounting=DEFERRED;f.policy.projectId='a5897d1a-def5-4c9f-a7bb-a76f2b16519e';f.policy.template={config:{ticketPurchase:'10'}};f.policy.contracts.recognition={address:'0x'+'5'.repeat(40)};
 const block={number:f.tx.blockNumber,hash:f.tx.blockHash,parentHash:f.context.parentHash,timestamp:f.context.timestamp,transactions:Array.from({length:7},(_,i)=>i===6?f.tx:{hash:id('empty'+i),blockHash:f.tx.blockHash,transactionIndex:'0x'+i.toString(16),from:'0x'+'6'.repeat(40),to:'0x'+'7'.repeat(40)})};
 const head={number:number-1,hash:block.parentHash,timestamp:block.timestamp-1};
 const ledger={head,events:[],evidence:{},bundles:{},confirmations:[]};let traces=0;
 const provider={getBlock:async n=>Number(n)===number-1?head:block,getCode:async a=>codes[a.toLowerCase()]??'0x',send:async(method,args)=>{
  if(method==='debug_traceTransaction'){traces++;return structuredClone(f.context.trace);}
  if(method==='eth_getBlockByNumber')return block;
  if(method==='eth_getTransactionReceipt')return args[0]===f.tx.hash?f.receipt:{transactionHash:args[0],blockHash:block.hash,blockNumber:block.number,transactionIndex:block.transactions.find(t=>t.hash===args[0]).transactionIndex,status:'0x0',logs:[]};
  throw Error('Unexpected RPC '+method);
 }};
 return {...f,number,block,ledger,provider,traces:()=>traces};
}
const prepare=(f,extra={})=>prepareDeferredRecognition({provider:f.provider,policy:f.policy,ledger:f.ledger,creditedIds:new Set(),now:1000,...extra});
async function scanned(){const f=fixture();await scanProductionLedger(f.provider,f.policy,f.ledger,{number:f.number});return f;}
function confirm(f,ids,number=f.number+2){const b=makeBundle(f.policy,ids,f.ledger),hash=bundleHash(b);f.ledger.bundles[hash]=b;f.ledger.confirmations.push({hash,count:ids.length,number});f.ledger.head={number,hash:id('confirmation'),timestamp:f.context.timestamp+2};return b;}

test('Discovery advances through a routed purchase without a single trace call',async()=>{
 const f=await scanned();assert.equal(f.traces(),0);assert.equal(f.ledger.head.number,f.number);
 const e=f.ledger.events[0];assert.equal(e.status,'WAITING_RECOGNITION');assert.equal(e.payer,null);assert.equal(e.recipient,null);assert.equal(e.observedSender,f.tx.from);
 assert.equal(creditedPurchases(f.policy,f.ledger).length,0);
 assert.equal(pendingPurchases(f.ledger,new Set()).length,1);
});
test('Adapter expansion after restart processes backlog without changing original events or policy',async()=>{
 const f=await scanned(),identity=digest(f.policy),observed=digest(f.ledger.events);
 assert.deepEqual(await prepare(f,{enabledAdapters:[]}),[]);assert.equal(f.traces(),0);
 f.ledger=JSON.parse(JSON.stringify(f.ledger));
 const ids=await prepare(f);assert.equal(ids.length,1);assert.equal(f.traces(),1);assert.equal(digest(f.policy),identity);assert.equal(digest(f.ledger.events),observed);
 const program={target:f.policy.contracts.fundingRouter.address,consumedThrough:async()=>0n};
 const before={...f.ledger.head},frozen=await snapshotProductionTickets(f.policy,f.ledger,program,before);
 const bundle=confirm(f,ids);assert.equal(bundle.schema,'draw-recognition-v2');assert.equal(bundle.proofs.length,1);
 assert.deepEqual(await snapshotProductionTickets(f.policy,f.ledger,program,before),frozen);
 const now=await snapshotProductionTickets(f.policy,f.ledger,program);assert.equal(now.participants[0].lastAttempt,'1');
 assert.deepEqual(replayTickets(creditedPurchases(f.policy,f.ledger),'10000000')[f.tx.from],{spent:'12485319',tickets:'1',remainder:'2485319'});
 delete f.ledger.recognitionQueue;assert.equal(creditedPurchases(f.policy,JSON.parse(JSON.stringify(f.ledger))).length,1);
 // Even a repeated valid commitment cannot move the first credit or double it.
 f.ledger.confirmations.push({...f.ledger.confirmations[0],number:f.number+3});f.ledger.head.number++;
 assert.equal(creditedPurchases(f.policy,f.ledger)[0].creditedAt,f.number+2);assert.equal(creditedPurchases(f.policy,f.ledger).length,1);
 assert.equal(digest(f.ledger.events),observed);
});
test('Trace outages are queued with bounded retry; discovery head is not rolled back',async()=>{
 const f=await scanned(),original=f.provider.send;f.provider.send=(m,a)=>m==='debug_traceTransaction'?Promise.reject(Error('secret RPC URL')):original(m,a);
 assert.deepEqual(await prepare(f),[]);assert.equal(f.ledger.head.number,f.number);assert.equal(f.ledger.recognitionQueue.attempts[f.ledger.events[0].candidateId].reason,'evidence-unavailable');
 assert.ok(!JSON.stringify(f.ledger).includes('secret RPC URL'));
 f.provider.send=original;assert.deepEqual(await prepare(f,{now:2000}),[]);assert.equal(f.traces(),0);
 assert.equal((await prepare(f,{now:62000})).length,1);
});
test('Unknown routes cannot starve later direct buys',async()=>{
 const f=await scanned();f.ledger.evidence[f.tx.hash].transaction.to='0x'+'8'.repeat(40);f.ledger.events=discoverPurchases(f.policy,f.ledger.evidence[f.tx.hash].transaction,f.receipt);
 const tx={...f.tx,hash:id('direct'),to:f.policy.contracts.curve.address,value:'0x0',input:direct.CALL.encodeFunctionData('buy',[10000000,1,f.tx.from])};
 const events=[[f.policy.contracts.quote.address,direct.TRANSFER,'Transfer',[f.tx.from,tx.to,10000000]], [f.policy.contracts.token.address,direct.TRANSFER,'Transfer',[tx.to,f.tx.from,500]], [tx.to,direct.EVENTS,'CurveBuy',[f.tx.from,f.tx.from,10000000,500,100,200]]];
 const receipt={...f.receipt,transactionHash:tx.hash,to:tx.to,logs:events.map(([address,abi,name,args],i)=>({...f.receipt.logs[0],address,...abi.encodeEventLog(abi.getEvent(name),args),transactionHash:tx.hash,logIndex:i}))};
 const block={...f.block,transactions:f.block.transactions.map((t,i)=>i===6?tx:t)};
 f.ledger.events.push(...discoverPurchases(f.policy,tx,receipt));f.ledger.evidence[tx.hash]={transaction:tx,receipt,block};
 f.provider.send=async m=>{assert.equal(m,'eth_getBlockByNumber');return block;};
 assert.deepEqual(await prepare(f,{limit:1}),[]);
 const ids=await prepare(f,{limit:1});assert.equal(ids.length,1);assert.ok(ids[0].includes(tx.hash));
 confirm(f,ids);assert.equal(creditedPurchases(f.policy,f.ledger).length,1);assert.equal(pendingPurchases(f.ledger,new Set(ids)).length,1);
});
test('Committed proofs reject cross-project use, tampering, unknown verifier and changed ancestry',async()=>{
 const f=await scanned(),ids=await prepare(f),bundle=confirm(f,ids);
 const other={...f.policy,projectId:'b5897d1a-def5-4c9f-a7bb-a76f2b16519e'};assert.throws(()=>creditedPurchases(other,f.ledger),/identity/);
 for(const change of [b=>b.proofs[0].adapter='arbitrary-code',b=>b.proofs[0].context.codeHashes[f.tx.to]=id('changed'),b=>b.proofs[0].context.parentHash=id('other'),b=>b.proofs[0].candidateId='foreign',b=>b.proofs.push(b.proofs[0]),b=>b.proofs[0].amount='100000000']){
  const bad=structuredClone(bundle);change(bad);assert.throws(()=>bundlePurchases(f.policy,f.ledger,bad));
 }
 const clean=await scanned();clean.provider.send=async()=>({...clean.block,hash:id('reorg')});await assert.rejects(prepare(clean),/branch changed/);
 await assert.rejects(prepare(clean,{enabledAdapters:['unreviewed']}),/selection/);
});
test('Sales and bare token transfers are retained but never presented as pending purchases',()=>{
 const f=fixture(),l=f.receipt.logs.find(l=>l.address===f.policy.contracts.curve.address);Object.assign(l,direct.EVENTS.encodeEventLog(direct.EVENTS.getEvent('CurveSell'),[f.tx.from,f.tx.from,100,10,1,1]));
 assert.equal(discoverPurchases(f.policy,f.tx,f.receipt)[0].reason,'SELL');
 f.receipt.logs=f.receipt.logs.filter(l=>l.address===f.policy.contracts.token.address);assert.ok(discoverPurchases(f.policy,f.tx,f.receipt).every(e=>e.status!=='WAITING_RECOGNITION'));
});

test('Filtered history discovers identical purchases with full receipt validation',async()=>{
 const f=fixture(),ordinary=fixture();await scanProductionLedger(ordinary.provider,ordinary.policy,ordinary.ledger,{number:ordinary.number});
 const getBlock=f.provider.getBlock;f.provider.getBlock=async n=>{const b=await getBlock(n);return {...b,number:Number(BigInt(b.number)),timestamp:Number(BigInt(b.timestamp))};};
 const logs=f.receipt.logs.filter(l=>[f.policy.contracts.curve.address,f.policy.contracts.token.address].some(a=>a.toLowerCase()===l.address.toLowerCase())).map(l=>({...l,index:Number(BigInt(l.logIndex)),blockNumber:Number(BigInt(l.blockNumber))}));
 f.provider.getLogs=async()=>logs;f.provider.getTransactionReceipt=async()=>({...f.receipt,logs:f.receipt.logs.map(l=>({...l,index:Number(BigInt(l.logIndex))}))});
 assert.equal(await scanDrawHistory(f.provider,f.policy,f.ledger,{number:f.number}),true);assert.deepEqual(f.ledger,ordinary.ledger);
 const bad=fixture();bad.provider={...f.provider,getLogs:async()=>logs.map(l=>({...l,blockHash:id('wrong')}))};await assert.rejects(scanDrawHistory(bad.provider,bad.policy,bad.ledger,{number:bad.number}),/Discovery branch/);
});
