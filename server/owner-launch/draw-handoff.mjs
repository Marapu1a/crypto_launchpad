import {withOwnerLaunch,check,same} from './store.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {verifyDrawPolicy} from '../../src/worker/draw-policy.mjs';
import {registerDrawSender} from '../shared/draw-sender.mjs';
import {inProject} from '../shared/store.mjs';
// Internal explicit handoff. Registers state, never starts a service or sends a transaction.
export async function registerDeployedDraw({pool,adminPool,provider,projectId,owner}){
 return withOwnerLaunch({pool,projectId,owner},async({state:s,save})=>{
  check(s?.schema==='owner-launch-v2'&&s.stage==='deployed'&&s.policy,'Completed v2 launch required');
  const policy=s.policy;check(policy.projectId===projectId&&same(policy.contracts.token.address,s.launch.token),'Launch policy mismatch');
  await verifyDrawPolicy(provider,policy);
  const c=await adminPool.connect();
  try{await c.query('BEGIN');await c.query("SELECT set_config('launchpad.project_id',$1,true)",[projectId]);
   await c.query("INSERT INTO launchpad.projects VALUES($1,$2,$3,4663,$4,'test') ON CONFLICT(id) DO NOTHING",[projectId,s.input.slug,s.input.draft.name,s.launch.token.toLowerCase()]);
   const row=(await c.query('SELECT * FROM launchpad.projects WHERE id=$1',[projectId])).rows[0];
   check(row.slug===s.input.slug&&row.display_name===s.input.draft.name&&same(row.token_address,s.launch.token)&&String(row.chain_id)==='4663'&&row.status==='test','Project conflict');
   await c.query("INSERT INTO launchpad.module_instances VALUES($1,$1,'draw','draw-candidate-v2',$2,$3) ON CONFLICT DO NOTHING",[projectId,policy.contracts.fundingRouter.address.toLowerCase(),digest(policy)]);
   const m=(await c.query('SELECT * FROM launchpad.module_instances WHERE project_id=$1 AND id=$1',[projectId])).rows[0];
   check(m.kind==='draw'&&m.adapter_version==='draw-candidate-v2'&&m.config_hash===digest(policy)&&same(m.program_address,policy.contracts.fundingRouter.address),'Module conflict');
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const existing=await inProject(pool,projectId,async c=>(await c.query('SELECT policy_hash FROM launchpad.production_senders WHERE project_id=$1 AND module_id=$1',[projectId])).rows[0]);
  if(existing)check(existing.policy_hash===digest(policy),'Sender conflict');else await registerDrawSender({pool,provider,projectId,moduleId:projectId,policy});
  s.workerRegistration={moduleId:projectId,policyHash:digest(policy),enabled:false};await save(s);
  return s.workerRegistration;
 });
}
