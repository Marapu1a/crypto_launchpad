import {recoverHolderFunding} from '../server/shared/holder-funding-recovery.mjs';
import {preparePwServiceHandoff,registerPwServiceHandoff} from '../server/owner-launch/pw-service-handoff.mjs';
import {readFile} from 'node:fs/promises';
import {operatorRpc} from '../server/shared/rpc-policy.mjs';
import {privateText} from '../server/short-runtime/config.mjs';
import {createPool,verifyRole} from '../server/shared/store.mjs';
import {createPwOwnerCoordinator} from '../server/owner-launch/pw-coordinator.mjs';
import {preparePwHolderHandoff,registerPwHolderHandoff} from '../server/owner-launch/pw-handoff.mjs';
import {createPwHolderOperator} from '../server/shared/pw-holder-operator.mjs';
import {importHolderFunding,appendHolderPreparation,admitHolderPreparation,resumeHolderAdmission,advanceHolderPeriod} from '../server/shared/holder-preparation.mjs';
import {prepareHolderAllocation,scanHolderPayments} from '../server/shared/holder-execution.mjs';

const commands=['service-handoff-preview','service-handoff-register','launch-prepare','launch-read','launch-quote','launch-record','launch-broadcast','launch-resolve','handoff-preview','handoff-register','holder-quote','holder-reserve','holder-gas-budget','holder-record','holder-broadcast','holder-resolve','holder-reconcile','holder-scan','holder-funding','holder-recover-funding','holder-snapshot','holder-admit','holder-admit-page','holder-plan','holder-advance'];
if(process.argv.includes('--help')){
 console.log('node scripts/pw-operator.mjs PRIVATE_CONFIG COMMAND [PAYLOAD_JSON]\n'+commands.join('\n')+'\nNo keys or automatic signing. Sending defaults to disabled; config paths must be absolute.');
}else{
 let provider,usage;const pools={};let phase='configuration';
 try{
  const [, ,file,command,payload]=process.argv;
  if(!commands.includes(command))throw Error('Unknown command');
  const config=JSON.parse(await privateText(file));
  if(config.schema!=='pw-operator-v1'||config.profile?.mode!=='production'||typeof config.allowPublicTransactions!=='boolean')throw Error('Explicit production operator configuration required');
  const input=payload?JSON.parse(await readFile(payload,'utf8')):{};
  const preparation=JSON.parse(await readFile(new URL('../tokens/PatternWatcher/preparation.json',import.meta.url),'utf8'));
  phase='connections';({provider,usage}=await operatorRpc(await privateText(config.rpcFile),config));
  const pool=async role=>{
   if(!pools[role]){pools[role]=createPool(await privateText(config.databaseFiles[role]));if(role!=='admin')await verifyRole(pools[role],{executor:'lp_executor',jobs:'lp_jobs'}[role]);}
   return pools[role];
  };
  const executor=await pool('executor');
  const coordinator=createPwOwnerCoordinator({pool:executor,provider,profile:config.profile,preparation,allowPublicTransactions:config.allowPublicTransactions});
  const id=config.profile.id;let result;
  phase=command;
  if(command.startsWith('launch-')){
   const action=command.slice(7);
   result=action==='prepare'?await coordinator.prepare(input):action==='record'?await coordinator.record(id,(await privateText(input.rawFile)).trim()):await coordinator[action](id);
   // Signed bytes remain in the private DB; normal status output does not expose them.
   if(result?.pending)result={...result,pending:{kind:result.pending.kind,hash:result.pending.hash}};
  }else{
   const handoffOptions={coordinator,projectId:id,provider,profile:config.profile,preparation,settings:config.holders,monthlyGasBudgetWei:config.monthlyGasBudgetWei};
   if(command==='service-handoff-preview')result=await preparePwServiceHandoff({...handoffOptions,limits:config.serviceLimits});
   else if(command==='service-handoff-register')result=await registerPwServiceHandoff({...handoffOptions,limits:config.serviceLimits,pool:executor,adminPool:await pool('admin')});
   else if(command==='handoff-preview')result=await preparePwHolderHandoff(handoffOptions);
   else if(command==='handoff-register')result=await registerPwHolderHandoff({...handoffOptions,jobsPool:await pool('jobs'),executorPool:executor,adminPool:await pool('admin')});
   else{
    // Paged admission is read-only and verifies its own fixed-block token proof.
    // Do not rescan the entire deployment history before every 100 addresses.
    const state=command==='holder-admit-page'?await coordinator.inspect(id):await coordinator.read(id);if(state?.stage!=='deployed')throw Error('Completed PW launch required');
    const scope=state.scope,operator=createPwHolderOperator({pool:executor,provider,scope,allowPublicTransactions:config.allowPublicTransactions});
    switch(command){
     case 'holder-quote':result=await operator.quote(input.period,input.operation);break;
     case 'holder-reserve':result=await operator.reserve(input.period,input.operation);break;
     case 'holder-gas-budget':result=await operator.budget();break;
     case 'holder-record':result=await operator.record({...input,raw:await privateText(input.rawFile)});break;
     case 'holder-broadcast':result=await operator.broadcast(input.txHash);break;
     case 'holder-resolve':result=await operator.resolve(input.txHash);break;
     case 'holder-reconcile':result=await operator.reconcile(input);break;
     case 'holder-scan':result=await scanHolderPayments(executor,scope,{...input,provider});break;
     case 'holder-recover-funding':result=await recoverHolderFunding(await pool('jobs'),scope,{...input,provider});break;
     case 'holder-funding':result=await importHolderFunding(await pool('jobs'),scope,{...input,provider});break;
     case 'holder-snapshot':result=await appendHolderPreparation(await pool('jobs'),scope,input);break;
     case 'holder-admit':result=await admitHolderPreparation(await pool('jobs'),scope,{...input,provider});break;
     case 'holder-admit-page':result=await resumeHolderAdmission(await pool('jobs'),scope,{...input,now:Math.floor(Date.now()/1000),clock:()=>Math.floor(Date.now()/1000),provider});break;
     case 'holder-plan':result=await prepareHolderAllocation(executor,scope,{...input,provider});break;
     case 'holder-advance':result=await advanceHolderPeriod(await pool('jobs'),executor,scope,{...input,provider});break;
    }
   }
  }
  console.log(JSON.stringify(result,(_,v)=>typeof v==='bigint'?String(v):v,2));
 }catch(error){
  // RPC/DB exceptions may contain credential URLs or signed payloads.
  console.error('PW operator failed at '+phase+'; no automatic retry or new signature. Check the private configuration and durable journal.');process.exitCode=1;
  if(error.code==='SERVICE_GAS_BUDGET_EXHAUSTED')console.error(JSON.stringify({reason:'service-gas-budget',budget:error.budget}));
  if(['HOLDER_FUNDING_EVIDENCE_MISSING','RPC_BUDGET_EXHAUSTED','RPC_BUDGET_LOCKED','RPC_OPERATION_TOO_LARGE'].includes(error.code))console.error(error.code==='HOLDER_FUNDING_EVIDENCE_MISSING'?'holder-funding-evidence-missing: run holder-recover-funding with bounded ranges, then retry.':error.code==='RPC_OPERATION_TOO_LARGE'?'RPC_OPERATION_TOO_LARGE: operation cannot fit its reserved allowance; do not retry the same full scan.':error.code);
 }finally{
  if(usage){const s=usage();console.error(JSON.stringify({rpcBudget:{...s,remaining:s.maxRequests-s.used}}));}
  await Promise.allSettled(Object.values(pools).map(p=>p.end()));provider?.destroy();
 }
}
