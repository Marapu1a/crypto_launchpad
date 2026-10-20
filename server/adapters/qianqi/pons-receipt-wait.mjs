// A mined receipt is not an accounted receipt. Wait cheaply before re-entering
// the full scheduler; the normal sync still verifies receipt, branch and logs.
import {RECEIPT_RETRY_MS} from '../../shared/pons-work-policy.mjs';
export {RECEIPT_RETRY_MS};
export function receiptWait(receipt,now=Date.now()){
 return {status:'waiting',reason:'receiptFinality',retryAt:now+RECEIPT_RETRY_MS,
  waitingFor:{transactionHash:receipt.transactionHash,blockNumber:receipt.blockNumber}};
}
export async function pendingFinality({provider,state,now=Date.now()}){
 const r=state.lastResolved;
 if(state.pending||!r||r.status!==1)return null;
 if(!Number.isSafeInteger(r.blockNumber)||r.blockNumber<0||!/^0x[0-9a-f]{64}$/i.test(r.transactionHash))throw Error('Invalid resolved receipt');
 if(state.migration?.controllerReceipts?.[r.transactionHash.toLowerCase()])return null;
 if((await provider.getNetwork()).chainId!==4663n)throw Error('Wrong receipt wait chain');
 const finalized=await provider.getBlock('finalized');
 if(!finalized||!Number.isSafeInteger(finalized.number)||finalized.number<0)throw Error('Missing receipt finality');
 return finalized.number<r.blockNumber?receiptWait(r,now):null;
}
