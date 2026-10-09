// Synthetic committed participants, real public controllers/adapter. No BUY/indexer proof.
const {ethers}=require('ethers'),{rpc,sent}=require('./public-controllers.cjs');
const {hash}=require('../../scripts/direct-buy.cjs'),{domainFor,snapshotFor}=require('../../scripts/attempt-lifecycle.cjs');
const sd=require('../../scripts/short-dataset.cjs'),md=require('../../scripts/monthly-dataset.cjs');
const vector=require('../../research/drand-feasibility/vector.json').beacon,target=1727521075+(vector.round-1)*3;
async function prepare(f,{freeze=true,participants,fund=true}={}){
 const ps=participants??require('./short-outcome.cjs').participants(2,1).map(p=>({wallet:p.wallet,firstAttempt:String(p.firstAttempt),lastAttempt:String(p.lastAttempt),count:'1'}));
 if(fund){await sent(f.quote.mint(f.owner,1100_000000));await sent(f.quote.approve(f.vault.target,ethers.MaxUint256));
 for(const [amount,kind]of [[500_000000,1],[500_000000,2],[100_000000,3]])await sent(f.vault.fundUSDG(amount,kind));}
 const attempts=String(ps.reduce((n,p)=>n+BigInt(p.count),0n));
 await rpc('evm_setNextBlockTimestamp',[target-2300]);await rpc('evm_mine');
 const b=await f.head(),cutoff={blockNumber:Number(b.number),blockHash:b.hash},d=domainFor(f.options.schedulerConfig.manifest,f.options.schedulerConfig.lifecycle);
 const {drawIdFor}=require('../../scripts/draw-id.cjs'),sId=drawIdFor('SHORT',ethers.id('recovery short')),mId=drawIdFor('MONTHLY',ethers.id('recovery month')),proposal=ethers.id('recovery proposal');
 const shortHash=(await f.short.shortEpochPolicy(1)).hash,monthHash=(await f.monthly.monthlyEpochPolicy(1)).hash;
 const ss=snapshotFor(d,sId,'SHORT',cutoff,shortHash,ps,1),ms=snapshotFor(d,mId,'MONTHLY',cutoff,monthHash,ps,1);
 const sa={schema:'short-dataset-artifact-v1',snapshot:ss,rules:f.rules,weights:f.weights.map(String),minimumUnit:String(f.minimumUnit),request:{drawId:sId,campaignId:'1',rulesEpoch:'1',cutoffBlockNumber:Number(b.number),cutoffBlockHash:b.hash,snapshotHash:hash(ss),expectedRoot:sd.rootFor(ps),expectedCount:ps.length,expectedAttempts:attempts,budget:'100000000'}};
 const ma={schema:'monthly-dataset-artifact-v1',snapshot:ms,rules:f.monthlyRules,request:{drawId:mId,campaign:'1',rulesEpoch:'1',cutoff:Number(b.number),cutoffHash:b.hash,snapshotHash:hash(ms),root:md.rootFor(ps),count:ps.length,attempts}};
 const sj=require('../../scripts/local-short-executor.cjs').makeJob(sa,proposal,1),mj=require('../../scripts/local-monthly-executor.cjs').makeMonthlyJob(ma,1);
 await require('../../scripts/local-scheduler-state.cjs').withState(f.options.statePath+'.scheduler',f.options.schedulerConfig,async(state,save)=>{state.jobs.SHORT.push({job:sj,started:true});state.jobs.MONTHLY.push({job:mj,started:true});save(state);});
 for(const c of [f.short,f.monthly])await sent(c.checkpointCutoff(b.number));
 await sent(f.short.begin(proposal,sa.request));await sent(f.short.publish(proposal,ps));await sent(f.monthly.beginMonth(ma.request));await sent(f.monthly.publishMonth(mId,ps));
 if(freeze){
  await rpc('evm_setNextBlockTimestamp',[target-1801]);await rpc('evm_setAutomine',[false]);
  try{const a=await f.short.seal(proposal,{gasLimit:3000000}),b=await f.monthly.sealMonth(mId,{gasLimit:3000000});await rpc('evm_mine');await a.wait();await b.wait();}finally{await rpc('evm_setAutomine',[true]);}
  await rpc('evm_setNextBlockTimestamp',[target+10]);await rpc('evm_mine');
 }
 return {sId,mId,proposal,sa,ma};
}
const beacon=async round=>{require('node:assert/strict').equal(round,String(vector.round));return vector;};
module.exports={prepare,beacon,target};
