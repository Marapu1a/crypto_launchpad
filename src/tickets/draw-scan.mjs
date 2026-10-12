import {scanProductionLedger} from './draw-ledger.mjs';
import {check,same} from '../worker/production-template.mjs';

// RPC log discovery is bounded to this instance. Full canonical transactions,
// receipts and route evidence are still validated by the ordinary ledger scanner.
export async function scanDrawHistory(provider,policy,ledger,finalized){
 const original={...ledger.head},target=Math.min(finalized.number,original.number+5000);
 check(finalized.number>=original.number,'Finalized index moved backwards');
 check(same((await provider.getBlock(original.number))?.hash,original.hash),'Indexed finalized branch changed');
 const addresses=['curve','token','recognition'].map(k=>policy.contracts[k].address.toLowerCase());
 const found=[];
 for(let from=original.number+1;from<=target;from+=1000){
  const to=Math.min(from+999,target),logs=await provider.getLogs({address:addresses,fromBlock:from,toBlock:to});
  for(const log of logs){
   check(!log.removed&&addresses.includes(log.address.toLowerCase())&&Number.isSafeInteger(log.blockNumber)&&log.blockNumber>=from&&log.blockNumber<=to,'Invalid discovery log');
   found.push(log);
  }
 }
 const blocks=[...new Set(found.map(l=>l.blockNumber))].sort((a,b)=>a-b);
 for(const n of blocks){
  const block=await provider.getBlock(n),previous=await provider.getBlock(n-1);
  check(block&&previous&&same(block.parentHash,previous.hash)&&found.filter(l=>l.blockNumber===n).every(l=>same(l.blockHash,block.hash)),'Discovery branch changed');
  ledger.head={number:previous.number,hash:previous.hash,timestamp:previous.timestamp};
  await scanProductionLedger(provider,policy,ledger,{number:n},1);
  for(const log of found.filter(l=>l.blockNumber===n)){
   const receipt=await provider.getTransactionReceipt(log.transactionHash);
   check(receipt&&same(receipt.blockHash,block.hash)&&receipt.logs.some(l=>l.index===log.index&&same(l.address,log.address)&&same(l.data,log.data)&&JSON.stringify(l.topics)===JSON.stringify(log.topics)),'Discovery receipt mismatch');
  }
 }
 const end=await provider.getBlock(target);
 check(end&&end.number===target&&same((await provider.getBlock(original.number))?.hash,original.hash),'Scan branch changed');
 check(same((await provider.getBlock(target))?.hash,end.hash),'Scan end changed');
 ledger.head={number:end.number,hash:end.hash,timestamp:end.timestamp};
 return target===finalized.number;
}
