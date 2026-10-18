import assert from 'node:assert/strict';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {collectHolderSnapshot,acceptFixtureSnapshot} from '../../src/holders/snapshot.mjs';
import {createHolderBook,applyHolderEvent,holderScopeId,replayHolderBook} from '../../src/holders/ledger.mjs';

const root='.local/test-results/holder-rehearsal-'+new Date().toISOString().replace(/[:.]/g,'-');
await mkdir(root,{recursive:true});
const address=n=>'0x'+n.toString(16).padStart(40,'0'),tx='0x'+'a'.repeat(64);
const scope={projectId:'holder-rehearsal',chainId:4663,token:address(100),asset:address(200)};
const policy={weight:'snapshot-balance',minimumPayment:'10',minimumHolding:'0',exclusions:[address(3)]};
const source={token:scope.token,holders:3,supply:'100',as_of:{rollup_bucket:1,tail_from_block:2},page:[{wallet:address(1),balance:'30'},{wallet:address(2),balance:'20'},{wallet:address(3),balance:'50',label:'curve'}],next_cursor:null};
const candidate=await collectHolderSnapshot({chainId:scope.chainId,token:scope.token,fetchPage:async()=>source,maxPages:1,maxHolders:3,observedAt:1});
const accepted=acceptFixtureSnapshot(candidate,{reason:'Synthetic rehearsal; not production eligibility'});
await writeFile(root+'/journal.json',JSON.stringify(createHolderBook(scope),null,2));
let steps=0;
// Reopen the file before every transition to model process restarts. Test-only single writer.
const append=async(id,type,fields)=>{
 const previous=JSON.parse(await readFile(root+'/journal.json','utf8'));
 const next=applyHolderEvent(previous,{id,type,scopeId:holderScopeId(previous),...fields});
 await writeFile(root+'/journal.tmp',JSON.stringify(next,null,2));await rename(root+'/journal.tmp',root+'/journal.json');
 steps++;return replayHolderBook(JSON.parse(await readFile(root+'/journal.json','utf8')));
};
for(const id of ['first','second']){
 await append('fund-'+id,'credit',{receiptId:'fixture-fee-'+id,amount:'10'});
 await append('round-'+id,'round',{roundId:id,periodId:'month-'+id,budget:'10',policy,accepted});
}
let state=await append('prepare','payout.prepare',{payoutId:'first-payment',roundId:'second',wallet:address(1),amount:'12'});
assert.equal(state.accounts[address(2)].owed,'8');assert.equal(state.reserved,'12');
await append('submit','payout.submit',{payoutId:'first-payment',txHash:tx});
state=await append('lost-response','payout.unknown',{payoutId:'first-payment'});
assert.equal(state.paid,'0');assert.equal(state.reserved,'12');
await assert.rejects(append('duplicate-payment','payout.prepare',{payoutId:'duplicate',roundId:'second',wallet:address(1),amount:'12'}));
const evidence={mode:'fixture-only',finalized:true,success:true,chainId:4663,asset:scope.asset,wallet:address(1),amount:'12',txHash:tx};
state=await append('confirmed','payout.resolve',{payoutId:'first-payment',evidence});
const repeated=await append('confirmed','payout.resolve',{payoutId:'first-payment',evidence});assert.deepEqual(repeated,state);
assert.equal(state.received,'20');assert.equal(state.paid,'12');assert.equal(state.owed,'8');assert.equal(state.available,'0');assert.equal(state.reserved,'0');
const report={status:'PASS',steps,checks:['two rounds','wallet dust carry','disk reopen at every step','unknown result holds reserve','duplicate payment rejected','confirmation replay is idempotent','fund conservation'],state,limits:['Synthetic snapshots and payment evidence','No signer, RPC, real transfers or production persistence','File writer is a single-process test helper, not a concurrent storage adapter']};
await writeFile(root+'/report.json',JSON.stringify(report,null,2));console.log('PASS holder rehearsal: '+root+'/report.json');
