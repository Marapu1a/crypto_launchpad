import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayTickets, snapshotTickets } from '../../src/tickets/ledger.mjs';
import { recognize } from '../../src/tickets/recognition.mjs';
import direct from '../../src/tickets/direct-curve.cjs';
import { ROUTER } from '../../src/pons/client.mjs';
const addr=i=>'0x'+i.toString(16).padStart(40,'0');
const hash=i=>'0x'+i.toString(16).padStart(64,'0');
const event=(i,n,w=addr(1))=>({candidateId:String(i),status:'ELIGIBLE',recipient:w,netQuoteDebitRaw:String(n)});
test('Threshold and carry are exact; non-buys ignored, duplicates fail',()=>{
  const events=[event(1,6000000),event(2,4000000),event(3,25000000,addr(2)),{candidateId:'sell',status:'INELIGIBLE',reason:'SELL'}];
  const ledger=replayTickets(events,'10000000');
  assert.deepEqual(ledger[addr(1)],{spent:'10000000',tickets:'1',remainder:'0'});
  assert.deepEqual(ledger[addr(2)],{spent:'25000000',tickets:'2',remainder:'5000000'});
  assert.equal(replayTickets(events,'1000000')[addr(1)].tickets,'10');
  assert.throws(()=>replayTickets([...events,events[0]],'10000000'),/Duplicate/);
  assert.throws(()=>replayTickets(events,'0'));
});
test('Frozen cutoff excludes future buys; consumed ranges leave only fresh tickets',()=>{
  const state={profile:{anchor:{number:0,hash:hash(0)},thresholdRaw:'10'},head:{number:2},blocks:[{number:1,hash:hash(1),events:[event(1,25)]},{number:2,hash:hash(2),events:[event(2,10)]}]};
  const first=snapshotTickets(state,1);assert.deepEqual(first.participants,[{wallet:addr(1),firstAttempt:'1',lastAttempt:'2'}]);
  const next=snapshotTickets(state,2,{[addr(1)]:'2'});assert.equal(next.participants[0].firstAttempt,'3');assert.equal(next.participants[0].lastAttempt,'3');
  assert.throws(()=>snapshotTickets(state,1,{[addr(1)]:'3'}),/exceed/);
  assert.throws(()=>snapshotTickets(state,3));
});
function directFixture(refund=0n){
  const p={chainId:'31337',factory:addr(10),hook:addr(11),curve:addr(12),token:addr(13),quote:addr(14),registry:addr(15),router:addr(16),quoteBasis:'wallet-net-debit-v1'};
  const logs=[];
  const log=(address,abi,name,args)=>{const e=abi.encodeEventLog(abi.getEvent(name),args);logs.push({address,...e,logIndex:logs.length,blockNumber:1,transactionIndex:0,blockHash:hash(1),transactionHash:hash(2)});};
  log(p.quote,direct.TRANSFER,'Transfer',[addr(1),p.curve,100n]);
  log(p.token,direct.TRANSFER,'Transfer',[p.curve,addr(1),500n]);
  if(refund){log(p.curve,direct.EVENTS,'CurveBuyRefunded',[addr(1),refund]);log(p.quote,direct.TRANSFER,'Transfer',[p.curve,addr(1),refund]);}
  log(p.curve,direct.EVENTS,'CurveBuy',[addr(1),addr(1),100n-refund,500n,1n,1n]);
  return {p,tx:{to:p.curve,from:addr(1),value:'0',input:direct.CALL.encodeFunctionData('buy',[100n,1n,addr(1)])},receipt:{status:1,logs}};
}
test('Direct decoder subtracts refunds and rejects ambiguous payment/recipient routes',()=>{
  const f=directFixture(20n);const result=recognize(f.p,f.tx,f.receipt)[0];assert.equal(result.status,'ELIGIBLE');assert.equal(result.netQuoteDebitRaw,'80');
  assert.notEqual(recognize(f.p,{...f.tx,to:addr(99)},f.receipt)[0].status,'ELIGIBLE');
  assert.notEqual(recognize(f.p,{...f.tx,from:addr(2)},f.receipt)[0].status,'ELIGIBLE');
  f.receipt.logs=f.receipt.logs.slice(1);assert.equal(recognize(f.p,f.tx,f.receipt)[0].status,'AMBIGUOUS');
});
test('Opening router refund is counted net, missing return leg cannot mint tickets',()=>{
  const f=directFixture();const p=f.p,logs=[];
  const add=(address,abi,name,args)=>{logs.push({address,...abi.encodeEventLog(abi.getEvent(name),args),logIndex:logs.length,blockNumber:1,blockHash:hash(1),transactionHash:hash(2),transactionIndex:0});};
  add(p.quote,direct.TRANSFER,'Transfer',[addr(1),p.router,100n]);
  add(p.quote,direct.TRANSFER,'Transfer',[p.router,p.curve,100n]);
  add(p.token,direct.TRANSFER,'Transfer',[p.curve,addr(1),500n]);
  add(p.curve,direct.EVENTS,'CurveBuyRefunded',[p.router,20n]);
  add(p.quote,direct.TRANSFER,'Transfer',[p.curve,p.router,20n]);
  add(p.curve,direct.EVENTS,'CurveBuy',[p.router,addr(1),80n,500n,1n,1n]);
  add(p.quote,direct.TRANSFER,'Transfer',[p.router,addr(1),20n]);
  add(p.router,ROUTER,'Launched',[p.token,p.curve,addr(1),addr(1),100n,500n]);
  const params={name:'Test',symbol:'T',logo:'ipfs://test',description:'',socials:{twitter:'',telegram:'',website:'',discord:'',farcaster:''},creatorFeeRecipient:addr(1),creatorTaxBps:100,buybackEnabled:false,expectedEconomics:hash(3),salt:hash(4)};
  const tx={from:addr(1),to:p.router,value:'500000000000000',input:ROUTER.encodeFunctionData('launchAndBuy',[params,0,p.quote,100n,1n,addr(1),[]])};
  const result=recognize(p,tx,{status:1,logs})[0];assert.equal(result.status,'ELIGIBLE');assert.equal(result.netQuoteDebitRaw,'80');
  assert.notEqual(recognize(p,tx,{status:1,logs:logs.filter(l=>l.logIndex!==6)})[0].status,'ELIGIBLE');
  const transfers=recognize(p,f.tx,{status:1,logs:logs.filter(l=>l.address===p.token)});
  assert.equal(transfers[0].reason,'TOKEN_TRANSFER_WITHOUT_SUPPORTED_BUY');
});
