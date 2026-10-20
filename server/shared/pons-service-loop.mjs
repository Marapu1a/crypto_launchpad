import {setTimeout as delay} from 'node:timers/promises';
import cadence from './service-cadence.cjs';
const failureReason={RPC_BUDGET_EXHAUSTED:'rpc-budget-exhausted',RPC_BUDGET_OWNER:'rpc-budget-owner',RPC_BUDGET_LOCKED:'rpc-budget-locked',EACCES:'service-permission-denied',EPERM:'service-permission-denied'};

// Each tick owns guards, execution and projection. Heartbeat must be local I/O only.
// Deliberately accepts pre-built supervisors, never raw workers or signer credentials.
export async function runPonsServices({services,heartbeat,signal,pollMs=15000,once=false,failFast=false,now=Date.now,wait=(ms,signal)=>delay(ms,undefined,{signal})}){
 if(!Array.isArray(services)||!services.length||new Set(services.map(s=>s.id)).size!==services.length||services.some(s=>typeof s.id!=='string'||!s.id||typeof s.tick!=='function'))throw Error('Invalid Pons services');
 if(!Number.isSafeInteger(pollMs)||pollMs<1000||pollMs>300000)throw Error('Invalid Pons polling interval');
 const schedules=services.map(()=>cadence.createServiceCadence({activeMs:pollMs}));
 const due=services.map(()=>0),previous=[];
 while(!signal?.aborted){
  const rows=[];let pause=pollMs;
  for(const [index,service] of services.entries()){
   if(signal?.aborted)break;
   if(now()<due[index]){rows.push({id:service.id,result:previous[index],schedule:{skipped:true,nextCheckAt:due[index]}});continue;}
   let result;
   try{result=await service.tick();}
   catch(error){if(failFast)throw error;result={status:'error',reason:failureReason[error.code]??'service-pass-failed',
    ...(error.code==='RPC_BUDGET_EXHAUSTED'&&Number.isSafeInteger(error.retryAt)?{retryAt:error.retryAt}:{})};}
   rows.push({id:service.id,result});
   previous[index]=result;
   const failed=['error','blocked','stopped','source-unavailable'].includes(result.status)||result.sourceStatus==='unavailable';
   const schedule=schedules[index]({status:failed?'unavailable':'active'});
   due[index]=Math.max(now()+schedule.delayMs,Number.isSafeInteger(result.retryAt)?result.retryAt:0);
  }
  pause=Math.max(1,Math.min(...due)-now());
  if(rows.length)await heartbeat?.({checkedAt:new Date().toISOString(),services:rows});
  if(once||signal?.aborted)break;
  try{await wait(pause,signal);}catch(error){if(signal?.aborted&&error.name==='AbortError')break;throw error;}
 }
}
