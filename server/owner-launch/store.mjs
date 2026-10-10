import {digest} from '../../src/tickets/digest.mjs';
import {verifyRole} from '../shared/store.mjs';
import {UUID} from '../studio/template.mjs';

export const check=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{code:'OWNER_LAUNCH'});};
export const plain=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v));
export const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();

export async function withOwnerLaunch({pool,projectId,owner},operate){
 check(UUID.test(projectId),'Invalid launch ID');await verifyRole(pool,'lp_executor');
 const c=await pool.connect();let held=false,broken=false,revision;
 const lost=()=>{broken=true;};c.on('error',lost);
 const lock='owner-launch:4663:'+owner.toLowerCase();
 try{
  held=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,49178)) held',[lock])).rows[0].held;
  check(held,'Launch busy');
  await c.query("SELECT set_config('launchpad.project_id',$1,false)",[projectId]);
  const read=async()=>{
   const {rows:[row]}=await c.query('SELECT * FROM launchpad.owner_launches WHERE project_id=$1',[projectId]);
   if(!row)return null;
   check(same(row.owner_address,owner),'Owner changed');
   const state=JSON.parse(row.state_text);check(digest(state)===row.state_hash&&state.identity===row.identity,'Launch journal checksum');revision=row.revision;return state;
  };
  const state=await read();
  const lease=async()=>{check(held&&!broken,'Launch lease lost');await c.query('SELECT 1');};
  const save=async value=>{
   await lease();const s=plain(value),text=JSON.stringify(s),hash=digest(s);
   if(revision===undefined){
    await c.query('BEGIN');
    try{
    const {rows}=await c.query('INSERT INTO launchpad.owner_launches(project_id,chain_id,owner_address,slug,identity,state_text,state_hash) VALUES($1,4663,$2,$3,$4,$5,$6) RETURNING revision',[projectId,owner.toLowerCase(),s.input.slug,s.identity,text,hash]);revision=rows[0].revision;
    for(const role of ['executor','publisher'])await c.query('INSERT INTO launchpad.owner_launch_wallets VALUES($1,$2,$3)',[s.roles[role].toLowerCase(),projectId,role]);
    await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}
   }else{
    const {rows}=await c.query('UPDATE launchpad.owner_launches SET state_text=$2,state_hash=$3,revision=revision+1,completed=$4 WHERE project_id=$1 AND revision=$5 RETURNING revision',[projectId,text,hash,s.stage==='registered',revision]);
    check(rows.length===1,'Launch journal changed');revision=rows[0].revision;
   }
  };
  return await operate({state,save,lease,revision:()=>revision});
 }finally{
  try{if(held)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,49178))',[lock]);await c.query('RESET launchpad.project_id');}catch{broken=true;}
  c.removeListener('error',lost);c.release(broken);
 }
}
