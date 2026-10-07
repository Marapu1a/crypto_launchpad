// Bounded, restartable discovery only. No transactions are sent here.
const {ZeroAddress}=require('ethers');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const check=(ok,message)=>{if(!ok)throw Error(message);};
// QuickNode's verified log range is 10,000 blocks. Bound each invocation too,
// so catching up never monopolizes the coordinator. No change to stored cursors.
async function scanPayouts({provider,short,monthly,state,save,anchor,signal,pageSize=10000,maxBlocks=100000}){
 check(Number.isSafeInteger(pageSize)&&pageSize>0&&pageSize<=10000,'Invalid payout page size');
 check(Number.isSafeInteger(maxBlocks)&&maxBlocks>0&&maxBlocks<=100000,'Invalid payout scan budget');
 const head=await provider.getBlock('latest');
 check(Number.isSafeInteger(head?.number),'Missing payout head');
 let cursor=state.cursor||anchor;
 check(Number.isSafeInteger(cursor.number)&&cursor.number>=0,'Invalid payout cursor');
 check(same((await provider.getBlock(cursor.number))?.hash,cursor.hash),'Payout cursor reorg; explicit recovery required');
 const limit=Math.min(head.number,cursor.number+maxBlocks);
 for(let from=cursor.number+1;from<=limit;from+=pageSize){
  if(signal?.aborted)throw Object.assign(Error('stopped'),{code:'LOCAL_BUDGET_WAIT'});
  const to=Math.min(limit,from+pageSize-1),end=await provider.getBlock(to),pending=[];
  check(end?.hash,'Missing payout scan boundary');
  for(const [source,kind]of [[short,0],[monthly,1]]){
   const events=await source.queryFilter(source.filters.AttemptsConsumed(null,kind),from,to);
   for(const e of events){
    check(!e.removed&&Number.isSafeInteger(e.blockNumber)&&e.blockNumber>=from&&e.blockNumber<=to,'Payout event outside window');
    check(same((await provider.getBlock(e.blockNumber))?.hash,e.blockHash),'Payout event reorg');
    const at={blockTag:to};
    const r=kind===0?await short.shortResult(e.args.drawId,at):await monthly.month(e.args.drawId,at);
    check(same(r.resultHash,e.args.resultHash),'Payout result mismatch');
    const winners=kind===0?Array.from(r.winners):[r.winner];
    for(const winner of new Set(winners.filter(w=>!same(w,ZeroAddress)).map(w=>w.toLowerCase())))
     if(![...(state.payouts||[]),...pending].some(p=>same(p.draw,e.args.drawId)&&same(p.winner,winner)))
      pending.push({draw:e.args.drawId,winner,blockNumber:e.blockNumber,blockHash:e.blockHash});
   }
  }
  // Recheck both sides after all reads; failed/partial windows never enter state.
  check(same((await provider.getBlock(cursor.number))?.hash,cursor.hash),'Payout cursor reorg; explicit recovery required');
  check(same((await provider.getBlock(to))?.hash,end.hash),'Payout scan changed');
  state.payouts=[...(state.payouts||[]),...pending];
  state.cursor={number:to,hash:end.hash};save(state);cursor=state.cursor;
 }
}
module.exports={scanPayouts};
