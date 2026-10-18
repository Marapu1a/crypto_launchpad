import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectHolderSnapshot,acceptFixtureSnapshot,verifyAcceptedSnapshot} from '../../src/holders/snapshot.mjs';
import {applyHolderEvent,createHolderBook,holderScopeId,replayHolderBook} from '../../src/holders/ledger.mjs';
const addr=n=>'0x'+n.toString(16).padStart(40,'0'),tx=n=>'0x'+n.toString(16).padStart(64,'0');
const scope={projectId:'fixture-token',chainId:4663,token:addr(100),asset:addr(200)};
const rules={weight:'snapshot-balance',minimumPayment:'10',minimumHolding:'0',exclusions:[addr(3)]};
function pages(){return [
 {token:scope.token,holders:3,supply:'100',as_of:{rollup_bucket:1,tail_from_block:2},page:[{wallet:addr(1),balance:'30',share:0.9},{wallet:addr(2),balance:'20'}],next_cursor:'page2'},
 {token:scope.token,holders:3,supply:'100',as_of:{rollup_bucket:1,tail_from_block:2},page:[{wallet:addr(3),balance:'50',label:'curve'}],next_cursor:null}
 ];}
async function snapshot(input=pages(),options={}){let i=0;return collectHolderSnapshot({chainId:4663,token:scope.token,observedAt:100,maxPages:2,maxHolders:3,fetchPage:async()=>input[i++],...options});}
const accepted=async()=>acceptFixtureSnapshot(await snapshot(),{reason:'synthetic fixture'});
const event=(book,id,type,fields)=>({id,scopeId:holderScopeId(book),type,...fields});
const add=(book,id,type,fields)=>applyHolderEvent(book,event(book,id,type,fields));
const funded=amount=>add(createHolderBook(scope),'credit-1','credit',{receiptId:'isolated-receipt-1',amount});
const round=async(book,budget,id='r1',policy=rules)=>add(book,id,'round',{roundId:id,periodId:'period-'+id,budget,policy,accepted:await accepted()});

test('Full pagination retains evidence, ignores rounded shares, and never claims atomicity',async()=>{
 const s=await snapshot();assert.equal(s.holders.length,3);assert.equal(s.holders[0].balance,'30');assert.equal(s.atomicity,'unverified');assert.equal(s.pages.length,2);
 assert.deepEqual(verifyAcceptedSnapshot(acceptFixtureSnapshot(s,{reason:'fixture'})),s);
 const changed=acceptFixtureSnapshot(s,{reason:'fixture'});changed.snapshot.holders[0].balance='99';assert.throws(()=>verifyAcceptedSnapshot(changed));
 assert.throws(()=>verifyAcceptedSnapshot({...changed,schema:'holder-accepted-production-v1'}));
});
test('Missing pages, repeated cursors, duplicates, changing metadata and source failures fail closed',async()=>{
 await assert.rejects(snapshot(pages(),{maxPages:1}));await assert.rejects(snapshot(pages(),{maxHolders:2}));
 for(const mutate of [p=>p[1].page[0].wallet=addr(1),p=>p[1].supply='99',p=>p[1].as_of.tail_from_block=3,p=>p[1].token=addr(9),p=>p[1].holders=4,p=>p[1].next_cursor='page2',p=>p[1].page[0].balance='49',p=>p[0].page[0].balance=30,p=>p[0].page[0].balance='-1',p=>delete p[1].next_cursor]){
  const p=pages();mutate(p);await assert.rejects(snapshot(p));
 }
 await assert.rejects(snapshot(pages(),{fetchPage:async()=>{throw Error('source unavailable');}}));
 const noMetadata=pages();for(const p of noMetadata)p.as_of={};await assert.rejects(snapshot(noMetadata));
});
test('Round reserves debts, excludes explicit addresses, and retains division remainder',async()=>{
 const b=await round(funded('101'),'101'),s=replayHolderBook(b);
 assert.equal(s.rounds.r1.allocated,'100');assert.equal(s.available,'1');assert.equal(s.owed,'100');assert.equal(s.accounts[addr(1)].owed,'60');assert.equal(s.accounts[addr(2)].owed,'40');assert.equal(s.accounts[addr(3)],undefined);
 await assert.rejects(round(b,'2','r2')); // Debts cannot finance another round.
 const duplicate=structuredClone(b.events.at(-1));duplicate.id='another-event';assert.throws(()=>applyHolderEvent(b,duplicate));
 const otherPeriod=structuredClone(duplicate);otherPeriod.roundId='other';assert.throws(()=>applyHolderEvent(b,otherPeriod));
 assert.deepEqual(applyHolderEvent(b,b.events.at(-1)),b);
 const bad=structuredClone(b.events.at(-1));bad.budget='99';assert.throws(()=>applyHolderEvent(b,bad));
});
test('Dust accumulates as wallet debt across rounds and persists through JSON restart',async()=>{
 let b=await round(funded('10'),'10');assert.throws(()=>add(b,'small','payout.prepare',{payoutId:'p1',roundId:'r1',wallet:addr(1),amount:'6'}));
 b=add(b,'credit-2','credit',{receiptId:'isolated-receipt-2',amount:'10'});b=await round(b,'10','r2');b=JSON.parse(JSON.stringify(b));
 let s=replayHolderBook(b);assert.equal(s.accounts[addr(1)].owed,'12');assert.equal(s.accounts[addr(2)].owed,'8');
 b=add(b,'prepare','payout.prepare',{payoutId:'p1',roundId:'r2',wallet:addr(1),amount:'12'});s=replayHolderBook(b);assert.equal(s.reserved,'12');assert.equal(s.owed,'20');assert.equal(s.available,'0');
 assert.throws(()=>add(b,'again','payout.prepare',{payoutId:'p2',roundId:'r2',wallet:addr(1),amount:'12'}));
});
test('Unknown payment remains reserved; matching finalized result prevents repeat payment',async()=>{
 let b=await round(funded('100'),'100');b=add(b,'prepare','payout.prepare',{payoutId:'p1',roundId:'r1',wallet:addr(1),amount:'60'});
 b=add(b,'submit','payout.submit',{payoutId:'p1',txHash:tx(1)});b=add(b,'unknown','payout.unknown',{payoutId:'p1'});b=JSON.parse(JSON.stringify(b));
 assert.equal(replayHolderBook(b).reserved,'60');assert.throws(()=>add(b,'cancel','payout.cancel',{payoutId:'p1',reason:'timeout'}));
 const evidence={mode:'fixture-only',finalized:true,success:true,txHash:tx(1),chainId:4663,asset:scope.asset,wallet:addr(1),amount:'60'};
 for(const delta of [{finalized:false},{txHash:tx(2)},{wallet:addr(2)},{asset:addr(2)},{amount:'59'},{chainId:1}])assert.throws(()=>add(b,'resolve','payout.resolve',{payoutId:'p1',evidence:{...evidence,...delta}}));
 b=add(b,'resolve','payout.resolve',{payoutId:'p1',evidence});const s=replayHolderBook(b);assert.equal(s.paid,'60');assert.equal(s.owed,'40');assert.equal(s.reserved,'0');
 assert.deepEqual(applyHolderEvent(b,b.events.at(-1)),b);assert.throws(()=>add(b,'resolve-again','payout.resolve',{payoutId:'p1',evidence}));
 assert.throws(()=>add(b,'pay-again','payout.prepare',{payoutId:'p2',roundId:'r1',wallet:addr(1),amount:'60'}));
});
test('Finalized failed transaction releases reservation but preserves entitlement for a new attempt',async()=>{
 let b=await round(funded('100'),'100');b=add(b,'prepare','payout.prepare',{payoutId:'p1',roundId:'r1',wallet:addr(1),amount:'60'});
 b=add(b,'submit','payout.submit',{payoutId:'p1',txHash:tx(1)});
 b=add(b,'failed','payout.resolve',{payoutId:'p1',evidence:{mode:'fixture-only',finalized:true,success:false,txHash:tx(1),chainId:4663,asset:scope.asset,wallet:addr(1),amount:'60'}});
 assert.equal(replayHolderBook(b).accounts[addr(1)].owed,'60');assert.equal(replayHolderBook(b).reserved,'0');
 b=add(b,'prepare2','payout.prepare',{payoutId:'p2',roundId:'r1',wallet:addr(1),amount:'60'});
 assert.throws(()=>add(b,'submit2','payout.submit',{payoutId:'p2',txHash:tx(1)}));
 b=add(b,'cancel2','payout.cancel',{payoutId:'p2',reason:'never broadcast'});assert.equal(replayHolderBook(b).reserved,'0');
});
test('Instance isolation, unique receipts, explicit policy and nonmutating failures',async()=>{
 const b=funded('100'),before=structuredClone(b),other=createHolderBook({...scope,projectId:'other'});
 assert.throws(()=>applyHolderEvent(other,b.events[0]));assert.throws(()=>add(b,'credit-copy','credit',{receiptId:'isolated-receipt-1',amount:'100'}));
 await assert.rejects(round(b,'100','r1',{...rules,weight:'balance-time'}));await assert.rejects(round(b,'100','r1',{...rules,exclusions:[addr(1),addr(2),addr(3)]}));
 const a=await accepted();a.snapshot.chainId=1;assert.throws(()=>add(b,'round','round',{roundId:'r',periodId:'p',budget:'100',policy:rules,accepted:a}));
 assert.deepEqual(b,before);assert.equal(replayHolderBook(other).received,'0');
});

test('Policy changes never erase prior debts; old minimum cannot bypass latest policy',async()=>{
 let b=await round(funded('100'),'100');b=add(b,'credit-2','credit',{receiptId:'isolated-receipt-2',amount:'10'});
 b=await round(b,'10','r2',{...rules,minimumPayment:'70',exclusions:[addr(1),addr(3)]});
 assert.equal(replayHolderBook(b).accounts[addr(1)].owed,'60');
 assert.throws(()=>add(b,'old-policy','payout.prepare',{payoutId:'p1',roundId:'r1',wallet:addr(1),amount:'60'}));
 assert.throws(()=>add(b,'new-policy','payout.prepare',{payoutId:'p1',roundId:'r2',wallet:addr(1),amount:'60'}));
 const other=createHolderBook({...scope,asset:addr(999)});assert.throws(()=>applyHolderEvent(other,b.events[0]));
});

test('Large integers and many small rounds conserve funds without floating point',async()=>{
 const large='1000000000000000000000000000001';let b=await round(funded(large),large);
 let s=replayHolderBook(b);assert.equal(BigInt(s.available)+BigInt(s.owed),BigInt(large));assert.equal(s.available,'1');
 for(let i=0;i<25;i++){
  b=add(b,'fund-'+i,'credit',{receiptId:'receipt-'+i,amount:String(i+1)});
  b=await round(b,replayHolderBook(b).available,'r-'+i);
  s=replayHolderBook(b);assert.equal(BigInt(s.received),BigInt(s.available)+BigInt(s.owed)+BigInt(s.paid));
 }
 assert.deepEqual(replayHolderBook(JSON.parse(JSON.stringify(b))),s);
});
