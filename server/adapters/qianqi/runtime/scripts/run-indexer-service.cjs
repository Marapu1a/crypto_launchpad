// Read-only runtime: one owner, sequential isolated index passes, independently responsive API.
const fs=require('node:fs'),path=require('node:path'),{fork}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {createServer}=require('./user-status-api.cjs');
function acquire(file){
 const owner=JSON.stringify({pid:process.pid,token:randomUUID()});
 const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,owner);}finally{fs.closeSync(fd);}
 return ()=>{if(fs.readFileSync(file,'utf8')!==owner)throw Error('Service lock changed');fs.unlinkSync(file);};
}
async function startService({config:input,rpcUrl,port=8787,pollMs=10000,passTimeoutMs=120000,onStatus=()=>{}}){
 const config=structuredClone(input);
 if(!path.isAbsolute(config.indexer?.statePath??'')||!Number.isFinite(config.indexer.maxAgeSeconds)||config.indexer.maxAgeSeconds<=0||!rpcUrl||!Number.isInteger(port)||port<0||port>65535||!Number.isInteger(pollMs)||pollMs<10||!Number.isInteger(passTimeoutMs)||passTimeoutMs<100)throw Error('Invalid service configuration');
 const statePath=config.indexer.statePath,lock=statePath+'.lock';fs.mkdirSync(path.dirname(statePath),{recursive:true});
 const release=acquire(statePath+'.service.lock');
 let child=null,timer=null,watchdog=null,stopping=false,attention=null,last=null,lastFailure=null,attempts=0,successes=0,failures=0,passStartedAt=null,serverStopped=false;
 let completeClose;const closed=new Promise(r=>{completeClose=r;});
 const health=()=>{
  const age=last?Date.now()-Date.parse(last.observedAt):null;
  const fresh=age!==null&&age>=0&&age<=config.indexer.maxAgeSeconds*1000;
  const status=stopping?'stopping':attention?'needsAttention':lastFailure?'waiting':!last?'starting':!fresh?'stale':last.policyMode!=='admitted'?'unadmitted':last.state==='catchingUp'?'catchingUp':'ready';
  return {schema:'promo-service-health-v1',status,ready:status==='ready',reason:attention??lastFailure,activePass:!!child,indexerPid:child?.pid??null,passStartedAt,attempts,successes,failures,
   snapshotFresh:fresh,policyMode:last?.policyMode??null,observedAt:last?.observedAt??null,ageSeconds:age===null?null:Math.max(0,Math.floor(age/1000)),processedBlock:last?.processedBlock??null,targetBlock:last?.targetBlock??null,lagBlocks:last?.metrics?.lagBlocks??null,
   processedTimestamp:last?.processedTimestamp??null,metrics:last?.metrics??null,scope:'last-index-pass; not-live-finality-or-wallet-readiness'};
 };
 const emit=()=>{try{onStatus(health());}catch{}};
 const server=createServer(config,{health});
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
 catch(e){release();throw e;}
 function finishClose(){if(!stopping||child||!serverStopped)return;try{release();}catch{attention='serviceLockChanged';}completeClose();}
 function schedule(delay){if(!stopping&&!attention)timer=setTimeout(run,delay);}
 function run(){
  if(stopping||attention)return;
  if(fs.existsSync(lock)){attention='indexerLock';emit();return;}
  attempts++;passStartedAt=new Date().toISOString();let report=null,settled=false,timedOut=false;
  let p;
  try{p=fork(path.join(__dirname,'indexer-service-child.cjs'),[],{env:{...process.env,RH_RPC_URL:rpcUrl},stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});child=p;}
  catch{failures++;lastFailure='spawnFailed';emit();schedule(pollMs);return;}
  p.on('message',value=>{report=value;});
  const done=()=>{
   if(settled)return;settled=true;clearTimeout(watchdog);child=null;
   // Only our confirmed exited child may have its own leftover pass lock removed.
   try{if(fs.existsSync(lock)){if(!p.pid||fs.readFileSync(lock,'utf8')!==String(p.pid))attention='indexerLock';else fs.unlinkSync(lock);}}
   catch{attention='indexerLock';}
   if(report?.ok&&!timedOut){last=report.status;lastFailure=null;successes++;}
   else{failures++;lastFailure=timedOut?'passTimeout':report?.reason??'indexerExited';if(report?.attention)attention=report.reason;}
   emit();
   if(stopping){finishClose();return;}
   schedule(report?.ok&&report.status.state==='catchingUp'?0:pollMs);
  };
  p.once('exit',done);
  p.once('error',()=>{if(!p.pid)done();else p.kill();});
  watchdog=setTimeout(()=>{timedOut=true;p.kill('SIGKILL');},passTimeoutMs);
  try{p.send({config});}catch{p.kill();}
  emit();
 }
 function close(){
  if(stopping)return closed;stopping=true;clearTimeout(timer);server.close(()=>{serverStopped=true;finishClose();});server.closeAllConnections();
  if(child)child.kill();else finishClose();return closed;
 }
 schedule(0);
 return {server,health,close};
}
async function main(){
 const [file,port='8787']=process.argv.slice(2);
 const config=JSON.parse(fs.readFileSync(file,'utf8'));
 const rpcUrl=process.env.CREDENTIALS_DIRECTORY?require('./service-credentials.cjs').rpc():process.env.RH_RPC_URL;
 const service=await startService({config,rpcUrl,port:Number(port),pollMs:Number(process.env.RH_INDEXER_POLL_MS??10000),passTimeoutMs:Number(process.env.RH_INDEXER_PASS_TIMEOUT_MS??120000),onStatus:s=>console.log(JSON.stringify(s))});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void service.close());
}
if(require.main===module)main().catch(()=>{console.error('Service startup refused: check configuration, RPC environment, port and service lock');process.exitCode=78;});
module.exports={startService};
