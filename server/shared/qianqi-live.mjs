import {inProject,verifyRole} from './store.mjs';
import {readQianqiHistory} from './qianqi-history.mjs';
import {advanceShadow} from '../../src/qianqi/live-shadow.mjs';
import {check,contentHash,canonical} from '../../src/qianqi/ticket-shadow.mjs';
async function decode(client,project,module,row){
 let payload=JSON.parse(row.payload_text);
 if(payload.storageSchema==='qianqi-live-body-v1'){
  const body=(await client.query('SELECT body_text FROM launchpad.qianqi_live_bodies WHERE project_id=$1 AND module_id=$2 AND digest=$3',[project,module,payload.bodyDigest])).rows[0];
  check(body,'Missing live body');const value=JSON.parse(body.body_text);
  check(contentHash(value)===payload.bodyDigest,'Live body checksum mismatch');
  payload={...value,provenance:{...value.provenance,head:payload.head}};
 }
 check(contentHash(payload)===row.digest&&String(payload.provenance.head.number)===row.head_number&&payload.provenance.head.hash===row.head_hash,'Live stored checksum mismatch');return {payload,digest:row.digest};
}
export async function readQianqiLive(pool,project,module){
 const value=await inProject(pool,project,async c=>{
  const row=(await c.query('SELECT * FROM launchpad.qianqi_live_heads WHERE project_id=$1 AND module_id=$2 ORDER BY head_number DESC LIMIT 1',[project,module])).rows[0];
  return row?decode(c,project,module,row):null;
 });return value??readQianqiHistory(pool,project,module);
}
export async function observeQianqiLive(pool,project,module,{rpc,getJson,beforeCommit=()=>{}}){
 await verifyRole(pool,'lp_jobs');
 const halted=await inProject(pool,project,async c=>(await c.query('SELECT reason FROM launchpad.qianqi_live_halts WHERE project_id=$1 AND module_id=$2',[project,module])).rowCount);
 check(!halted,'QIANQI live shadow halted');const previous=await readQianqiLive(pool,project,module);check(previous,'Missing verified QIANQI baseline');
 let result;try{result=await advanceShadow({previous:previous.payload,rpc,getJson});}catch(e){
  if(e.code==='QIANQI_REORG')await inProject(pool,project,c=>c.query('INSERT INTO launchpad.qianqi_live_halts VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[project,module,'Canonical branch changed; manual investigation required']),{readOnly:false});throw e;
 }
 await beforeCommit();return inProject(pool,project,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`qianqi-live:${project}:${module}`]);
  check(!(await c.query('SELECT 1 FROM launchpad.qianqi_live_halts WHERE project_id=$1 AND module_id=$2',[project,module])).rowCount,'QIANQI live shadow halted');
  const row=(await c.query('SELECT * FROM launchpad.qianqi_live_heads WHERE project_id=$1 AND module_id=$2 ORDER BY head_number DESC LIMIT 1',[project,module])).rows[0];
  const current=row?await decode(c,project,module,row):previous;
  const digest=contentHash(result.payload);
  if(current.digest===digest)return {...result,digest,inserted:false};
  check(current.digest===previous.digest,'Live cursor changed concurrently; retry');
  const {payload,...observation}=result,head=payload.provenance.head;
  const body={...payload,provenance:{...payload.provenance}};delete body.provenance.head;
  const bodyDigest=contentHash(body);
  await c.query('INSERT INTO launchpad.qianqi_live_bodies VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[project,module,bodyDigest,canonical(body)]);
  const saved=(await c.query('SELECT body_text FROM launchpad.qianqi_live_bodies WHERE project_id=$1 AND module_id=$2 AND digest=$3',[project,module,bodyDigest])).rows[0];
  check(saved&&contentHash(JSON.parse(saved.body_text))===bodyDigest,'Live body checksum mismatch');
  await c.query('INSERT INTO launchpad.qianqi_live_heads VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[project,module,head.number,head.hash,previous.digest,digest,canonical({storageSchema:'qianqi-live-body-v1',bodyDigest,head}),canonical(observation)]);
  await beforeCommit();return {...result,digest,inserted:true};
 },{readOnly:false});
}
