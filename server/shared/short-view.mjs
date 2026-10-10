import {inProject} from './store.mjs';

export async function readShortView(pool,projectId,{now=Date.now(),maxAgeMs=120000}={}){
 return inProject(pool,projectId,async c=>{
  const {rows}=await c.query(`SELECT m.id,m.program_address,v.snapshot,v.observed_at,v.service_status,v.service_at,v.projection_failed
   FROM launchpad.module_instances m LEFT JOIN launchpad.short_public_views v ON v.project_id=m.project_id AND v.module_id=m.id
   WHERE m.project_id=$1 AND m.adapter_version='production-candidate-v1' ORDER BY m.id`,[projectId]);
  return {modules:rows.map(r=>({id:r.id,program:r.program_address,snapshot:r.snapshot??null,observedAt:r.observed_at??null,
   stale:!r.observed_at||now-new Date(r.observed_at).getTime()>maxAgeMs||new Date(r.observed_at).getTime()>now+30000,
   service:{status:r.service_status??'unavailable',observedAt:r.service_at??null,stale:!r.service_at||now-new Date(r.service_at).getTime()>maxAgeMs,projectionFailed:r.projection_failed??false}}))};
 });
}
