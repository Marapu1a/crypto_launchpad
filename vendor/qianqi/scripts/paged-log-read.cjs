// Fixed-height, read-only pagination. Callers retain their provenance/commitment checks.
async function pagedLogs(from,to,read){
 if(!Number.isSafeInteger(from)||from<0||!Number.isSafeInteger(to)||to<0)throw Error('Invalid log range');
 const logs=[];
 for(let start=from;start<=to;start+=10000){
  const end=Math.min(to,start+9999),page=await read(start,end);
  if(!Array.isArray(page))throw Error('Missing log page');
  for(const event of page){
   const height=Number(event.blockNumber);
   if(event.removed||!Number.isSafeInteger(height)||height<start||height>end)throw Error('Log outside canonical page');
  }
  logs.push(...page);
 }
 return logs;
}
module.exports={pagedLogs};
