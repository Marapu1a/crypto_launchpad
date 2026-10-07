// One durable candidate per draw kind. A checkpoint is history, never a proposal.
const {sendLocalTransaction}=require('./local-receipt.cjs');
const zero='0x'+'0'.repeat(64),check=(v,m)=>{if(!v)throw Error(m);};
async function prepareCutoff({provider,source,publisher,kind,state,save,finalized,signal,receiptTimeoutMs}){
 const wait=reason=>({status:'waiting',reason});
 state.cutoffs??={};let candidate=state.cutoffs[kind];
 const head=await provider.getBlock('latest');
 if(!candidate){
  // Admission delay applies to begin, not to historical hash capture.
  const n=head.number-1;
  if(n<0)return wait('cutoffDelay');
  const b=await provider.getBlock(n);check(b?.hash,'Missing checkpoint candidate');
  candidate={number:b.number,hash:b.hash};state.cutoffs[kind]=candidate;save(state);
 }
 check(Number.isSafeInteger(candidate.number)&&candidate.number>=0&&/^0x[0-9a-fA-F]{64}$/.test(candidate.hash),'Invalid cutoff candidate');
 const block=await provider.getBlock(candidate.number);
 if(!block||block.hash!==candidate.hash){
  // No proposal/data/RNG exists for this candidate. Reorged history gives no rights.
  state.lastCutoffDiscard={kind,...candidate,reason:'canonical block changed'};
  delete state.cutoffs[kind];save(state);return {status:'progress',action:'discardCutoff'};
 }
 const cached=await source.cutoffHashes(candidate.number);
 check(cached===zero||cached===candidate.hash,'Checkpoint hash mismatch');
 if(cached===zero){
  if(head.number+1-candidate.number>256){
   state.lastCutoffDiscard={kind,...candidate,reason:'uncheckpointed candidate expired'};
   delete state.cutoffs[kind];save(state);return {status:'progress',action:'discardCutoff'};
  }
  if(!publisher)return wait('publisher');
  const sender=await publisher.getAddress();
  if(await provider.getTransactionCount(sender,'pending')>await provider.getTransactionCount(sender,'latest'))return wait('pendingTransaction');
  const price=(await provider.getFeeData()).gasPrice;
  if(price==null||price>await source.maxGasPrice())return wait('gasPrice');
  if(signal?.aborted)return {status:'stopped'};
  const receipt=await sendLocalTransaction(source.connect(publisher).checkpointCutoff,[candidate.number],
   {type:2,maxFeePerGas:price,maxPriorityFeePerGas:0},{signal,receiptTimeoutMs});
  return {status:'progress',action:'checkpointCutoff',transactionHash:receipt.hash};
 }
 if(finalized.number<candidate.number)return wait('cutoffFinality');
 // Wait for the checkpoint transaction too; latest storage alone is not finality.
 if(await source.cutoffHashes(candidate.number,{blockTag:finalized.number})!==candidate.hash)return wait('cutoffCheckpointFinality');
 check((await provider.getBlock(finalized.number))?.hash===finalized.hash,'Finalized checkpoint changed');
 check((await provider.getBlock(candidate.number))?.hash===candidate.hash,'Cutoff changed during admission');
 return {status:'ready',block};
}
module.exports={prepareCutoff};
