import {ZeroAddress} from 'ethers';
import {serviceFundingLogs} from '../../src/holders/service-funding.mjs';
import {createPonsService} from './pons-service.mjs';
import {drawServiceObservation} from './pons-draw-service.mjs';
import {runDrawWorker} from './draw-worker.mjs';
import {runDrawSender} from './draw-sender.mjs';
import {inProject} from './store.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {check} from '../../src/holders/values.mjs';
import {importHolderFunding} from './holder-preparation.mjs';
import {serviceGasBudget} from './service-gas-budget.mjs';

export async function readPwService(pool,projectId){
 return inProject(pool,projectId,async c=>{
  const {rows:[row]}=await c.query('SELECT policy_text,policy_hash,state_text,state_hash FROM launchpad.production_senders WHERE project_id=$1 AND module_id=$1',[projectId]);
  check(row,'Missing PW sender');const policy=JSON.parse(row.policy_text),state=JSON.parse(row.state_text);
  check(digest(policy)===row.policy_hash&&digest(state)===row.state_hash&&policy.schema==='pw-service-policy-v1'&&policy.projectId===projectId,'PW sender checksum/scope mismatch');
  return {policy,state};
 });
}
// Import only finalized, journaled funding receipts. Commit cursor after the
// idempotent holder import: a crash between the two cannot duplicate credit.
export async function syncPwHolderFunding(input){
 check(input.jobsPool,'PW holder import pool required');
 return runDrawSender({...input,operate:async({policy,state,save})=>{
  check(policy.schema==='pw-service-policy-v1','PW import policy required');
  const scope={projectId:policy.projectId,chainId:4663,token:policy.contracts.token.address.toLowerCase(),asset:ZeroAddress};
  let cursor=state.runtime?.holderFundingCursor??0;
  check(Number.isSafeInteger(cursor)&&cursor>=0&&cursor<=state.history.length,'PW funding cursor mismatch');
  const end=Math.min(cursor+20,state.history.length);
  for(;cursor<end;cursor++){
   const h=state.history[cursor];
   if(h.receiptStatus===1&&/:(collector\.forward|splitter\.deliver)$/.test(h.action)){
    const r=await input.provider.getTransactionReceipt(h.hash);
    const logs=serviceFundingLogs(policy,h,await input.provider.getTransaction(h.hash),r);
    check((await input.provider.getBlock('finalized'))?.number>=h.blockNumber&&(await input.provider.getBlock(h.blockNumber))?.hash===h.blockHash,'PW funding finality changed');
    for(const l of logs)await importHolderFunding(input.jobsPool,scope,{provider:input.provider,txHash:r.hash,logIndex:l.index});
    check((await input.provider.getBlock(h.blockNumber))?.hash===h.blockHash,'PW funding receipt changed before cursor');
   }
   state.runtime.holderFundingCursor=cursor+1;await save(state);
  }
  return {caughtUp:cursor===state.history.length,cursor};
 }});
}
export async function runPwWorker(input){
 const before=await syncPwHolderFunding(input);
 if(before.status==='busy')return before;
 if(!before.caughtUp)return {status:'waiting',reason:'holder-funding-import'};
 const result=await runDrawWorker({...input,pw:true});
 const after=await syncPwHolderFunding(input);
 if(after.status==='busy'||!after.caughtUp)return {status:'waiting',reason:'holder-funding-import'};
 return result;
}
export function createPwService(input,options={}){
 check(typeof input.ponsRehearsal?.load==='function','PW Pons source required');
 const tick=createPonsService({...options,now:options.now??(input.now?()=>input.now()*1000:Date.now),loadReport:()=>input.ponsRehearsal.load(),observe:drawServiceObservation,
  run:({report,sourceError})=>runPwWorker({...input,ponsRehearsal:{load:async()=>{if(sourceError)throw sourceError;return report;}}})});
 return async()=>{
  const result=await tick(),{policy}=await readPwService(input.pool,input.projectId);
  if(!policy.gasBudget)return result;
  const {pending,...gasBudget}=await serviceGasBudget(input.pool,policy.gasBudget).snapshot();
  return {...result,gasBudget};
 };
}
