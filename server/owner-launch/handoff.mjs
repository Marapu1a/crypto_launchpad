import {inProject,verifyRole} from '../shared/store.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {UUID} from '../../src/launch/template.mjs';
import {validateRuntimeConfig,privateText} from '../short-runtime/config.mjs';
import {loadExecutorKeystore} from '../../src/worker/executor-keystore.mjs';
import {check,same} from './store.mjs';

// Preparation only: no provider, signer transport, DB writes or service activation.
export function createRuntimeHandoff({pool,apiPool,profile,runtime,keys={},baseDomain,loadKey=loadExecutorKeystore,readSecret=privateText}){
 check(typeof baseDomain==='string'&&/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(baseDomain)&&baseDomain.length<=200,'Invalid site base domain');
 return async projectId=>{
  check(UUID.test(projectId),'Invalid launch ID');await verifyRole(pool,'lp_executor');await verifyRole(apiPool,'lp_api');
  const source=await inProject(pool,projectId,async c=>{
   const {rows:[row]}=await c.query(`SELECT l.owner_address,l.state_text,l.state_hash,p.slug,p.token_address,
    s.policy_text,s.policy_hash,m.config_hash,m.program_address,m.adapter_version
    FROM launchpad.owner_launches l JOIN launchpad.projects p ON p.id=l.project_id
    JOIN launchpad.module_instances m ON m.project_id=p.id AND m.id=p.id
    JOIN launchpad.production_senders s ON s.project_id=p.id AND s.module_id=m.id
    WHERE l.project_id=$1`,[projectId]);
   check(row&&same(row.owner_address,profile.owner),'Registered launch for this owner required');
   const state=JSON.parse(row.state_text),policy=JSON.parse(row.policy_text),v2=runtime.schema==='draw-runtime-config-v2';
   check(digest(state)===row.state_hash&&state.stage===(v2?'deployed':'registered')&&state.schema===(v2?'owner-launch-v2':'owner-launch-v1')&&state.input.id===projectId&&state.profileHash===digest(profile),'Registered journal checksum');
   check(digest(policy)===row.policy_hash&&digest(state.policy)===row.policy_hash&&row.config_hash===row.policy_hash&&policy.projectId===projectId,'Registered policy mismatch');
   check(row.adapter_version===(v2?'draw-candidate-v2':'production-candidate-v1')&&row.slug===state.input.slug&&same(row.token_address,state.launch.token)&&same(row.program_address,policy.contracts[v2?'fundingRouter':'program'].address),'Registered project mismatch');
   return {state,policy,hash:row.policy_hash,slug:row.slug};
  });
  const {state,policy,hash,slug}=source,hostname=slug+'.'+baseDomain;
  const {rows:[domain]}=await apiPool.query('SELECT launchpad.resolve_host($1) AS id',[hostname]);
  check(!domain?.id||domain.id===projectId,'Site domain belongs to another project');
  const credentials=keys[projectId],checks=[];let config=null;
  if(credentials){
   const entry={projectId,moduleId:projectId,policyHash:hash,enabled:false};
   for(const role of ['executor','publisher']){
    entry[role]={keyFile:credentials[role]?.keyFile,passwordFile:credentials[role]?.passwordFile};
   }
   // Never inherit another project's entry or an existing activation flag.
   const base=Object.fromEntries(['schema','mode','instanceId','intervalMs','concurrency','rpcFile','databaseFile','healthFile'].map(k=>[k,runtime[k]]));
   config=validateRuntimeConfig({...base,allowPublicTransactions:false,projects:[entry]});
   check(config.mode===profile.mode&&(config.mode!=='rehearsal'||config.instanceId===profile.instanceId),'Rehearsal instance binding required');
   for(const role of ['executor','publisher']){
    let ready=false;try{await loadKey({file:entry[role].keyFile,password:await readSecret(entry[role].passwordFile),expectedAddress:policy[role]});ready=true;}catch{}
    checks.push({role,address:policy[role],ready});
   }
  }else for(const role of ['executor','publisher'])checks.push({role,address:policy[role],ready:false});
  return {projectId,policyHash:hash,activation:'disabled',credentials:checks,config,
   site:{hostname,url:'https://'+hostname,registered:domain?.id===projectId},
   prepared:checks.every(c=>c.ready),approvalRequired:true};
 };
}
