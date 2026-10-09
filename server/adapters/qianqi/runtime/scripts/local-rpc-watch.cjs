// Retry transport failures only. A JSON-RPC error, changed network or storage failure
// is not evidence that repeating an operation is safe.
function transientRpc(error,seen=new Set()){
  if(!error||typeof error!=='object'||seen.has(error))return false;
  seen.add(error);
  if(error.cleanupErrors||error instanceof AggregateError||
    ['SCHEDULER_STORAGE_ERROR','CALL_EXCEPTION','TRANSACTION_REPLACED'].includes(error.code)||
    error.code==='NETWORK_ERROR'&&error.event!=='initial-network-discovery'&&error.event!=='noNetwork')return false;
  if(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','TIMEOUT'].includes(error.code)||error.name==='TimeoutError')return true;
  if(['SERVER_ERROR','RPC_HTTP_ERROR'].includes(error.code)&&[429,502,503,504].includes(error.response?.statusCode??error.statusCode))return true;
  return transientRpc(error.cause,seen)||transientRpc(error.info?.error,seen);
}
function retryableRead(error){return !error?.transactionHash&&(!error?.stage||error.stage==='estimate')&&transientRpc(error);}
function sleep(ms,signal){return new Promise(resolve=>{
  const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
  const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});if(signal?.aborted)done();
});}
// Each retry is a new bounded pass through the existing journal/lock/reconciliation.
async function runWatch({pass,watch=false,pollMs,signal,emit=()=>{},wait=sleep,observe}){
  if(!Number.isFinite(pollMs)||pollMs<=0)throw Error('Invalid watch poll interval');
  let failures=0;
  while(!signal?.aborted){
    let result;
    try{result=await pass();}
    catch(error){
      if(!watch||!retryableRead(error))throw error;
      result={status:'error',retryableRpcRead:true,error:{code:error.code,message:error.message}};
    }
    if(signal?.aborted){emit({status:'stopped'});return 0;}
    // Optional status persistence is independent of execution/retry decisions.
    let observation={};
    if(observe)try{observation=await observe(result);}catch{observation={statusObservationError:'Operational status could not be persisted; execution journal is unchanged.'};}
    const rpc=watch&&result.retryableRpcRead===true&&!result.requiresOperatorAction&&
      (!result.pending||!!result.pending.transactionHash);
    const receipt=watch&&result.status==='blocked'&&result.reason==='pendingReceipt'&&!!result.pending?.transactionHash&&!result.requiresOperatorAction;
    if(rpc||receipt){
      const delay=rpc?Math.min(30000,1000*2**Math.min(failures++,5)):pollMs;
      if(!rpc)failures=0;
      emit({status:'waiting',reason:rpc?'rpcUnavailable':'pendingReceipt',retryInMs:delay,
        consecutiveFailures:failures,transactionHash:result.pending?.transactionHash,error:result.error,...observation});
      await wait(delay,signal);continue;
    }
    failures=0;emit({...result,...observation});
    if(['blocked','error'].includes(result.status))return 1;
    if(!watch||result.status==='stopped')return 0;
    await wait(pollMs,signal);
  }
  emit({status:'stopped'});return 0;
}
module.exports={transientRpc,retryableRead,runWatch,sleep};
