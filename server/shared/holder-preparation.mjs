import {inProject} from './store.mjs';
import {check,identity,scope} from '../../src/holders/values.mjs';
import {applyHolderProgramEvent,previewHolderProgram,replayHolderProgram} from '../../src/holders/program.mjs';
import {collectHolderSnapshot} from '../../src/holders/snapshot.mjs';
import {observeHolderFunding} from '../../src/holders/funding-receipt.mjs';

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
export async function appendHolderPreparation(pool,input,event,{expectedRevision}={}){
 const instance=scope(input),id=identity(instance);
 return inProject(pool,instance.projectId,async c=>{
  await binding(c,instance);
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_preparations WHERE project_id=$1 AND scope_id=$2 FOR UPDATE',[instance.projectId,id]);
  const previous=decode(row);check(identity(previous.scope)===id,'Stored holder scope mismatch');
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
 return appendHolderPreparation(pool,instance,event);
}
