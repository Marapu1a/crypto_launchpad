import {digest} from '../../src/tickets/digest.mjs';
// One instance per token. Restart deliberately discards sleep and rechecks durable obligations.
// loadReport reads Pons/local storage only. run retains all transaction guards and leases.
export function createPonsService({loadReport,run,observe,publish,now=Date.now,maxSourceAgeMs=660000}){
 if(!Number.isSafeInteger(maxSourceAgeMs)||maxSourceAgeMs<1)throw Error('Invalid Pons service timing');
 let sleeping=null,running=false;
 return async()=>{
  if(running)return {status:'busy',reason:'service-pass-running'};
  running=true;
  try{
   const at=now();let report,sourceError;
   try{report=structuredClone(await loadReport());}catch(e){sourceError=e;}
   const fresh=report?.schema==='pons-purchase-accounting-v1'&&report.source==='Pons API'&&report.status==='current'&&!report.error&&!report.reviewCount
    &&Number.isSafeInteger(report.checkedAt)&&at-report.checkedAt*1000>=0&&at-report.checkedAt*1000<=maxSourceAgeMs
    &&Array.isArray(report.activity)&&report.tradeCount===report.activity.length;
   // checkedAt is a source heartbeat, not a new purchase. All business content is retained.
   const fingerprint=fresh?digest({profile:report.profile,activity:report.activity,tradeCount:report.tradeCount}):null;
   // A source outage is not a reason to inspect an otherwise idle contract.
   // Preserve the idle proof, but publish no heartbeat until the source recovers.
   if(!fresh&&sleeping&&at>=sleeping.startedAt&&at<sleeping.until)
    return {status:'source-unavailable',reason:'pons-source-unavailable',service:{ran:false,nextCheckAt:Number.isFinite(sleeping.until)?sleeping.until:null,lastContractCheckAt:sleeping.startedAt}};
   if(fresh&&sleeping?.fingerprint===fingerprint&&at>=sleeping.startedAt&&at<sleeping.until)
    return {status:'waiting',reason:'service-sleep',service:{ran:false,nextCheckAt:Number.isFinite(sleeping.until)?sleeping.until:null,lastContractCheckAt:sleeping.startedAt,sourceFingerprint:fingerprint,sourceCheckedAt:report.checkedAt}};
   const reason=!sleeping?'initial-or-pending':!fresh?'source-unavailable':sleeping.fingerprint!==fingerprint?'pons-changed':'scheduled-check';
   sleeping=null; // A crash, failed projection or unclassified result must never inherit idle permission.
   const result=await run({report,sourceError}),observation=observe(result);
   const deadline=observation.nextCheckAt;
   const eventIdle=fresh&&observation.status==='idle'&&(deadline===undefined||Number.isSafeInteger(deadline)&&deadline>at);
   if(publish)await publish(result,{sourceFingerprint:fingerprint,sourceCheckedAt:fresh?report.checkedAt:null,eventIdle,nextCheckAt:eventIdle?(deadline??null):null});
   if(fresh&&observation.status==='idle'){
    if(deadline!==undefined&&(!Number.isSafeInteger(deadline)||deadline<=at))return {...result,service:{ran:true,reason,nextCheckAt:at}};
    sleeping={fingerprint,startedAt:at,until:deadline??Infinity};
   }
   return {...result,service:{ran:true,reason,nextCheckAt:sleeping?(Number.isFinite(sleeping.until)?sleeping.until:null):at}};
  }finally{running=false;}
 };
}
