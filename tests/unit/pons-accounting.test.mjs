import test from 'node:test';
import assert from 'node:assert/strict';
import {advancePonsAccounting,ponsWallets,snapshotPonsTickets} from '../../src/tickets/pons-accounting.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {runDrawWorker} from '../../server/shared/draw-worker.mjs';
const token='0x'+'1'.repeat(40),quote='0x'+'2'.repeat(40),wallet='0x'+'3'.repeat(40),tx='0x'+'4'.repeat(64);
const policy={contracts:{token:{address:token},quote:{address:quote}},template:{config:{ticketPurchase:'100'}}};
const head={number:100,hash:'0x'+'5'.repeat(64),timestamp:1000};
const row={id:tx+':0',txHash:tx,trader:wallet,quoteRaw:'198000000',timestamp:900,side:'buy',venue:'curve',decision:'purchase'};
const report={schema:'pons-purchase-accounting-v1',source:'Pons API',status:'current',checkedAt:1000,reviewCount:0,
 profile:{project:'sample',token,quote,decimals:6,threshold:'100',excludedWallets:[],venues:['curve']},tradeCount:1,activity:[row]};
const advance=(extra={})=>advancePonsAccounting({policy,report,head,now:1000,...extra});
const legacy={status:'ELIGIBLE',transactionHash:tx,logIndex:0,recipient:wallet,netQuoteDebitRaw:'200000000'};
test('Pons amounts and migrated credits are not counted twice',()=>{
 assert.equal(ponsWallets(advance(),'100000000')[wallet].tickets,'1');
 const old=advance({legacyCredits:[legacy]});assert.equal(ponsWallets(old,'100000000')[wallet].tickets,'2');
 const next=advance({prior:JSON.parse(JSON.stringify(old))});assert.equal(ponsWallets(next,'100000000')[wallet].tickets,'2');
});
test('Absent or differently attributed legacy credit is preserved with an explicit audit entry',()=>{
 const old=advance({legacyCredits:[{...legacy,transactionHash:'0x'+'6'.repeat(64)}]});assert.equal(ponsWallets(old,'100000000')[wallet].tickets,'3');
 const changed=advance({legacyCredits:[{...legacy,recipient:token}]});const wallets=ponsWallets(changed,'100000000');
 assert.equal(wallets[token].tickets,'2');assert.equal(wallets[wallet],undefined);assert.equal(changed.legacyDifferences[0].decision,'preserve-existing-credit');
});
test('Late observations never alter an earlier source cutoff',async()=>{
 const old=advance();const changed={...report,tradeCount:2,activity:[row,{...row,id:tx+':1',quoteRaw:'2000000'}]};
 const next=advance({prior:old,report:changed,head:{...head,number:101}});
 assert.equal(ponsWallets(next,'100000000',100)[wallet].tickets,'1');
 assert.equal(ponsWallets(next,'100000000',101)[wallet].tickets,'2');
 assert.equal(Object.keys(old.records).length,1);
});
test('Late API observation at the same finalized block preserves frozen revision',async()=>{
 const old=advance(),program={target:token,consumedThrough:async()=>0n};
 const frozen=await snapshotPonsTickets(policy,old,program);
 const next=advance({prior:old,report:{...report,tradeCount:2,activity:[row,{...row,id:tx+':1',quoteRaw:'2000000'}]}});
 assert.deepEqual(await snapshotPonsTickets(policy,next,program,head,old.revision),frozen);
 assert.notDeepEqual(await snapshotPonsTickets(policy,next,program),frozen);
});
test('Consumed ranges are subtracted per program; impossible usage blocks',async()=>{
 const state=advance({legacyCredits:[legacy]});
 const program={target:token,consumedThrough:async()=>1n};
 assert.deepEqual((await snapshotPonsTickets(policy,state,program)).participants,[{wallet,firstAttempt:'2',lastAttempt:'2'}]);
 assert.equal((await snapshotPonsTickets(policy,state,{...program,consumedThrough:async()=>2n})).participants.length,0);
 await assert.rejects(snapshotPonsTickets(policy,state,{...program,consumedThrough:async()=>3n}),/Consumed/);
});
test('Corrected, missing, duplicate or stale input cannot advance state',()=>{
 const old=advance(),before=digest(old);
 for(const r of [{...report,status:'unavailable'},{...report,checkedAt:1},{...report,reviewCount:1},
  {...report,activity:[],tradeCount:0},{...report,activity:[row,row],tradeCount:2},
  {...report,activity:[{...row,quoteRaw:'1'}]}])assert.throws(()=>advance({prior:old,report:r}));
 assert.equal(digest(old),before);
});
test('Source profile binding and per-event decisions are checked',()=>{
 assert.throws(()=>advance({report:{...report,profile:{...report.profile,token:wallet}}}),/profile/);
 assert.throws(()=>advance({report:{...report,activity:[{...row,decision:'sale-no-ticket-change'}]}}),/decision/);
 const old=advance();assert.throws(()=>advance({prior:old,report:{...report,profile:{...report.profile,excludedWallets:[quote]}}}),/identity/);
});
test('Pons rehearsal rejects a non-local provider before acquiring sender or signing',async()=>{
 let accessed=false;
 await assert.rejects(runDrawWorker({provider:{send:async()=>({clientVersion:'remote',chainId:4663})},
  pool:{connect:async()=>{accessed=true;throw Error('must not connect');}},ponsRehearsal:{load:async()=>report}}),/rehearsal-only/);
 assert.equal(accessed,false);
});
