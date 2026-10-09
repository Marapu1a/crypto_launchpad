import {inProject,verifyRole} from './store.mjs';
import {verifyHistoryArchive} from '../../src/qianqi/history-archive.mjs';
import {canonical,contentHash,check,low} from '../../src/qianqi/ticket-shadow.mjs';
export const adapter='qianqi-history-import-v1';
const key=p=>`${low(p.blockHash)}:${low(p.transactionHash)}:${p.logIndex}`;
const rowsOf=p=>[
 ...p.purchases.map(v=>['purchase',key(v),v]),
 ...p.replay.wallets.map(v=>['wallet',v.wallet,v]),
 ...p.events.map(v=>['event',`${v.blockNumber}:${v.transactionIndex}:${v.logIndex}`,v]),
 ...p.replay.draws.map(v=>['draw',v.snapshot.drawId,v]),
];
async function read(client,project,module){
 const row=(await client.query('SELECT * FROM launchpad.qianqi_imports WHERE project_id=$1 AND module_id=$2',[project,module])).rows[0];
 if(!row)return null;
 const records=(await client.query('SELECT kind,row_key,value_text FROM launchpad.qianqi_history_rows WHERE project_id=$1 AND module_id=$2 ORDER BY kind,row_key',[project,module])).rows;
 const payload=JSON.parse(row.metadata_text);
 for(const [kind,sort] of [['purchase',(a,b)=>a.blockNumber-b.blockNumber||a.transactionIndex-b.transactionIndex||a.logIndex-b.logIndex],['event',(a,b)=>a.blockNumber-b.blockNumber||a.transactionIndex-b.transactionIndex||a.logIndex-b.logIndex],['wallet',(a,b)=>a.wallet.localeCompare(b.wallet)],['draw',(a,b)=>a.snapshot.cutoff.blockNumber-b.snapshot.cutoff.blockNumber]]){
  const values=records.filter(r=>r.kind===kind).map(r=>JSON.parse(r.value_text)).sort(sort);
  if(kind==='purchase')payload.purchases=values;
  if(kind==='event')payload.events=values;
  if(kind==='wallet')payload.replay={...payload.replay,wallets:values};
  if(kind==='draw')payload.replay={...payload.replay,draws:values};
 }
 check(contentHash(payload)===row.digest,'Stored QIANQI history checksum mismatch');
 check(String(payload.provenance.head.number)===row.head_number&&payload.provenance.head.hash===row.head_hash,'Stored QIANQI cursor mismatch');
 return {payload,digest:row.digest};
}
export async function readQianqiHistory(pool,project,module){
 return inProject(pool,project,c=>read(c,project,module));
}
export async function importQianqiHistory(pool,project,module,archive){
 // Revalidate evidence, not the saved report's success flag or derived purchases.json.
 const verified=await verifyHistoryArchive(archive),p=verified.payload;
 await verifyRole(pool,'lp_jobs');
 return inProject(pool,project,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`qianqi:${project}:${module}`]);
  const binding=(await c.query(`SELECT m.*,p.chain_id::text,p.token_address,p.status FROM launchpad.module_instances m JOIN launchpad.projects p ON p.id=m.project_id WHERE m.project_id=$1 AND m.id=$2 `,[project,module])).rows[0];
  check(binding&&binding.adapter_version===adapter&&binding.kind==='short'&&binding.chain_id==='4663'&&binding.status==='shadow'&&binding.token_address===low(p.publicProfile.profile.token)&&binding.program_address===low(p.publicProfile.lifecycle.source)&&binding.config_hash===contentHash(p.publicProfile).slice(2),'QIANQI project/module binding mismatch');
  const existing=await read(c,project,module);
  if(existing){check(existing.digest===verified.digest,'Conflicting QIANQI history import');return {...existing,inserted:false};}
  const {purchases,events,replay,...metadata}=p;
  await c.query('INSERT INTO launchpad.qianqi_imports VALUES($1,$2,$3,$4,$5,$6)',[project,module,verified.digest,p.provenance.head.number,p.provenance.head.hash,canonical(metadata)]);
  for(const [kind,rowKey,value] of rowsOf(p))await c.query('INSERT INTO launchpad.qianqi_history_rows VALUES($1,$2,$3,$4,$5)',[project,module,kind,rowKey,canonical(value)]);
  const saved=await read(c,project,module);check(saved.digest===verified.digest,'Imported history mismatch');
  return {...saved,inserted:true};
 },{readOnly:false});
}
