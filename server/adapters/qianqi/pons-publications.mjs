// Publication discovery uses known transaction receipts, never a chain-wide log range.
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const check=(ok,message)=>{if(!ok)throw Error(message);};
export function rememberPublications(state,receipt,sources){
 for(const source of sources)for(const log of receipt.logs){
  if(!same(log.address,source.target))continue;
  let parsed;try{parsed=source.interface.parseLog(log);}catch{continue;}
  if(!['DatasetChunk','MonthChunk'].includes(parsed?.name))continue;
  state.publications??={};const key=receipt.hash.toLowerCase()+':'+log.index;
  const ref={address:source.target.toLowerCase(),transactionHash:receipt.hash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,logIndex:log.index,topics:[...log.topics]};
  check(!state.publications[key]||JSON.stringify(state.publications[key])===JSON.stringify(ref),'Publication receipt changed');state.publications[key]=ref;
 }
}
export function receiptPublicationSource(source,provider,references){
 return new Proxy(source,{get(target,key){
  if(key!=='queryFilter')return Reflect.get(target,key,target);
  return async(filter,from,to)=>{
   const topics=await filter.getTopicFilter();
   check(['DatasetChunk','MonthChunk'].some(name=>{try{return same(target.interface.getEvent(name)?.topicHash,topics[0]);}catch{return false;}}),'Unsupported publication filter');
   check(Number.isSafeInteger(from)&&Number.isSafeInteger(to),'Explicit publication range required');
   const matches=log=>topics.every((topic,i)=>topic===null||same(log.topics[i],topic));
   const selected=Object.values(references()??{}).filter(r=>same(r.address,target.target)&&r.blockNumber>=from&&r.blockNumber<=to&&matches(r)),events=[];
   const receipts=new Map();
   for(const ref of selected){
    if(!receipts.has(ref.transactionHash))receipts.set(ref.transactionHash,await provider.getTransactionReceipt(ref.transactionHash));
    const receipt=receipts.get(ref.transactionHash);
    check(receipt?.status===1&&same(receipt.hash,ref.transactionHash)&&receipt.blockNumber===ref.blockNumber&&same(receipt.blockHash,ref.blockHash),'Publication receipt unavailable/changed');
    check(same((await provider.getBlock(ref.blockNumber))?.hash,ref.blockHash),'Publication receipt reorg');
    const log=receipt.logs.find(l=>l.index===ref.logIndex);
    check(log&&!log.removed&&same(log.address,target.target)&&same(log.transactionHash,ref.transactionHash)&&log.blockNumber===ref.blockNumber&&same(log.blockHash,ref.blockHash)&&matches(log),'Publication log changed');
    events.push({transactionHash:ref.transactionHash,blockNumber:ref.blockNumber,blockHash:ref.blockHash,index:ref.logIndex,args:target.interface.parseLog(log).args});
   }
   return events.sort((a,b)=>a.blockNumber-b.blockNumber||a.index-b.index);
  };
 }});
}
