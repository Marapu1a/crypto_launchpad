import {check,same} from './store.mjs';

// A successful canonical receipt permits the next owner step. Recheck the entire
// prefix each time; do not silently replay steps after a reorg.
export async function verifyOwnerHistory(provider,history){
 for(const step of history){
  const [block,receipt]=await Promise.all([provider.getBlock(step.blockNumber),provider.getTransactionReceipt(step.hash)]);
  check(same(block?.hash,step.blockHash),'Confirmed deployment branch changed');
  check(receipt?.status===1&&receipt.blockNumber===step.blockNumber&&same(receipt.blockHash,step.blockHash),'Confirmed deployment receipt changed');
 }
}
export async function ownerFinality(provider,history){
 await verifyOwnerHistory(provider,history);
 const target=Math.max(0,...history.map(step=>step.blockNumber));
 let block;try{block=await provider.getBlock('finalized');}catch{return {ready:false,target,finalized:null};}
 if(!block)return {ready:false,target,finalized:null};
 check(same((await provider.getBlock(block.number))?.hash,block.hash),'Finalized branch changed');
 return {ready:block.number>=target,target,finalized:block.number};
}
