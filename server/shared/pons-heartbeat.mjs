import {inProject} from './store.mjs';
import {readFile} from 'node:fs/promises';
import {digest} from '../../src/tickets/digest.mjs';
import {savePonsPublic} from '../adapters/qianqi/pons-public-store.mjs';
export async function refreshDrawHeartbeat({pool,projectId,moduleId},proof){
 const result=await inProject(pool,projectId,c=>c.query(`UPDATE launchpad.short_public_views SET
  snapshot=jsonb_set(jsonb_set(snapshot,'{serviceObservation,sourceCheckedAt}',to_jsonb($3::bigint)), '{draws}',
   (SELECT jsonb_agg(jsonb_set(item,'{serviceObservation,sourceCheckedAt}',to_jsonb($3::bigint)) ORDER BY n) FROM jsonb_array_elements(snapshot->'draws') WITH ORDINALITY AS d(item,n))),
  service_at=clock_timestamp()
  WHERE project_id=$1 AND module_id=$2 AND snapshot->>'schema'='draw-public-v2'
   AND jsonb_array_length(snapshot->'draws')>0 AND snapshot->'serviceObservation'->>'sourceFingerprint'=$4`,[projectId,moduleId,proof.sourceCheckedAt,proof.sourceFingerprint]),{readOnly:false});
 if(result.rowCount!==1)throw Error('Public Pons heartbeat identity changed');
}
export async function refreshQianqiHeartbeat(file,proof){
 const doc=JSON.parse(await readFile(file,'utf8'));
 if(doc.checksum!==digest(doc.snapshot)||doc.snapshot.serviceObservation?.sourceFingerprint!==proof.sourceFingerprint)throw Error('Public Pons heartbeat identity changed');
 doc.snapshot.serviceObservation.sourceCheckedAt=proof.sourceCheckedAt;savePonsPublic(file,doc.snapshot);
}
