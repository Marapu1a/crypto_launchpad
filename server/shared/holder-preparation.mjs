import {holderObservationWindow} from '../../src/holders/program.mjs';
import {inProject} from './store.mjs';
import {check,identity,scope} from '../../src/holders/values.mjs';
import {applyHolderProgramEvent,previewHolderProgram,replayHolderProgram,HOLDER_PERIOD_SECONDS} from '../../src/holders/program.mjs';
import {collectHolderSnapshot} from '../../src/holders/snapshot.mjs';
import {observeHolderFunding} from '../../src/holders/funding-receipt.mjs';
import {reconcileHolderFunding} from '../../src/holders/reconcile.mjs';
import {admitHolderSnapshot,recheckAdmissionBlock} from '../../src/holders/admission.mjs';
import {readHolderExecution,resumeHolderReconciliation} from './holder-execution.mjs';
import {observeExecution,recheckExecutionBlock} from '../../src/holders/execution.mjs';

async function binding(client,instance){
 const {rows:[p]}=await client.query('SELECT chain_id::text,token_address FROM launchpad.projects WHERE id=$1',[instance.projectId]);
 check(p&&p.chain_id===String(instance.chainId)&&p.token_address===instance.token,'Holder project binding mismatch');
}
function decode(row){
 check(row&&identity(row.body)===row.body_hash,'Holder journal missing or checksum mismatch');
 replayHolderProgram(row.body);return row.body;
}
export async function registerHolderPreparation(pool,program){
 replayHolderProgram(program);check(program.events.length===0,'Register an empty holder program');
 const instance=scope(program.scope),id=identity(instance);
 return inProject(pool,instance.projectId,async c=>{
  await binding(c,instance);
  await c.query('INSERT INTO launchpad.holder_preparations VALUES($1,$2,0,$3,$4) ON CONFLICT DO NOTHING',[instance.projectId,id,JSON.stringify(program),identity(program)]);
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_preparations WHERE project_id=$1 AND scope_id=$2',[instance.projectId,id]);
  const existing=decode(row);check(identity({...existing,events:[]})===identity(program),'Holder configuration already fixed');
  return {scopeId:id,revision:row.revision};
 },{readOnly:false});
}
export async function appendHolderPreparation(pool,input,event,options={}){
 return appendEvent(pool,input,event,options);
}
// Not exported: observed funding can only enter through the RPC importer below.
async function appendEvent(pool,input,event,{expectedRevision}={},verifyObserved){
 const instance=scope(input),id=identity(instance);
 return inProject(pool,instance.projectId,async c=>{
  await binding(c,instance);
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_preparations WHERE project_id=$1 AND scope_id=$2 FOR UPDATE',[instance.projectId,id]);
  const previous=decode(row);check(identity(previous.scope)===id,'Stored holder scope mismatch');
  if(event.type==='snapshot.admitted'){
   check(typeof verifyObserved==='function','Use trusted snapshot admission');await verifyObserved(previous);
  }
  if(event.type==='round.finalized'){
   check(typeof verifyObserved==='function','Use trusted period completion');await verifyObserved(previous);
  }
  if(previous.fundingPolicy){
   check(event.type!=='round.fixture','Fixture rounds forbidden for observed funding');
   if(['fee.received','holder.deposited'].includes(event.type)){
    check(typeof verifyObserved==='function','Use trusted funding importer');
    await verifyObserved(previous);
   }
  }
  const next=applyHolderProgramEvent(previous,event);
  if(identity(next)===identity(previous))return {revision:row.revision,replayed:true};
  check(expectedRevision===undefined||expectedRevision===row.revision,'Holder revision conflict');
  const revision=row.revision+1;
  await c.query('UPDATE launchpad.holder_preparations SET revision=$3,body=$4,body_hash=$5 WHERE project_id=$1 AND scope_id=$2',[instance.projectId,id,revision,JSON.stringify(next),identity(next)]);
  return {revision,replayed:false};
 },{readOnly:false});
}
export async function readHolderPreparation(pool,input,options){
 const instance=scope(input),id=identity(instance);
 return inProject(pool,instance.projectId,async c=>{
  await binding(c,instance);
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_preparations WHERE project_id=$1 AND scope_id=$2',[instance.projectId,id]);
  const program=decode(row);check(identity(program.scope)===id,'Stored holder scope mismatch');
  return {revision:row.revision,preview:previewHolderProgram(program,options)};
 });
}

// Bounded, on-demand ingestion with caller-owned transport. No polling or acceptance.
// Persist only complete candidates; a failed fetch leaves all prior evidence intact.
export async function collectHolderPreparation(pool,input,{eventId,fetchPage,maxPages,maxHolders,observedAt}){
 const instance=scope(input);
 const candidate=await collectHolderSnapshot({chainId:instance.chainId,token:instance.token,fetchPage,maxPages,maxHolders,observedAt});
 const result=await appendHolderPreparation(pool,instance,{id:eventId,scopeId:identity(instance),type:'snapshot.observed',candidate});
 return {...result,candidateId:candidate.id,atomicity:candidate.atomicity};
}

export async function importHolderFunding(pool,input,{provider,txHash,logIndex}){
 const instance=scope(input),scopeId=identity(instance);
 const policy=await inProject(pool,instance.projectId,async c=>{
  await binding(c,instance);
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_preparations WHERE project_id=$1 AND scope_id=$2',[instance.projectId,scopeId]);
  const program=decode(row);check(program.fundingPolicy,'Pinned funding policy required');return program.fundingPolicy;
 });
 const event=await observeHolderFunding({provider,policy,scope:instance,txHash,logIndex});
 return appendEvent(pool,instance,event,{},async previous=>{
  check(identity(previous.fundingPolicy)===identity(policy),'Funding policy changed');
  // The first pass validated logs and immutable bindings at this block. Recheck
  // its canonical/finalized identity under the lock, without repeating every getter.
  const finalized=await provider.getBlock('finalized');
  check(finalized&&finalized.number>=event.evidence.blockNumber,'Funding finality regressed before commit');
  check((await provider.getBlock(event.evidence.blockNumber))?.hash===event.evidence.blockHash,'Funding receipt reorg before commit');
 });
}

export async function reconcileHolderPreparation(pool,input,{provider,maxEvents}={}){
 const instance=scope(input),id=identity(instance);
 const saved=await inProject(pool,instance.projectId,async c=>{
  await binding(c,instance);
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_preparations WHERE project_id=$1 AND scope_id=$2',[instance.projectId,id]);
  return {program:decode(row),revision:row.revision};
 });
 const result=await reconcileHolderFunding(saved.program,provider,{maxEvents});
 return inProject(pool,instance.projectId,async c=>{
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_preparations WHERE project_id=$1 AND scope_id=$2',[instance.projectId,id]);
  check(row?.revision===saved.revision&&identity(decode(row))===result.programHash,'Holder journal changed during reconciliation');
  return {...result,revision:saved.revision};
 });
}

// Intended pre-allocation read path. Still does not accept snapshots or authorize payouts.
export async function readReconciledHolderPreparation(pool,input,{provider,maxEvents,...options}){
 const reconciliation=await reconcileHolderPreparation(pool,input,{provider,maxEvents});
 const result=await readHolderPreparation(pool,input,options);
 check(result.revision===reconciliation.revision,'Holder journal changed after reconciliation');
 return {...result,reconciliation,preview:{...result.preview,blockers:result.preview.blockers.filter(b=>b!=='funding-reconciliation-required')}};
}

export async function admitHolderPreparation(pool,input,{provider,candidateId,now}){
 const instance=scope(input),id=identity(instance);
 const saved=await inProject(pool,instance.projectId,async c=>{
  await binding(c,instance);
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_preparations WHERE project_id=$1 AND scope_id=$2',[instance.projectId,id]);
  return {program:decode(row),revision:row.revision};
 });
 const state=replayHolderProgram(saved.program),period=state.lastPeriod+1;
 const existing=state.admissions[period];
 if(existing){
  check(existing.candidateId===candidateId,'Holder period already admitted');
  await recheckAdmissionBlock(provider,existing);
  return appendEvent(pool,instance,{id:'snapshot-admission:'+period,type:'snapshot.admitted',scopeId:id,proof:existing},{expectedRevision:saved.revision},()=>recheckAdmissionBlock(provider,existing));
 }
 const candidate=state.candidates.find(c=>c.id===candidateId);check(candidate,'Stored candidate required');
 const window=holderObservationWindow(saved.program,state,now);
 const result=await admitHolderSnapshot({provider,candidate,policy:saved.program.snapshotPolicy,scope:instance,period,dueAt:window.dueAt,until:window.until,now});
 const event={id:'snapshot-admission:'+period,type:'snapshot.admitted',scopeId:id,proof:result.proof};
 const written=await appendEvent(pool,instance,event,{expectedRevision:saved.revision},async previous=>{
  check(identity(previous.snapshotPolicy)===identity(saved.program.snapshotPolicy),'Snapshot policy changed');
  await recheckAdmissionBlock(provider,result.proof);
 });
 return {...written,rpcCalls:result.rpcCalls+2};
}

// Separate job/executor roles: jobs cannot fabricate execution receipts or read raw bytes.
export async function advanceHolderPeriod(jobsPool,executorPool,input,{provider,period,reconciliationMaxItems=50}){
 const instance=scope(input),id=identity(instance);
 const reconciliation=await resumeHolderReconciliation(executorPool,instance,{provider,reuseCompleted:true,maxItems:reconciliationMaxItems});
 check(reconciliation.status==='reconciled','Holder reconciliation in progress; resume before advancing period');
 const journal=await readHolderExecution(executorPool,instance),plan=journal.plans.find(p=>p.period===period);
 check(plan,'Stored allocation plan required');
 const seals=journal.transactions.filter(t=>t.body.period===period&&t.body.operation.kind==='seal'&&t.status==='succeeded');
 check(seals.length===1,'One finalized seal required');const seal=seals[0];
 const event={id:'round-finalized:'+period,scopeId:id,type:'round.finalized',period,snapshot:plan.snapshot,budget:plan.budget,allocated:plan.allocated,observation:seal.observation};
 return appendEvent(jobsPool,instance,event,{},async previous=>{
  const state=replayHolderProgram(previous),proof=state.admissions[period];
  check(proof&&plan.snapshot==='0x'+identity(proof),'Period admission changed');
  check(identity(await observeExecution(provider,journal.policy,instance,seal.body))===identity(seal.observation),'Period seal evidence changed');
  await recheckAdmissionBlock(provider,proof);await recheckExecutionBlock(provider,seal.observation.block);
 });
}
