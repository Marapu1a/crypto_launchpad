import {inProject} from './store.mjs';

export function publicSnapshot(snapshot,wallet){
 if(!snapshot)return null;
 const {walletSnapshot,...publicData}=snapshot;
 if(wallet){
  const available=walletSnapshot?.schema==='draw-wallets-v1';
  return {...publicData,pendingRecognition:available?(walletSnapshot.pending?.[wallet]??{count:0,items:[]}):null,wallet:available?(walletSnapshot.items[wallet]??{eligibleVolumeRaw:'0',totalIssued:'0',used:'0',reserved:'0',available:'0',remainderRaw:'0',latestCycle:snapshot.cycle,latestUnpaidRewardRaw:'0'}):null};
 }
 return publicData;
}
export async function readShortView(pool,projectId,{now=Date.now(),maxAgeMs=120000,wallet}={}){
 return inProject(pool,projectId,async c=>{
  const {rows}=await c.query(`SELECT m.id,m.program_address,v.snapshot,v.observed_at,v.service_status,v.service_at,v.projection_failed
   FROM launchpad.module_instances m LEFT JOIN launchpad.short_public_views v ON v.project_id=m.project_id AND v.module_id=m.id
   WHERE m.project_id=$1 AND m.adapter_version IN ('production-candidate-v1','draw-candidate-v2') ORDER BY m.id`,[projectId]);
  return {...(wallet?{address:wallet}:{}),modules:rows.flatMap(row=>row.snapshot?.schema==='draw-public-v2'?row.snapshot.draws.map(s=>({...row,id:row.id+':'+s.kind,program_address:s.program,snapshot:s})):[row]).map(r=>({id:r.id,program:r.program_address,snapshot:publicSnapshot(r.snapshot,wallet),observedAt:r.observed_at??null,
   stale:!r.observed_at||now-new Date(r.observed_at).getTime()>maxAgeMs||new Date(r.observed_at).getTime()>now+30000,
   service:{status:r.service_status??'unavailable',observedAt:r.service_at??null,stale:!r.service_at||now-new Date(r.service_at).getTime()>maxAgeMs,projectionFailed:r.projection_failed??false}}))};
 });
}
