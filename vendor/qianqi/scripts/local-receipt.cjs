// Shared bounded receipt wait. A stopped/timed-out wait does NOT cancel a tx.
const {AsyncLocalStorage}=require('node:async_hooks');
const transactionBoundary=new AsyncLocalStorage();
const withTransactionBoundary=(boundary,action)=>transactionBoundary.run(boundary,action);
function stopped(tx){
  const error=new Error('Stopped after broadcast; transaction may still confirm: '+tx.hash);
  error.code='LOCAL_EXECUTION_STOPPED';error.transactionHash=tx.hash;return error;
}
async function waitLocalReceipt(tx,{signal,receiptTimeoutMs=30000}={}){
  if(signal?.aborted)throw stopped(tx);
  let abort;
  try{
    const confirmation=tx.wait(1,receiptTimeoutMs);
    const receipt=await (signal?Promise.race([confirmation,new Promise((_,reject)=>{
      abort=()=>reject(stopped(tx));signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
    })]):confirmation);
    if(!receipt||receipt.status!==1){const error=new Error('Transaction not confirmed: '+tx.hash);error.receipt=receipt;throw error;}
    return receipt;
  }catch(error){
    if(error.code==='TIMEOUT'){
      const timeout=new Error('Receipt timeout; inspect the same transaction before retrying: '+tx.hash);
      timeout.code='LOCAL_RECEIPT_TIMEOUT';timeout.transactionHash=tx.hash;throw timeout;
    }
    throw error;
  }finally{if(abort)signal.removeEventListener('abort',abort);}
}
function receiptOptions(timeout){
  if(!Number.isInteger(timeout)||timeout<1||timeout>300000)throw Error('Invalid receipt timeout');
}
// Only this explicit read-only estimate or a receipt for the original tx proves rollback.
async function sendLocalTransaction(method,args,overrides,options={}){
  let stage='estimate',tx;
  const boundary=transactionBoundary.getStore();
  try{
    const network=require('./runtime-network.cjs');await network.beforeSend({journaled:!!(boundary?.preflight&&boundary?.before&&boundary?.sent&&boundary?.confirmed)});
    if(network.isRobinhood())overrides={...overrides,chainId:4663};
    if(boundary?.preflight)await boundary.preflight(await method.populateTransaction(...args,overrides),method.fragment.name);
    if(network.current().publicGuard)await network.current().publicGuard(await method.populateTransaction(...args,overrides),method.fragment.name);
    let estimate;
    try{estimate=await method.estimateGas(...args,overrides);}
    catch(e){await boundary?.estimateFailed?.(e,await method.populateTransaction(...args,overrides),method.fragment.name);throw e;}
    const gasLimit=boundary?.gasLimit?await boundary.gasLimit(estimate):estimate;
    if(options.signal?.aborted){const e=new Error('Stopped before broadcast');e.code='LOCAL_EXECUTION_STOPPED';throw e;}
    // A successful before hook commits the attempt: do not leave a prepared marker by
    // cancelling between persistence and broadcast. Later abort stops wait/subsequent sends.
    if(network.current().publicGuard)await network.current().publicGuard(await method.populateTransaction(...args,{...overrides,gasLimit}),method.fragment.name);
    if(boundary)await boundary.before(await method.populateTransaction(...args,{...overrides,gasLimit}),method.fragment.name);
    stage='broadcast';tx=boundary?.broadcast?await boundary.broadcast(await method.populateTransaction(...args,{...overrides,gasLimit})):await method(...args,{...overrides,gasLimit});
    if(boundary)await boundary.sent(tx);
    stage='confirm';const receipt=await waitLocalReceipt(tx,options);
    if(boundary)await boundary.confirmed(receipt);
    return receipt;
  }catch(cause){
    const error=new Error(cause.shortMessage||cause.message,{cause});
    error.code=cause.code;error.stage=stage;
    if(cause.code==='PONS_PUBLIC_ADMISSION')error.admissionReasons=cause.admissionReasons;
    if(cause.code==='LOCAL_BUDGET_WAIT')error.budget=cause.budget;
    error.transactionHash=tx?.hash||cause.transactionHash;
    error.definiteRejection=(stage==='estimate'&&cause.code==='CALL_EXCEPTION')||
      (stage==='confirm'&&cause.code!=='TRANSACTION_REPLACED'&&cause.receipt?.status===0&&
        typeof tx?.hash==='string'&&cause.receipt.hash===tx.hash);
    if(boundary&&error.definiteRejection&&stage==='confirm')await boundary.confirmed(cause.receipt);
    throw error;
  }
}
module.exports={waitLocalReceipt,receiptOptions,sendLocalTransaction,withTransactionBoundary};
