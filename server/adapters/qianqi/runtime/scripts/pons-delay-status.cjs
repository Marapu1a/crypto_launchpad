// Read-only explanation of an existing result. Never controls retries or sends.
const messages={
 recognitionFinality:'Purchase confirmation is waiting for finalized chain time to reach the announced deadline.',
 recognitionNotice:'Additional purchase confirmations await the announced time. Existing draw processing remains enabled.',
 recognitionIndexCatchup:'Purchase confirmation is waiting for the finalized index before new draws.',
 indexerBehind:'Indexer is catching up. Keep the saved state and wait.',
 indexerStale:'Indexer data is stale. Restore indexing before starting new draws.',
 indexerUnavailable:'Indexer snapshot is unavailable. Restore the original state; do not reset tickets.',
 prizeFunding:'Prize funding is below the required amount. Keep tickets and wait for funding.',
 historyUnavailable:'Saved history or its identity cannot be verified. Restore valid evidence; do not reset state.',
 otherWait:'A prerequisite is not ready. Inspect the detailed pass result before resuming.',
 gasPrice:'Gas is above the configured ceiling. Wait for it to fall.',
 nativeFunding:'Operational ETH is insufficient. Top up operations; prize funds stay reserved.',
 pendingNonce:'A signer transaction is pending. Reconcile it before sending more.',
 pendingReceipt:'Receipt is pending. Check the same transaction; do not resend blindly.',
 unknownHash:'Send outcome is unknown. Reconcile the saved intent before resuming.',
 beaconUnavailable:'The required drand beacon is unavailable. Wait for the same round.',
 roundNotDue:'Waiting for the scheduled drand round.',
 seed:'Waiting for the assigned randomness result.',
 fundingUnavailable:'Funding could not be checked. Existing prize obligations remain valid.',
 fundingWaiting:'Funding or fee conversion is waiting. Only received funds count as available.',
 operationFailed:'An operation failed. Inspect its saved state and evidence before resuming.',
 SCHEDULER_STORAGE_ERROR:'State could not be saved. Restore writable storage before resuming.'
};
function explain(report){
 const reasons=new Set();let attention=['error','blocked'].includes(report.status);
 function visit(x){
  if(!x||typeof x!=='object')return;
  if(Array.isArray(x)){x.forEach(visit);return;}
  if(['error','blocked'].includes(x.status))attention=true;
  if(x.status==='error')reasons.add('operationFailed');
  if(messages[x.reason])reasons.add(x.reason);
  else if(typeof x.reason==='string'&&x.reason.startsWith('indexer')){reasons.add('historyUnavailable');attention=true;}
  else if(x.status==='waiting'&&x.reason&&!['poll','newJobsDeferred','obligationsOnly','transactionLimit','draining'].includes(x.reason))reasons.add('otherWait');
  if(x.fundingError)reasons.add('fundingUnavailable');
  if(x.claimFailures?.length||x.failures?.length||x.status==='reverted'||x.status==='rejected'){reasons.add('operationFailed');attention=true;}
  for(const [k,v]of Object.entries(x))if(k!=='steps'&&v&&typeof v==='object')visit(v);
 }
 visit(report);
 if(report.results?.funding?.some(x=>['waiting','unavailable'].includes(x.status)))reasons.add('fundingWaiting');
 if(['unknownHash','SCHEDULER_STORAGE_ERROR'].some(x=>reasons.has(x)))attention=true;
 if(attention&&!reasons.size)reasons.add('operationFailed');
 return {state:report.status==='stopped'?'stopped':attention?'attention':report.status==='waiting'||reasons.size?'waiting':'clear',
  reasons:[...reasons].sort().map(code=>({code,message:messages[code]})),
  scope:'Explanation of this pass only; clear does not mean every draw is ready.'};
}
module.exports={explain};
