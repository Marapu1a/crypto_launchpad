import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {FetchRequest,JsonRpcProvider} from 'ethers';
import {createPool,verifyRole} from '../shared/store.mjs';
import {validateRuntimeConfig,privateText,runtimeEnvironment,loadRuntimeProject} from './config.mjs';
import {runtimePass,runRuntimeLoop} from './runtime.mjs';
import {writeHealthFile} from './health-file.mjs';
import {publishShortView} from './projection.mjs';

let pool,provider,phase='configuration';
try{
 const config=validateRuntimeConfig(JSON.parse(await readFile(resolve(process.argv[2]??''),'utf8')));
 phase='credentials';
 const rpc=new FetchRequest(await privateText(config.rpcFile));rpc.timeout=15000;
 provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1,batchMaxCount:10});pool=createPool(await privateText(config.databaseFile));
 phase='database';
 await verifyRole(pool,'lp_executor');
 phase='network';
 await runtimeEnvironment(provider,config);
 const projects=[];
 for(const entry of config.projects){
  if(!entry.enabled){projects.push(entry);continue;}
  try{projects.push(await loadRuntimeProject({pool,provider,config,entry}));}
  catch{projects.push({...entry,error:true});}
 }
 const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
 let last='';
 phase='pass-or-health';
 await runRuntimeLoop({signal:controller.signal,intervalMs:config.intervalMs,pass:()=>runtimePass({provider,projects,concurrency:config.concurrency}),publish:async report=>{
  for(const result of report.projects){
   try{const view=await publishShortView({pool,provider,...result,status:result.status});if(view?.failed)(result.alerts??=[]).push('public-view-failed');}
   catch{(result.alerts??=[]).push('public-view-failed');}
  }
  await writeHealthFile(config.healthFile,report);
  const summary=JSON.stringify(report.projects.map(({projectId,status,reason,alerts})=>({projectId,status,reason,alerts})));
  if(summary!==last){console.log(summary);last=summary;}
 }});
}catch{console.error('Short runtime stopped at '+phase);process.exitCode=1;}
finally{await pool?.end();provider?.destroy();}
