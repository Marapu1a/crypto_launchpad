// Scheduling only. Unknown states stay fast; never infer quiet from an empty balance.
import service from '../shared/service-cadence.cjs';
export function serviceObservation(report){
  const rows=report.projects??[];
  const failed=rows.length>0&&rows.every(p=>p.status==='blocked'||p.status==='paused');
  const idle=rows.length>0&&rows.every(p=>p.status==='paused'||p.status==='waiting'&&p.reason==='conditions'&&!p.operation&&!p.alerts?.length);
  return {status:failed?'unavailable':idle?'idle':'unknown'};
}
export function economyCadence(options={}){
 const next=service.createServiceCadence(options);
 return report=>next(serviceObservation(report));
}

export function rpcMeter(){
 const counts={};
 return {record(method,ok){const name=/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(method)?method:'unknown';const item=counts[name]??={requests:0,errors:0};item.requests++;if(!ok)item.errors++;},snapshot(){return structuredClone(counts);}};
}
