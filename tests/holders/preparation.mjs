import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createTestPostgres} from '../contracts/production-postgres.mjs';
import {createPool,inProject} from '../../server/shared/store.mjs';
import {registerHolderPreparation,appendHolderPreparation,readHolderPreparation,collectHolderPreparation} from '../../server/shared/holder-preparation.mjs';
import {createHolderProgram,applyHolderProgramEvent,replayHolderProgram,previewHolderProgram,HOLDER_PERIOD_SECONDS as period} from '../../src/holders/program.mjs';
import {collectHolderSnapshot,acceptFixtureSnapshot} from '../../src/holders/snapshot.mjs';
import {identity} from '../../src/holders/values.mjs';

const root='.local/test-results/holder-preparation-'+new Date().toISOString().replace(/[:.]/g,'-');
await mkdir(root,{recursive:true});
const a=n=>'0x'+n.toString(16).padStart(40,'0');
const p='11111111-1111-4111-8111-111111111111',q='22222222-2222-4222-8222-222222222222';
const scope={projectId:p,chainId:31337,token:a(100),asset:a(0)},now=100+period;
const program=createHolderProgram({scope,launchAt:100,minimumPayment:'10',exclusions:[a(3)],preset:'pw-v1-60-20-20'});
const event=(id,type,fields={})=>({id,type,scopeId:identity(scope),...fields});
const receipt=(id,type,amount)=>event(id,type,{amount,evidence:{mode:'fixture-only',finalized:true,scope,amount,receiptId:id}});
const fee=receipt('fee-1','fee.received','101'),deposit=receipt('deposit-1','holder.deposited','60');
const candidate=await collectHolderSnapshot({chainId:scope.chainId,token:scope.token,observedAt:now,maxPages:1,maxHolders:3,fetchPage:async()=>({token:scope.token,holders:3,supply:'100',as_of:{rollup_bucket:1,tail_from_block:2},page:[{wallet:a(1),balance:'30'},{wallet:a(2),balance:'20'},{wallet:a(3),balance:'50'}],next_cursor:null})});
const observation=event('snapshot-1','snapshot.observed',{candidate});
const round=event('round-1','round.fixture',{period:1,now,budget:'60',accepted:acceptFixtureSnapshot(candidate,{reason:'Synthetic integration rehearsal'})});
const checks=[];
const test=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
let db,reader;
try{
 await test('Exact cumulative split, separate delivery, and receipt replay',()=>{
  let b=applyHolderProgramEvent(program,fee);
  assert.deepEqual(replayHolderProgram(b).fees,{received:'101',holders:'60',draw:'20',project:'20',roundingReserve:'1',holderDelivered:'0',holderUndelivered:'60'});
  assert.equal(replayHolderProgram(b).ledger.available,'0');
  assert.throws(()=>applyHolderProgramEvent(b,receipt('too-much','holder.deposited','61')));
  assert.throws(()=>applyHolderProgramEvent(b,{...fee,id:'alias'}));
  assert.throws(()=>applyHolderProgramEvent(b,{...deposit,evidence:{...deposit.evidence,mode:'production'}}));
  assert.throws(()=>applyHolderProgramEvent(b,{...deposit,evidence:{...deposit.evidence,scope:{...scope,asset:a(9)}}}));
  b=applyHolderProgramEvent(b,deposit);assert.equal(replayHolderProgram(b).ledger.available,'60');
  assert.deepEqual(applyHolderProgramEvent(b,deposit),b);
  let small=program;for(let i=0;i<101;i++)small=applyHolderProgramEvent(small,receipt('tiny-'+i,'fee.received','1'));
  assert.equal(replayHolderProgram(small).fees.holders,'60');
 });
 await test('Snapshot estimates never imply production acceptance or mutate balances',()=>{
  const b=[fee,deposit,observation].reduce(applyHolderProgramEvent,program),before=identity(b);
  const preview=previewHolderProgram(b,{now,candidateId:candidate.id});
  assert.equal(preview.executionEnabled,false);assert.equal(preview.eligibleCount,2);
  assert.deepEqual(preview.estimates.map(h=>h.newEntitlement),['36','24']);
  assert.ok(preview.blockers.includes('snapshot-atomicity-unverified'));assert.equal(identity(b),before);
  assert.ok(previewHolderProgram(b,{now:100,candidateId:candidate.id}).blockers.includes('period-not-due'));
  const pending={...b,minimumPayment:null};
  assert.ok(previewHolderProgram(pending,{now}).blockers.includes('minimum-payment-not-approved'));
  assert.throws(()=>applyHolderProgramEvent(pending,round));
  assert.throws(()=>applyHolderProgramEvent(b,{...round,now:100}));
  assert.throws(()=>applyHolderProgramEvent(b,{...round,period:2}));
  const done=applyHolderProgramEvent(b,round);assert.equal(replayHolderProgram(done).ledger.owed,'60');
  assert.throws(()=>applyHolderProgramEvent(done,{...round,id:'round-alias'}));
 });
 db=await createTestPostgres(root+'/postgres');
 await db.admin.query("INSERT INTO launchpad.projects VALUES($1,'holder-alpha','Alpha',31337,$3,'test'),($2,'holder-beta','Beta',31337,$4,'test')",[p,q,a(100),a(200)]);
 await test('Registration binds project, token, chain, asset and immutable configuration',async()=>{
  await registerHolderPreparation(db.pools.jobs,program);await registerHolderPreparation(db.pools.jobs,program);
  await assert.rejects(registerHolderPreparation(db.pools.jobs,{...program,minimumPayment:'11'}));
  await assert.rejects(registerHolderPreparation(db.pools.jobs,{...program,scope:{...scope,token:a(200)}}));
  await registerHolderPreparation(db.pools.jobs,createHolderProgram({...program,scope:{...scope,projectId:q,token:a(200)}}));
 });
 await test('Concurrent identical receipts commit once; conflicting retries and stale revisions fail',async()=>{
  const results=await Promise.all(Array.from({length:8},()=>appendHolderPreparation(db.pools.jobs,scope,fee,{expectedRevision:0})));
  assert.equal(results.filter(r=>!r.replayed).length,1);
  await assert.rejects(appendHolderPreparation(db.pools.jobs,scope,{...fee,amount:'102'}));
  await assert.rejects(appendHolderPreparation(db.pools.jobs,scope,deposit,{expectedRevision:0}));
  assert.equal((await readHolderPreparation(db.pools.api,scope,{now})).revision,1);
  await appendHolderPreparation(db.pools.jobs,scope,deposit,{expectedRevision:1});
  await collectHolderPreparation(db.pools.jobs,scope,{eventId:observation.id,fetchPage:async()=>candidate.pages[0].response,maxPages:1,maxHolders:3,observedAt:now});
  await assert.rejects(collectHolderPreparation(db.pools.jobs,scope,{eventId:'failed-source',fetchPage:async()=>{throw Error('source unavailable');},maxPages:1,maxHolders:3,observedAt:now+1}));
  assert.equal((await readHolderPreparation(db.pools.api,scope,{now,candidateId:candidate.id})).revision,3);
  const results2=await Promise.allSettled([appendHolderPreparation(db.pools.jobs,scope,round),appendHolderPreparation(db.pools.jobs,scope,{...round,id:'duplicate-round'})]);
  assert.equal(results2.filter(r=>r.status==='fulfilled').length,1);
 });
 await test('Fresh DB connection restores balances; API read cannot write; RLS isolates projects',async()=>{
  reader=createPool(db.url('lp_api'));
  const restored=await readHolderPreparation(reader,scope,{now:now+period,candidateId:candidate.id});
  assert.equal(restored.preview.ledger.owed,'60');assert.equal(restored.preview.ledger.available,'0');
  assert.equal(restored.preview.fees.holderDelivered,'60');assert.equal(restored.preview.period,2);
  assert.ok(restored.preview.blockers.includes('snapshot-outside-period-window'));
  assert.equal((await reader.query('SELECT * FROM launchpad.holder_preparations')).rowCount,0);
  assert.equal((await inProject(reader,p,c=>c.query('SELECT * FROM launchpad.holder_preparations WHERE project_id=$1',[q]))).rowCount,0);
  await assert.rejects(appendHolderPreparation(reader,scope,receipt('forbidden','fee.received','1')));
  await assert.rejects(inProject(db.pools.jobs,p,c=>c.query('INSERT INTO launchpad.holder_preparations VALUES($1,$2,0,$3,$4)',[q,'foreign','{}','bad']),{readOnly:false}));
  assert.equal((await readHolderPreparation(db.pools.api,{...scope,projectId:q,token:a(200)},{now})).preview.fees.received,'0');
  await reader.end();reader=null;
 });
 await test('Corrupted persisted journal is rejected instead of displaying cached balances',async()=>{
  await db.admin.query("UPDATE launchpad.holder_preparations SET body_hash='bad' WHERE project_id=$1",[p]);
  await assert.rejects(readHolderPreparation(db.pools.api,scope,{now}),/checksum/);
 });
 await writeFile(root+'/report.json',JSON.stringify({status:'PASS',checks,limits:['Local isolated PostgreSQL only','Synthetic receipts and explicit fixture snapshot acceptance','No signer, RPC, production migration or transfers']},null,2));
 console.log('Report: '+root+'/report.json');
}finally{await reader?.end();await db?.close();}
