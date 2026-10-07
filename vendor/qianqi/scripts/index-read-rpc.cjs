// Shared pacing and bounded retry for one read-only index pass. Never retries sends.
const allowed=new Set(['eth_chainId','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getStorageAt','eth_call','eth_getLogs','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockReceipts','eth_getBalance']);
// Conservative Alchemy throughput weights (billing CU and throughput CU differ).
const weights={eth_chainId:0,eth_getBlockByNumber:16,eth_getBlockByHash:16,eth_getCode:20,eth_call:26,eth_getLogs:75,eth_getTransactionReceipt:20,eth_getBlockReceipts:500,eth_getBalance:19,eth_getStorageAt:17};
function pacedReads(send,{intervalMs=0,unitsPerSecond=450,retries=3,retryMs=1000}={}){
 if(!Number.isFinite(unitsPerSecond)||unitsPerSecond<=0||!Number.isFinite(intervalMs)||intervalMs<0||!Number.isInteger(retries)||retries<0||retries>5)throw Error('Invalid RPC pacing');
 let next=0,cooldown=0,turn=Promise.resolve();
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function slot(method){
  const admission=turn.then(async()=>{while(Math.max(next,cooldown)>Date.now())await sleep(Math.max(next,cooldown)-Date.now());next=Date.now()+Math.max(intervalMs,1000*(weights[method]??26)/unitsPerSecond);});
  turn=admission.catch(()=>{});await admission;
 }
 return async(method,params=[])=>{
  if(!allowed.has(method))throw Error('Indexer RPC must be read-only');
  for(let attempt=0;;attempt++){
   await slot(method);try{return await send(method,params);}catch(e){
    if(e.code!=='RPC_READ_UNAVAILABLE'||attempt>=retries)throw e;
    cooldown=Math.max(cooldown,Date.now()+retryMs*2**attempt);
   }
  }
 };
}
module.exports={pacedReads};
