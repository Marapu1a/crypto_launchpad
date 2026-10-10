import {runDrawWorker} from '../shared/draw-worker.mjs';
import {runProductionWorker} from '../shared/production-worker.mjs';
import {sharedScanProvider} from './reader.mjs';

const safe=value=>typeof value==='string'&&/^[a-z0-9.,:-]{1,100}$/.test(value)?value:undefined;
export async function runtimePass({provider,projects,runWorker=p=>p.policySchema==='draw-production-policy-v2'?runDrawWorker(p):runProductionWorker(p),concurrency=2}){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw Error('Invalid concurrency');
 const shared=sharedScanProvider(provider),results=Array(projects.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(concurrency,projects.length)},async()=>{
  while(cursor<projects.length){
   const index=cursor++,p=projects[index],started=Date.now();let result;
   try{
    if(!p.enabled)result={status:'paused',reason:'execution-disabled'};
    else if(p.error)result={status:'blocked',reason:'project-configuration'};
    else{
     await p.guard?.();
     const balances=await Promise.all([p.signer,p.publisher].map(async s=>String(await provider.getBalance(await s.getAddress()))));
     const outcome=await runWorker({...p,provider:shared.provider});
     const alerts=balances.flatMap((b,i)=>BigInt(b)<BigInt(p.nativeFloor??'0')?[(i?'publisher':'executor')+'-native-low']:[]);
     result={status:safe(outcome.status)??'blocked',reason:safe(outcome.reason),operation:safe(outcome.operation),role:safe(outcome.role),balances,alerts};
     if(outcome.gasFunding)result.gasFunding=Object.fromEntries(['active','role','wallet','action','balanceWei','requiredWei','shortfallWei','estimateAvailable','changedAt'].map(k=>[k,outcome.gasFunding[k]]));
    }
   }catch{result={status:'blocked',reason:'project-pass-failed'};}
   results[index]={projectId:p.projectId,moduleId:p.moduleId,...result,completedAt:new Date().toISOString(),durationMs:Date.now()-started};
  }
 }));
 return {schema:'short-runtime-health-v1',completedAt:new Date().toISOString(),projects:results,reader:shared.stats()};
}

export function healthProblems(report,{now=Date.now(),maxAgeMs=120000}={}){
 if(!Number.isFinite(maxAgeMs)||maxAgeMs<=0)return ['invalid-health-age'];
 if(report?.schema!=='short-runtime-health-v1'||!Array.isArray(report.projects)||!Number.isFinite(Date.parse(report.completedAt)))return ['invalid-health'];
 if(report.projects.some(p=>!p||typeof p.projectId!=='string'||!['paused','blocked','busy','waiting','confirmed','already-confirmed','idle'].includes(p.status)||(p.alerts!==undefined&&(!Array.isArray(p.alerts)||p.alerts.some(a=>typeof a!=='string')))))return ['invalid-health'];
 const age=now-Date.parse(report.completedAt);if(age>maxAgeMs||age< -30000)return ['stale-health'];
 return report.projects.flatMap(p=>[...(p.alerts??[]).map(a=>p.projectId+':'+a),...(p.status==='blocked'||p.status==='busy'||['native-balance','gas-limit','gas-price','external-pending-nonce','chain-clock','finality-unavailable','finality-regression','latest-beacon-unavailable','beacon-unavailable'].includes(p.reason)?[p.projectId+':'+(p.reason??p.status)]:[])]);
}

// Stop waits for the active pass. Never abandon an in-flight financial promise.
export async function runRuntimeLoop({pass,publish,intervalMs,signal}){
 if(!Number.isInteger(intervalMs)||intervalMs<100||intervalMs>300000)throw Error('Invalid interval');
 while(!signal.aborted){
  await publish(await pass());if(signal.aborted)break;
  await new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,intervalMs);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});
 }
}
