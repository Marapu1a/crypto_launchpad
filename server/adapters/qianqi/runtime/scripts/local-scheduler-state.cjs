const fs=require('node:fs'),path=require('node:path');
const {hash}=require('./direct-buy.cjs');
const {randomUUID}=require('node:crypto');
function inspectLock(lock){
  let fd;
  try{fd=fs.openSync(lock,'r');const stat=fs.fstatSync(fd),buffer=Buffer.alloc(128);
    const size=fs.readSync(fd,buffer,0,buffer.length,0);
    return {path:lock,exists:true,owner:buffer.subarray(0,size).toString(),mtimeMs:stat.mtimeMs,size:stat.size};
  }catch(e){return {path:lock,exists:e.code==='ENOENT'?false:null,error:e.code};}
  finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
function traceLock(event,runId,lock,detail={}){
  if(process.env.LOCAL_STATE_LOCK_TRACE!=='1')return;
  try{process.stderr.write(JSON.stringify({event,runId,pid:process.pid,time:new Date().toISOString(),lock,...detail})+'\n');}catch{}
}
// One local process per state file. This is not a distributed lease or mempool journal.
async function withState(file,config,action,{legacyConfigs=[],validateMigration,indexerFormat=false}={}){
  if(indexerFormat&&config.kind!=='persistent-buy-indexer-v1')throw Error('Compact format is restricted to indexer snapshots');
  const checksumFor=indexerFormat?require('./indexer-checksum.cjs').indexerChecksum:hash;
  const validChecksum=indexerFormat?require('./indexer-checksum.cjs').validIndexerChecksum:(s,c)=>c===hash(s);
  file=path.resolve(file);fs.mkdirSync(path.dirname(file),{recursive:true});
  const lock=file+'.lock',runId=randomUUID();let fd;
  traceLock('acquire',runId,lock);
  try{fd=fs.openSync(lock,'wx');}
  catch(e){if(e.code==='EEXIST'){const detail=inspectLock(lock);traceLock('conflict',runId,lock,{detail});
    throw Object.assign(Error('Scheduler state locked; another process or stale lock: '+JSON.stringify(detail)),{lock:detail});}throw e;}
  traceLock('acquired',runId,lock);
  const save=state=>{
    try{
    const payload={...state};delete payload.checksum;
    if(indexerFormat){
      const disk=fs.statfsSync(path.dirname(file)),bytes=fs.existsSync(file)?fs.statSync(file).size:0;
      // Reserve room for atomic replacement plus operational headroom. Never delete evidence.
      if(disk.bavail*disk.bsize<Math.max(1024**3,bytes*2))throw Error('Insufficient disk headroom for index snapshot');
    }
    const document={...payload,checksum:checksumFor(payload)};
    const temp=file+'.tmp';let out;
    try{out=fs.openSync(temp,'w');
      if(indexerFormat)require('./indexer-json.cjs').writeIndexerJson(out,document);
      else fs.writeFileSync(out,JSON.stringify(document,null,2)+'\n');
      fs.fsyncSync(out);}
    finally{if(out!==undefined)fs.closeSync(out);}
    fs.renameSync(temp,file);
    }catch(e){e.code='SCHEDULER_STORAGE_ERROR';throw e;}
  };
  let primaryError,failed=false;
  try{
    fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);fd=undefined;
    let state={schema:'local-scheduler-state-v1',configHash:hash(config),jobs:{SHORT:[],MONTHLY:[]}};
    if(fs.existsSync(file)){
      // Temporary safety boundary for the single-JSON backend. Stop before Node's
      // string/heap ceilings; retain the complete file for migration, never truncate.
      if(indexerFormat&&fs.statSync(file).size>=384*1024**2)
        throw Object.assign(Error('Index snapshot requires storage migration'),{code:'SCHEDULER_STORAGE_ERROR'});
      const {checksum,...stored}=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!validChecksum(stored,checksum)||stored.schema!==state.schema)
        throw Error('Scheduler state checksum/config mismatch');
      if(!Array.isArray(stored.jobs?.SHORT)||!Array.isArray(stored.jobs?.MONTHLY))throw Error('Invalid scheduler state');
      if(stored.configHash!==state.configHash){
        if(!legacyConfigs.some(c=>hash(c)===stored.configHash))throw Error('Scheduler state checksum/config mismatch');
        if(stored.pending)throw Error('Resolve pending with previous configuration before enabling budget profile');
        // Admission runs under the same lock, before any identity write. A guard cannot mutate stored state.
        if(validateMigration)await validateMigration(structuredClone(stored));
        stored.configHash=state.configHash;save(stored);
      }
      state=stored;
    }
    return await action(state,save);
  }catch(e){primaryError=e;failed=true;throw e;}
  finally{
    traceLock('release',runId,lock);const cleanupErrors=[];
    try{if(fd!==undefined)fs.closeSync(fd);}catch(e){cleanupErrors.push(e);}
    try{fs.unlinkSync(lock);}catch(e){cleanupErrors.push(e);}
    if(cleanupErrors.length){
      traceLock('releaseError',runId,lock,{codes:cleanupErrors.map(e=>e.code)});
      if(!failed&&cleanupErrors.length===1)throw cleanupErrors[0];
      const error=new AggregateError(failed?[primaryError,...cleanupErrors]:cleanupErrors,
        'State cleanup failed'+(failed?': '+String(primaryError?.message||primaryError):''),{cause:failed?primaryError:cleanupErrors[0]});
      for(const key of ['code','stage','transactionHash','definiteRejection'])if(primaryError?.[key]!==undefined)error[key]=primaryError[key];
      error.cleanupErrors=cleanupErrors;throw error;
    }
    if(process.env.LOCAL_STATE_LOCK_TRACE==='1')traceLock('released',runId,lock,{remaining:inspectLock(lock)});
  }
}
module.exports={withState,inspectLock};
