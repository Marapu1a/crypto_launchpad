import {Contract} from 'ethers';
import {identity,address,check} from '../../src/holders/values.mjs';
import {createHolderProgram} from '../../src/holders/program.mjs';
import {validateExecutionPolicy} from '../../src/holders/execution.mjs';
import {registerHolderPreparation} from '../shared/holder-preparation.mjs';
import {registerHolderExecution} from '../shared/holder-execution.mjs';
import {ownerFinality} from './confirmation.mjs';
import {pwGasBudget} from '../../src/worker/service-gas-budget.mjs';

// The caller supplies a trusted coordinator, not a public JSON launch manifest.
// Exclusions, snapshot budgets and the reviewed token runtime remain explicit.
export async function preparePwHolderHandoff({coordinator,projectId,provider,profile,preparation,settings,monthlyGasBudgetWei}){
 const s=await coordinator.read(projectId);
 const info=coordinator.info();
 check(info.profileHash===identity(profile)&&info.preparationHash===identity(preparation),'Handoff profile differs from launch');
 check(s.stage==='deployed'&&(await ownerFinality(provider,s.history)).ready,'Finalized PW launch required');
 const production=profile.mode==='production';
 check(production?profile.id===projectId:profile.mode==='pw-fork-rehearsal','PW handoff mode required');
 check(settings?.tokenCodeHash===s.contracts.token.codeHash,'Reviewed PW token runtime required');
 check(Array.isArray(settings.exclusions)&&settings.exclusions.some(w=>address(w)===address(s.curve)),'Explicit exclusions must include curve');
 const scope=s.scope,scopeId=identity(scope),fromBlock=s.history[0].blockNumber;
 const fundingPolicy={schema:'holder-funding-observer-v1',scopeId,instance:s.instance,fromBlock,project:address(profile.project)};
 for(const role of ['vault','splitter','collector','draw'])fundingPolicy[role]=s.contracts[role];
 const snapshotPolicy={schema:'holder-snapshot-policy-v1',scopeId,semantics:'reviewed-nonproxy-erc20-supply-sum',tokenCodeHash:settings.tokenCodeHash,maxHolders:settings.maxHolders,maxRpcCalls:settings.maxRpcCalls,maxAgeSeconds:settings.maxAgeSeconds};
 const program=createHolderProgram({scope,launchAt:s.launchAt,minimumPayment:preparation.holders.minimumPaymentRaw,exclusions:settings.exclusions,preset:'pw-v1-60-20-20',schedulePolicy:'first-accepted-carry-v1',fundingPolicy,snapshotPolicy});
 const gasBudget=production||monthlyGasBudgetWei?pwGasBudget({...profile,id:projectId},s.launchAt,monthlyGasBudgetWei):undefined;
 const execution=validateExecutionPolicy({schema:production?'holder-execution-production-v1':'holder-execution-local-v2',executionEnabled:false,scopeId,...(gasBudget?{gasBudget}:{}),instance:s.instance,vault:s.addresses.vault,source:s.addresses.splitter,initialOwner:profile.owner,publisher:profile.publisher,minimumPayment:program.minimumPayment,codeHash:s.contracts.vault.codeHash,maxGasLimit:settings.maxGasLimit,maxFeePerGas:settings.maxFeePerGas,...(production?{nativeFloor:settings.nativeFloor,anchor:profile.anchor,timing:profile.timing}:{})},scope);
 const draw=new Contract(s.addresses.draw,['function randomness() view returns(address)'],provider);
 return {schema:'pw-holder-handoff-v1',scope,project:{slug:s.input.slug,name:s.input.draft.name},launchIdentity:s.identity,launchAt:s.launchAt,program,execution,draw:{address:s.addresses.draw,randomness:await draw.randomness(),ticketPurchase:preparation.draw.ticketPurchase,workerRegistered:false},executionEnabled:false};
}

export async function registerPwHolderHandoff({jobsPool,executorPool,adminPool,...options}){
 const handoff=await preparePwHolderHandoff(options);
 const c=await adminPool.connect();
 try{
  await c.query('BEGIN');await c.query("SELECT set_config('launchpad.project_id',$1,true)",[handoff.scope.projectId]);
  await c.query("INSERT INTO launchpad.projects VALUES($1,$2,$3,4663,$4,'test') ON CONFLICT(id) DO NOTHING",[handoff.scope.projectId,handoff.project.slug,handoff.project.name,handoff.scope.token]);
  const {rows:[p]}=await c.query('SELECT * FROM launchpad.projects WHERE id=$1',[handoff.scope.projectId]);
  check(p.slug===handoff.project.slug&&p.display_name===handoff.project.name&&p.token_address===handoff.scope.token&&String(p.chain_id)==='4663'&&p.status==='test','PW project registration conflict');
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 // Both registrations are idempotent, so interruption between them is recoverable.
 await registerHolderPreparation(jobsPool,handoff.program);
 await registerHolderExecution(executorPool,handoff.scope,handoff.execution,{provider:options.provider});
 return {...handoff,holderRegistered:true};
}
