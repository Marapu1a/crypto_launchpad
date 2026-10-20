// Scheduling and contract projection policy shared by every Pons adapter.
export const RECEIPT_RETRY_MS=60000;
const deferred=new Set(['receipt','receipt-finality','receiptFinality','finality-unavailable','snapshot-finality','recognition-finality','interval-finality','beacon-time-finality','finality-regression','chain-clock','beacon-unavailable','latest-beacon-unavailable']);
const resource=new Set(['funding-unavailable','native-balance','gas-price','gas-limit','external-pending-nonce']);
export function schedulePonsResult(result,now=Date.now()){
 if(Number.isSafeInteger(result.retryAt))return result;
 const delay=deferred.has(result.reason)?RECEIPT_RETRY_MS:resource.has(result.reason)?300000:0;
 return delay?{...result,retryAt:now+delay}:result;
}
export function shouldPublishContracts(result){
 return !['blocked','error','paused','busy'].includes(result.status)&&!deferred.has(result.reason)&&!resource.has(result.reason)&&!['controllerReceiptsRequired','unknownControllerJob'].includes(result.reason);
}
