import {Contract,keccak256,ZeroAddress} from 'ethers';
import {digest} from '../../src/tickets/digest.mjs';
import {identity,check} from '../../src/holders/values.mjs';
import {validatePwPolicy,verifyPwPolicy} from '../../src/worker/pw-policy.mjs';
import {registerDrawSender} from '../shared/draw-sender.mjs';
import {inProject} from '../shared/store.mjs';
import {ownerFinality} from './confirmation.mjs';

export function pwServiceTemplate(preparation,instance){
 return {instanceId:instance,config:{asset:'ETH',ticketPurchase:preparation.draw.ticketPurchase,short:{enabled:true,intervalSeconds:preparation.draw.intervalSeconds,minimumFund:preparation.draw.minimumFund,basket:{weights:preparation.draw.prizeWeights,minimumUnit:preparation.draw.minimumUnit}},monthly:{enabled:false}}};
}
export async function preparePwServiceHandoff({coordinator,projectId,provider,profile,preparation,limits}){
 const s=await coordinator.read(projectId),info=coordinator.info();
 check(info.profileHash===identity(profile)&&info.preparationHash===identity(preparation),'Service handoff differs from launch');
 check(s.stage==='deployed'&&(await ownerFinality(provider,s.history)).ready,'Finalized PW graph required');
 const adapter=await new Contract(s.addresses.draw,['function randomness() view returns(address)'],provider).randomness();
 const last=s.history.at(-1),contracts={...profile.externals,...s.contracts,short:s.contracts.draw,shortAdapter:{address:adapter,codeHash:keccak256(await provider.getCode(adapter))}};
 delete contracts.draw;
 const production=profile.mode==='production';
 const policy=validatePwPolicy({schema:'pw-service-policy-v1',mode:production?'production':'rehearsal',...(production?{environment:profile}:{instanceId:profile.instanceId}),chainId:4663,projectId,owner:profile.owner,executor:profile.executor,publisher:profile.publisher,project:profile.project,buildHash:info.buildHash,anchor:{number:last.blockNumber,hash:last.blockHash},launchAt:s.launchAt,limits,timing:profile.timing,contracts,template:pwServiceTemplate(preparation,s.instance)});
 await verifyPwPolicy(provider,policy);return {policy,policyHash:digest(policy),enabled:false};
}

export async function registerPwServiceHandoff({pool,adminPool,provider,...options}){
 const prepared=await preparePwServiceHandoff({...options,provider}),{policy}=prepared,id=policy.projectId;
 const c=await adminPool.connect();
 try{
  await c.query('BEGIN');await c.query("SELECT set_config('launchpad.project_id',$1,true)",[id]);
  const {rows:[project]}=await c.query('SELECT * FROM launchpad.projects WHERE id=$1',[id]);
  check(project&&project.token_address===policy.contracts.token.address.toLowerCase()&&String(project.chain_id)==='4663','Register matching PW holder/project handoff first');
  const scope={projectId:id,chainId:4663,token:policy.contracts.token.address.toLowerCase(),asset:ZeroAddress};
  const {rows:[holder]}=await c.query('SELECT body,body_hash FROM launchpad.holder_preparations WHERE project_id=$1 AND scope_id=$2',[id,identity(scope)]);
  check(holder&&identity(holder.body)===holder.body_hash&&holder.body.fundingPolicy?.vault.address.toLowerCase()===policy.contracts.vault.address.toLowerCase()&&holder.body.fundingPolicy?.splitter.address.toLowerCase()===policy.contracts.splitter.address.toLowerCase(),'Matching holder funding registration required');
  await c.query("INSERT INTO launchpad.module_instances VALUES($1,$1,'draw','pw-service-v1',$2,$3) ON CONFLICT DO NOTHING",[id,policy.contracts.short.address.toLowerCase(),digest(policy)]);
  const {rows:[m]}=await c.query('SELECT * FROM launchpad.module_instances WHERE project_id=$1 AND id=$1',[id]);
  check(m.kind==='draw'&&m.adapter_version==='pw-service-v1'&&m.config_hash===digest(policy)&&m.program_address===policy.contracts.short.address.toLowerCase(),'PW service module conflict');
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 const existing=await inProject(pool,id,async c=>(await c.query('SELECT policy_hash FROM launchpad.production_senders WHERE project_id=$1 AND module_id=$1',[id])).rows[0]);
 if(existing)check(existing.policy_hash===digest(policy),'PW sender policy conflict');else await registerDrawSender({pool,provider,projectId:id,moduleId:id,policy});
 return prepared;
}
