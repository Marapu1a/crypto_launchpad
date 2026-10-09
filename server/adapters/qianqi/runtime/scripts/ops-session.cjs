// Process ownership and sanitized operator status. Never clears transaction intents.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
function write(file,value){
 const tmp=file+'.tmp',bytes=JSON.stringify(value,null,2)+'\n';let fd;
 try{fd=fs.openSync(tmp,'w',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}
 fs.renameSync(tmp,file);
}
async function withOpsSession(statePath,action,{publicExecution=false}={}){
 const file=path.resolve(statePath),lock=file+'.service.lock';fs.mkdirSync(path.dirname(file),{recursive:true});
 const owner=JSON.stringify({pid:process.pid,token:randomUUID()}),fd=fs.openSync(lock,'wx',0o600);
 try{fs.writeFileSync(fd,owner);}finally{fs.closeSync(fd);}
 const startedAt=new Date().toISOString();let lastKey=null,lastState=null,lastReport={status:'waiting',reason:'poll'},pass=0;
 function publish(report){
  const explanation=require('./pons-delay-status.cjs').explain(report);
  const value={schema:'qianqi-operator-status-v1',pid:process.pid,startedAt,observedAt:new Date().toISOString(),pass,
   state:explanation.state,reasons:explanation.reasons,publicExecution};
  write(file+'.status.json',value);
  const key=JSON.stringify([value.state,value.reasons]);
  if(key!==lastKey){fs.appendFileSync(file+'.events.jsonl',JSON.stringify(value)+'\n',{mode:0o600});lastKey=key;}
  lastReport=report;lastState=value.state;return value;
 }
 try{
  publish({status:'waiting',reason:'poll'});
  const result=await action({beforePass(){pass++;publish(lastReport);},publish});
  if(lastState!=='attention')publish({status:'stopped'});return result;
 }catch(e){try{publish({status:'error',reason:e.code==='SCHEDULER_STORAGE_ERROR'?e.code:'operationFailed'});}catch{}throw e;}
 finally{if(fs.readFileSync(lock,'utf8')!==owner)throw Error('Operator service lock changed');fs.unlinkSync(lock);}
}
function readStatus(file,maxAgeMs,now=Date.now()){
 if(!Number.isFinite(maxAgeMs)||maxAgeMs<=0)throw Error('Positive status age required');
 try{const s=JSON.parse(fs.readFileSync(file,'utf8')),age=now-Date.parse(s.observedAt);
  if(s.schema!=='qianqi-operator-status-v1'||!Number.isFinite(age)||age<0||age>maxAgeMs)return {state:'unavailable',reason:'statusStale'};
  return s;
 }catch{return {state:'unavailable',reason:'statusUnavailable'};}
}
module.exports={withOpsSession,readStatus};
if(require.main===module){const result=readStatus(process.argv[2],Number(process.argv[3]));console.log(JSON.stringify(result));if(['attention','unavailable'].includes(result.state))process.exitCode=1;}
