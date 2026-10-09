import { createRequire } from 'node:module';
import { verifyRole } from '../../shared/store.mjs';
const require=createRequire(import.meta.url);
const {hash}=require('./runtime/scripts/direct-buy.cjs');
const {withFence}=require('./fence.cjs');

export async function withQianqiExecutor(pool,binding,work){
 await verifyRole(pool,'lp_executor');
 const client=await pool.connect();let lost=false,held=false;
 const key=`qianqi-signer:4663:${binding.sender.toLowerCase()}`;
 const loss=()=>{lost=true;};client.on('error',loss);
 const check=async()=>{
  if(lost||!held)throw Error('QIANQI executor lease lost');
  try{
   const {rows:[row]}=await client.query('SELECT e.binding_hash,e.sender,p.token_address,p.chain_id::text FROM launchpad.qianqi_executors e JOIN launchpad.projects p ON p.id=e.project_id WHERE e.project_id=$1',[binding.projectId]);
   if(!row||row.binding_hash!==hash(binding)||row.sender!==binding.sender.toLowerCase()||row.token_address.toLowerCase()!==binding.token.toLowerCase()||row.chain_id!=='4663')throw Error('QIANQI executor binding changed');
  }catch{lost=true;throw Error('QIANQI executor binding unavailable');}
 };
 try{
  await client.query("SELECT set_config('launchpad.project_id',$1,false)",[binding.projectId]);
  await client.query("SET statement_timeout='3000ms'");
  held=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,49174)) AS held',[key])).rows[0].held;
  if(!held)throw Error('QIANQI executor already running');
  await check();
  return await withFence(check,()=>work(check));
 }finally{
  // Destroy this session, including its advisory lock and project context.
  client.removeListener('error',loss);client.release(true);
 }
}
