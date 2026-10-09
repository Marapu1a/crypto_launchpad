import {verifyRole} from './store.mjs';
import {observeQianqiLive} from './qianqi-live.mjs';
import {openShadowStorage,ShadowStop} from './shadow-storage.mjs';

// A separate session owns the whole-run lock, including filesystem captures.
export async function runShadow({pool,config,makeReads,watch=false,stopped=()=>false,log=console.log,storageOptions,observe=observeQianqiLive}){
 await verifyRole(pool,'lp_jobs');
 const lock=await pool.connect();let lost=false;
 const lostLock=()=>{lost=true;};lock.on('error',lostLock);lock.on('end',lostLock);
 try{
  const {rows:[r]}=await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[`shadow-run:${config.project}:${config.module}`]);
  if(!r.locked)throw new ShadowStop('Shadow runner already active');
  const storage=openShadowStorage(config,storageOptions);
  do{
   if(lost)throw new ShadowStop('Shadow runner database lock lost');
   const {rows:[size]}=await lock.query('SELECT pg_database_size(current_database())::text AS bytes');
   storage.begin(size.bytes);
   const reads=makeReads((kind,row)=>{if(lost)throw new ShadowStop('Shadow runner database lock lost');storage.save(kind,row);});
   const guard=()=>{if(lost)throw new ShadowStop('Shadow runner database lock lost');storage.check();};
   const beforeCommit=async()=>{
    guard();const {rows:[current]}=await lock.query('SELECT pg_database_size(current_database())::text AS bytes');
    storage.databaseSize(current.bytes);guard();
   };
   const guarded=Object.fromEntries(['rpc','getJson'].map(k=>[k,async(...args)=>{guard();return reads[k](...args);} ]));
   let report,failed=false;
   try{
    const result=await observe(pool,config.project,config.module,{...guarded,beforeCommit});
    report={status:result.changed?'LIVE_SHADOW_MATCH':'UNCHANGED',head:result.payload.provenance.head,digest:result.digest,inserted:result.inserted,delta:result.delta,comparedWallets:result.comparedWallets,executionEligible:false};
   }catch(e){
    if(e.code==='SHADOW_STOP')throw e;
    if(e.code==='QIANQI_REORG'||e.message==='QIANQI live shadow halted')throw new ShadowStop('QIANQI live shadow halted');
    failed=true;report={status:'NOT_ADVANCED',error:'Observation failed; cursor retained; inspect captured evidence',executionEligible:false};
   }
   storage.finish(report);log(report.status);
   if(!watch)return {failed};
   const until=Date.now()+config.intervalMs;
   while(!stopped()&&Date.now()<until){storage.check();await new Promise(r=>setTimeout(r,Math.min(1000,until-Date.now())));}
  }while(!stopped());
  return {failed:false};
 }finally{lock.removeListener('error',lostLock);lock.removeListener('end',lostLock);lock.release(true);}
}
