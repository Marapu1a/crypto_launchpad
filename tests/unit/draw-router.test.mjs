import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Interface} from 'ethers';
import shape from '../../src/qianqi/routes/pons-router-calldata-research.cjs';
import direct from '../../src/tickets/direct-curve.cjs';
import {recognizeDraw,captureBatchContext} from '../../src/tickets/draw-recognition.mjs';
import {withTraceProvider} from '../../server/short-runtime/trace-provider.mjs';
import {makeBundle,creditedPurchases,scanProductionLedger} from '../../src/tickets/draw-ledger.mjs';
import {bundleHash} from '../../src/tickets/late-recognition.mjs';
import {replayTickets} from '../../src/tickets/ledger.mjs';
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/draw-router-86149336.json'));
const decode=f=>recognizeDraw(f.policy,f.tx,f.receipt,f.context);
test('Historical Pons ETH buy now credits exact USDG; old policy stays unchanged',()=>{
 const f=structuredClone(fixture),r=decode(f);assert.equal(r[0].status,'ELIGIBLE');assert.equal(r[0].netQuoteDebitRaw,'12485319');assert.equal(r[0].recipient,f.tx.from);
 delete f.policy.routes;assert.equal(decode(f)[0].status,'UNSUPPORTED_ROUTE');
});
test('Real routed purchase becomes one ticket only after recognition and is never counted twice',()=>{
 const f=structuredClone(fixture),event=decode(f)[0],number=event.blockNumber+1,bundle=makeBundle(f.policy,[event.candidateId]),hash=bundleHash(bundle);
 const ledger={head:{number},events:[event],evidence:{[event.transactionHash]:{transaction:f.tx,receipt:f.receipt,context:f.context}},bundles:{[hash]:bundle},confirmations:[]};
 assert.equal(creditedPurchases(f.policy,ledger).length,0);
 ledger.confirmations.push({hash,number,count:1});assert.equal(creditedPurchases(f.policy,ledger,number-1).length,0);
 ledger.confirmations.push({hash,number:number+1,count:1});ledger.head.number++;
 const credited=creditedPurchases(f.policy,ledger);assert.equal(credited.length,1);assert.deepEqual(replayTickets(credited,'10000000')[f.tx.from],{spent:'12485319',tickets:'1',remainder:'2485319'});
 f.context.codeHashes[f.tx.to]='0x'+'0'.repeat(64);assert.throws(()=>creditedPurchases(f.policy,ledger),/Unverified purchase/);
});
test('Sell remains a sell and does not require buy tracing',async()=>{
 const f=structuredClone(fixture),l=f.receipt.logs.find(l=>l.address===f.policy.contracts.curve.address),event=direct.EVENTS.encodeEventLog(direct.EVENTS.getEvent('CurveSell'),[f.tx.from,f.tx.from,500n,100n,1n,2n]);Object.assign(l,event);
 assert.equal(recognizeDraw(f.policy,f.tx,f.receipt)[0].reason,'SELL');
 assert.equal(await captureBatchContext({send:async()=>{throw Error('Must not trace');}},f.policy,{},f.tx,f.receipt),undefined);
});
test('Wrong runtime, parent pin, logs, sender, recipient, token and extra calls never credit',()=>{
 for(const mutate of [
  f=>f.context.codeHashes[f.tx.to]='0x'+'0'.repeat(64),
  f=>f.context.parentCodeHashes[f.tx.to]='0x'+'0'.repeat(64),
  f=>f.receipt.logs[0].data='0x',
  f=>f.tx.from='0x'+'1'.repeat(40),
  f=>f.policy.contracts.token.address='0x'+'2'.repeat(40),
  f=>f.context.trace.calls.push({type:'CALL',from:f.tx.to,to:'0x'+'3'.repeat(40),input:'0x'}),
  f=>f.context.timestamp=9999999999,
 ]){const f=structuredClone(fixture);mutate(f);assert.ok(decode(f).every(r=>r.status!=='ELIGIBLE'));}
});
test('Missing proof or unavailable trace cannot silently advance supported purchase',async()=>{
 const f=structuredClone(fixture);assert.throws(()=>recognizeDraw(f.policy,f.tx,f.receipt),/provenance/);
 await assert.rejects(captureBatchContext({send:async()=>{throw Error('offline');}},f.policy,{number:f.tx.blockNumber},f.tx,f.receipt),{code:'PRODUCTION_WAIT'});
 // A one-transaction modeled block uses the real purchase envelope and logs.
 f.tx.transactionIndex=f.receipt.transactionIndex='0x0';for(const l of f.receipt.logs)l.transactionIndex='0x0';
 const number=Number(BigInt(f.tx.blockNumber)),head={number:number-1,hash:f.context.parentHash};
 const ledger={head:{...head},events:[],evidence:{},confirmations:[],bundles:{}};
 const block={number:f.tx.blockNumber,hash:f.tx.blockHash,parentHash:head.hash,timestamp:f.context.timestamp,transactions:[f.tx]};
 const provider={getBlock:async n=>n===number-1?head:block,send:async method=>{if(method==='eth_getBlockByNumber')return block;if(method==='eth_getTransactionReceipt')return f.receipt;throw Error('trace unavailable');}};
 await assert.rejects(scanProductionLedger(provider,f.policy,ledger,{number}),{code:'PRODUCTION_WAIT'});
 assert.deepEqual(ledger.head,head);assert.equal(ledger.events.length,0);
});
test('Separate trace endpoint cannot receive chain reads or signed transactions',async()=>{
 const calls=[],primary={getNetwork:async()=>({chainId:4663n}),send:async m=>calls.push('primary:'+m),broadcastTransaction:async()=>calls.push('primary:broadcast')},trace={getNetwork:primary.getNetwork,send:async m=>calls.push('trace:'+m)};
 const p=await withTraceProvider(primary,trace);await p.send('debug_traceTransaction',[]);await p.send('eth_getBlockByNumber',[]);await p.broadcastTransaction('dummy');
 assert.deepEqual(calls,['trace:debug_traceTransaction','primary:eth_getBlockByNumber','primary:broadcast']);
 const wrong=await withTraceProvider(primary,{getNetwork:async()=>({chainId:1n})});await assert.rejects(wrong.send('debug_traceTransaction',[]),/chain/);
 let online=false;
 const delayed=await withTraceProvider(primary,{getNetwork:async()=>{if(!online)throw Error('Unavailable');return {chainId:4663n};},send:trace.send});
 await delayed.send('eth_getBlockByNumber',[]);await assert.rejects(delayed.send('debug_traceTransaction',[]),/Unavailable/);
 online=true;await delayed.send('debug_traceTransaction',[]);assert.equal(calls.at(-1),'trace:debug_traceTransaction');
});
test('USDG router purchase credits net wallet debit including the explicit router fee',()=>{
 const f=structuredClone(fixture),a=k=>f.policy.contracts[k].address,payer=f.tx.from,router=f.tx.to,quote=a('quote'),token=a('token'),curve=a('curve');
 const input=shape.ABI.decodeFunctionData('swap',f.tx.input);f.tx.value='0x0';f.tx.input=shape.ABI.encodeFunctionData('swap',[[input.steps.at(-1)],quote,10000000n,1n,input.deadline]);
 const erc=new Interface(['function transferFrom(address,address,uint256)','function transfer(address,uint256)']);
 const frame=(type,from,to,input,calls=[],logs=[])=>({type,from,to,input,value:'0x0',calls,logs});
 const logs=[];
 const log=(address,abi,name,args)=>{const event=abi.encodeEventLog(abi.getEvent(name),args),index=logs.length;
  logs.push({address,...event,logIndex:index,blockHash:f.tx.blockHash,blockNumber:f.tx.blockNumber,transactionHash:f.tx.hash,transactionIndex:f.tx.transactionIndex});return {address,...event,index};};
 const fee='0xb8159ba378904f803639d274cec79f788931c9c8',impl='0x68184c449e1a8f34fa18d289737129fd27b66f8f';
 const transfer=(caller,from,to,n)=>{const data=erc.encodeFunctionData('transferFrom',[from,to,n]);return frame('CALL',caller,quote,data,[frame('DELEGATECALL',quote,impl,data,[],[log(quote,direct.TRANSFER,'Transfer',[from,to,n])])]);};
 const payFee=transfer(router,payer,fee,100000n),fund=transfer(router,payer,router,9900000n),payCurve=transfer(curve,router,curve,9900000n);
 const delivery=frame('CALL',curve,token,erc.encodeFunctionData('transfer',[payer,500n]),[],[log(token,direct.TRANSFER,'Transfer',[curve,payer,500n])]);
 const buy=frame('CALL',router,curve,direct.CALL.encodeFunctionData('buy',[9900000n,1n,payer]),[payCurve,delivery],[log(curve,direct.EVENTS,'CurveBuy',[router,payer,9900000n,500n,99000n,198000n])]);
 f.context.trace=frame('CALL',payer,router,f.tx.input,[frame('DELEGATECALL',router,'0x7e7d82b72797821f94dffed7d5e77e24c7532f30',f.tx.input,[payFee,fund,frame('DELEGATECALL',router,'0x1ab4c5dfe15ff16170201d7fe0edc20c3d0cada3','0xd4fa7037',[buy])])]);f.receipt.logs=logs;
 assert.equal(decode(f)[0].status,'ELIGIBLE');assert.equal(decode(f)[0].netQuoteDebitRaw,'10000000');
 payFee.calls[0].logs[0].data=logs[0].data=direct.TRANSFER.encodeEventLog(direct.TRANSFER.getEvent('Transfer'),[payer,fee,200000n]).data;
 assert.notEqual(decode(f)[0].status,'ELIGIBLE');
});
