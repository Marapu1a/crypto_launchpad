import {readPwService} from './pw-service.mjs';
import {shouldPublishContracts} from './pons-work-policy.mjs';
import {verifyPwPolicy} from '../../src/worker/pw-policy.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {publishPwService} from './pw-public.mjs';
import {readFile} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {Contract} from 'ethers';
import {privateText,validateRuntimeConfig,loadRuntimeProject,runtimeEnvironment} from '../short-runtime/config.mjs';
import {createPool,verifyRole} from './store.mjs';
import {refreshDrawHeartbeat,refreshQianqiHeartbeat} from './pons-heartbeat.mjs';
import {loadExecutorKeystore} from '../../src/worker/executor-keystore.mjs';
import {publishShortView} from '../short-runtime/projection.mjs';
import {buildPonsPublicSnapshot} from '../adapters/qianqi/pons-projection.mjs';
import {savePonsPublic} from '../adapters/qianqi/pons-public-store.mjs';
import {withQianqiExecutor} from '../adapters/qianqi/executor.mjs';
const require=createRequire(import.meta.url);
const json=async file=>{if(!isAbsolute(file??''))throw Error('Absolute Pons configuration path required');return JSON.parse(await readFile(file,'utf8'));};
export function validatePwRuntimeEntry(entry){
 const paths=['rpcFile','databaseFile','jobsDatabaseFile','keyFile','passwordFile','reportFile','publicFile'].map(k=>entry[k]);
 if(paths.some(p=>typeof p!=='string'||!isAbsolute(p)))throw Error('Absolute PW runtime paths required');
 const normalized=paths.map(p=>process.platform==='win32'?resolve(p).toLowerCase():resolve(p));
 if(new Set(normalized).size!==paths.length)throw Error('PW runtime paths must be isolated');
 if(typeof entry.policyHash!=='string'||!/^[0-9a-f]{64}$/.test(entry.policyHash))throw Error('Pinned PW policy hash required');
 return entry;
}

// Fixed adapters and encrypted key loaders. No credentials are accepted inline.
export function configuredPonsBootstrap(config){
 if(config.schema!=='pons-runtime-config-v1'||!['rehearsal','production'].includes(config.mode)||(config.mode==='production'&&config.allowPublicTransactions!==true)||!Array.isArray(config.projects)||!config.projects.length)throw Error('Invalid Pons runtime configuration');
 return async({provider:makeProvider})=>{
  const pools=[],projects=[];let compiled;
  const close=async()=>{await Promise.all(pools.map(p=>p.end()));};
  try{
   for(const entry of config.projects){
    if(!['qianqi','draw-v2','pw'].includes(entry.adapter)||typeof entry.id!=='string'||!entry.id)throw Error('Invalid Pons adapter');
    const loadReport=()=>json(entry.reportFile);
    if(entry.adapter==='pw'){
     validatePwRuntimeEntry(entry);
     const provider=makeProvider(await privateText(entry.rpcFile),{reserveRequests:config.pwRpcReserveRequests??Math.floor(config.rpcBudget.maxRequests/2)}),pool=createPool(await privateText(entry.databaseFile)),jobsPool=createPool(await privateText(entry.jobsDatabaseFile));pools.push(pool,jobsPool);
     await verifyRole(pool,'lp_executor');await verifyRole(jobsPool,'lp_jobs');
     const {policy}=await readPwService(pool,entry.id);
     if(policy.mode!==config.mode||entry.policyHash!==digest(policy)||!isAbsolute(entry.publicFile??''))throw Error('PW runtime binding mismatch');
     await verifyPwPolicy(provider,policy);
     const signer=await loadExecutorKeystore({file:entry.keyFile,password:await privateText(entry.passwordFile),expectedAddress:policy.executor,provider});
     const input={pool,jobsPool,provider,signer,publisher:{getAddress:async()=>policy.publisher},projectId:entry.id,moduleId:entry.id,ponsRehearsal:{load:loadReport},ponsSourceMode:config.mode,allowPublicTransactions:config.allowPublicTransactions===true,guard:()=>verifyPwPolicy(provider,policy)};
     projects.push({id:entry.id,adapter:'pw',input,publish:(result,serviceObservation)=>publishPwService({pool,projectId:entry.id,file:entry.publicFile,result,serviceObservation})});
    }else if(entry.adapter==='draw-v2'){
     const c=validateRuntimeConfig(await json(entry.runtimeConfigFile));
     if(c.mode!==config.mode||c.schema!=='draw-runtime-config-v2'||c.readRpcFile||c.traceRpcFile)throw Error('Pons draw requires one matching-mode transport');
     const selected=c.projects.find(p=>p.projectId===entry.id&&p.enabled);if(!selected)throw Error('Enabled draw project required');
     const provider=makeProvider(await privateText(c.rpcFile)),pool=createPool(await privateText(c.databaseFile));pools.push(pool);
     await runtimeEnvironment(provider,c);
     const input=await loadRuntimeProject({pool,provider,config:c,entry:selected});input.ponsRehearsal={load:loadReport};input.ponsSourceMode=config.mode;
     projects.push({id:entry.id,adapter:entry.adapter,input,publish:async(result,serviceObservation)=>{
      if(!shouldPublishContracts(result))return;
      const out=await publishShortView({...input,...result,serviceObservation});if(out?.failed)throw Error('Pons draw projection failed');
     },onSleep:proof=>refreshDrawHeartbeat(input,proof)});
    }else{
     const c=await json(entry.schedulerFile),bootstrap=await json(entry.migrationFile),provider=makeProvider(await privateText(entry.rpcFile));
     const executor=await loadExecutorKeystore({file:entry.keyFile,password:await privateText(entry.passwordFile),expectedAddress:entry.executorAddress,provider});
     if(!isAbsolute(entry.stateFile??'')||!isAbsolute(entry.publicFile??'')||entry.stateFile===entry.publicFile||entry.stateFile===entry.migrationFile)throw Error('Isolated QIANQI state and public paths required');
     compiled??=require('../adapters/qianqi/runtime/scripts/compile.cjs').compile();
     const input={provider,executor,config:c.scheduler,bootstrap,loadReport,rpcUrl:await privateText(entry.rpcFile),statePath:entry.stateFile,
      short:new Contract(bootstrap.domain.source,compiled.RobinhoodShortController.abi,provider),monthly:new Contract(bootstrap.domain.monthlySource,compiled.RobinhoodMonthlyController.abi,provider),funding:c.funding,deliveryJob:c.deliveryJob};
     if(config.mode==='production'){
      const binding=await json(entry.bindingFile),pool=createPool(await privateText(entry.databaseFile));pools.push(pool);
      if(binding.projectId!==entry.id||binding.sender.toLowerCase()!==entry.executorAddress.toLowerCase()||binding.token.toLowerCase()!==c.scheduler.manifest.token.toLowerCase())throw Error('QIANQI lease binding mismatch');
      input.execution={allowPublicTransactions:true,config:await json(entry.publicConfigFile),profile:await json(entry.publicProfileFile)};
      input.withLease=run=>withQianqiExecutor(pool,binding,run);
     }
     projects.push({id:entry.id,adapter:entry.adapter,input,publish:async(result,serviceObservation)=>{
      if(!shouldPublishContracts(result))return;
      const state=await json(entry.stateFile);
      const snapshot=await buildPonsPublicSnapshot({provider,config:c.scheduler,migration:state.migration,mode:config.mode,serviceObservation});savePonsPublic(entry.publicFile,snapshot);
     },onSleep:proof=>refreshQianqiHeartbeat(entry.publicFile,proof)});
    }
   }
   return {projects,close};
  }catch(error){await close();throw error;}
 };
}
