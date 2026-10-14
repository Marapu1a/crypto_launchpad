import service from '../../shared/service-cadence.cjs';
import {runPonsScheduler} from './pons-scheduler.mjs';
import {createPonsService} from '../../shared/pons-service.mjs';
export function schedulerObservation(result){
 if(['blocked','error','stopped'].includes(result.status))return {status:'unavailable'};
 if(result.status==='progress'||result.steps?.length)return {status:'active'};
 const idle=result.status==='waiting'&&result.sourceStatus==='current'&&result.steps?.length===0
  &&result.funding?.length>0&&result.funding.every(row=>row.status==='empty')
  &&['SHORT','MONTHLY'].every(kind=>result.results?.some(row=>row.kind===kind&&['empty','schedule','prizeFunding'].includes(row.reason)));
 const deadlines=(result.results??[]).map(r=>r.nextCheckAt).filter(Number.isSafeInteger);
 return {status:idle?'idle':'unknown',...(deadlines.length?{nextCheckAt:Math.min(...deadlines)*1000}:{})};
}
// One instance per supervised worker. Only timing is shared; no token/transaction state is pooled.
export function createPonsSchedulerService(options={}){
 const next=service.createServiceCadence(options);
 return async input=>{const result=await runPonsScheduler(input);return {...result,schedule:next(schedulerObservation(result))};};
}
export function createPonsSchedulerSupervisor(input,options={}){
 return createPonsService({...options,now:options.now??(input.now?()=>input.now()*1000:Date.now),loadReport:input.loadReport,
  run:({report,sourceError})=>{const run=()=>runPonsScheduler({...input,loadReport:async()=>{if(sourceError)throw sourceError;return report;}});return input.withLease?input.withLease(run):run();},observe:schedulerObservation});
}
