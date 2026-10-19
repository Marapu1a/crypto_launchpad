import {createPwService} from './pw-service.mjs';
import {open,unlink} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createPonsDrawService} from './pons-draw-service.mjs';
import {createPonsSchedulerSupervisor} from '../adapters/qianqi/pons-service.mjs';
import {runPonsServices} from './pons-service-loop.mjs';
import {writeHealthFile} from '../short-runtime/health-file.mjs';
import {runtimeProvider} from '../short-runtime/rpc-provider.mjs';
import budget from './rpc-budget.cjs';
import {validateRpcUrl} from './rpc-policy.mjs';
import {enableVerificationCache} from '../../src/worker/verification-cache.mjs';

// Shared host: prepare builds adapter inputs using the supplied gated transport.
// Never import a bootstrap module or open keys until the exclusive host lock is held.
export async function runPonsRuntime({mode,allowPublicTransactions=false,allowedRpcHosts=[],lockFile,healthFile,rpcBudget,prepare,signal,pollMs=15000,once=false,failFast=false,wait}){
 if(!['rehearsal','production'].includes(mode)||(mode==='production'&&(allowPublicTransactions!==true||!Array.isArray(allowedRpcHosts)||!allowedRpcHosts.length))||!isAbsolute(lockFile??'')||!isAbsolute(healthFile??'')||lockFile===healthFile||typeof prepare!=='function'||!rpcBudget?.file)throw Error('Invalid Pons runtime');
 if([lockFile,healthFile].includes(rpcBudget.file))throw Error('Runtime paths overlap');
 const gate=budget.persistentRpcGate(rpcBudget),providers=[];
 const lock=await open(lockFile,'wx',0o600);let cleanup;
 try{
  await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));await lock.sync();
  if(signal?.aborted)return;
  const prepared=await prepare({signal,provider:url=>{
   validateRpcUrl(url,{mode,allowedRpcHosts});
   const p=runtimeProvider(url,{gate});enableVerificationCache(p);providers.push(p);return p;
  }});
  cleanup=prepared.close;
  const projects=prepared.projects;
  if(!Array.isArray(projects)||!projects.length)throw Error('No Pons projects');
  const ids=new Set(),senders=new Set();
  for(const p of projects){
   if(!['draw-v2','qianqi','pw'].includes(p.adapter)||typeof p.id!=='string'||!p.id||ids.has(p.id)||!providers.includes(p.input?.provider)||typeof p.publish!=='function')throw Error('Invalid Pons project');
   ids.add(p.id);
   const signer=p.adapter==='qianqi'?p.input.executor:p.input.signer;
   const sender=(await signer.getAddress()).toLowerCase();
   if(senders.has(sender))throw Error('Duplicate signer domain');senders.add(sender);
   if(signer.provider!==p.input.provider)throw Error('Signer bypasses gated provider');
   if(p.adapter==='draw-v2'&&p.input.publisher?.provider!==p.input.provider)throw Error('Publisher bypasses gated provider');
   if(['draw-v2','pw'].includes(p.adapter)){
    const publisher=(await p.input.publisher.getAddress()).toLowerCase();
    if(senders.has(publisher))throw Error('Duplicate publisher domain');senders.add(publisher);
   }
   if(mode==='rehearsal'){
    const meta=await p.input.provider.send('hardhat_metadata',[]);
    if(!/^(Hardhat|edr\/)/.test(meta?.clientVersion??'')||Number(meta.chainId)!==4663)throw Error('Wrong rehearsal network');
   }else{
    if((await p.input.provider.getNetwork()).chainId!==4663n)throw Error('Wrong production network');
    if(p.adapter==='qianqi'&&(!p.input.execution||typeof p.input.withLease!=='function'))throw Error('QIANQI public admission and lease required');
    if(['draw-v2','pw'].includes(p.adapter)&&(p.input.ponsSourceMode!=='production'||typeof p.input.guard!=='function'))throw Error('Draw production guard required');
   }
  }
  const services=projects.map(p=>({id:p.id,tick:(p.adapter==='qianqi'?createPonsSchedulerSupervisor:p.adapter==='pw'?createPwService:createPonsDrawService)(p.input,{publish:p.publish})}));
  await runPonsServices({services,signal,pollMs,once,failFast,wait,heartbeat:async r=>{
   for(const row of r.services)if(!row.schedule?.skipped&&row.result.reason==='service-sleep')await projects.find(p=>p.id===row.id)?.onSleep?.(row.result.service);
   await writeHealthFile(healthFile,{
   schema:'pons-runtime-health-v1',mode,checkedAt:r.checkedAt,rpcBudget:gate.snapshot(),
   projects:r.services.map(({id,result:r})=>({id,status:r.status,reason:r.reason,service:r.service}))
  });}});
 }finally{
  try{await cleanup?.();}finally{for(const p of providers)p.destroy();await lock.close();await unlink(lockFile);}
 }
}
