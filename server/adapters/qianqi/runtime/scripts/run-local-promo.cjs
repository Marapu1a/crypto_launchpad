// Unlocked loopback RPC accounts only. Never reads private keys or delivers seed.
const fs=require('node:fs');
const {ethers}=require('ethers');
const short=require('./local-short-executor.cjs'),monthly=require('./local-monthly-executor.cjs');
const funding=require('./local-usdg-funding.cjs');
const revenue=require('./local-usdg-revenue.cjs');
const prize=require('./local-prize-flow.cjs');
async function main(){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(key==='--watch'){options.watch=true;continue;}
    if(!['--job','--rpc','--publisher','--executor'].includes(key)||args[i+1]==null)throw Error('Expected --job FILE --rpc LOOPBACK [--publisher INDEX] [--executor INDEX] [--watch]');
    options[key.slice(2)]=args[++i];
  }
  if(!options.job||!options.rpc)throw Error('Missing --job/--rpc');
  const url=new URL(options.rpc);
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('Loopback HTTP RPC only');
  const job=JSON.parse(fs.readFileSync(options.job,'utf8'));
  const isPrize=job.schema==='local-prize-flow-v1';
  const isMonthly=job.schema==='local-monthly-job-v1';
  const isRevenue=job.schema==='local-usdg-revenue-v1';
  const isFunding=job.schema==='local-usdg-funding-v1'||isRevenue;
  (isPrize?prize.validatePrizeFlowJob:isRevenue?revenue.validateRevenueJob:isFunding?funding.validateFundingJob:isMonthly?monthly.validateMonthlyJob:short.validateJob)(job);
  const run=isPrize?prize.runPrizeFlow:isRevenue?revenue.runRevenue:isFunding?funding.runFunding:isMonthly?monthly.runMonthly:short.runShort;
  const provider=new ethers.JsonRpcProvider(options.rpc,undefined,{cacheTimeout:-1});
  try{
    if((await provider.getNetwork()).chainId!==31337n)throw Error('Local chain 31337 only');
    const artifacts=JSON.parse(fs.readFileSync('artifacts/compiled.json','utf8'));
    const moneyJob=isRevenue?job.funding:job;
    const bindings=isPrize?{router:new ethers.Contract(job.router,artifacts.FeeRouter.abi,provider)}:isFunding?{
      router:new ethers.Contract(moneyJob.router,artifacts.FeeRouter.abi,provider),
      vault:new ethers.Contract(moneyJob.vault,artifacts.PromoVault.abi,provider)
    }:{source:new ethers.Contract(job.artifact.snapshot.domain[isMonthly?'monthlySource':'source'],
      artifacts[isMonthly?'LocalMonthlyController':'LocalShortController'].abi,provider)};
    async function signer(index){
      if(index==null)return undefined;
      if(!/^\d+$/.test(index)||!Number.isSafeInteger(Number(index)))throw Error('Invalid account index');
      return provider.getSigner(Number(index));
    }
    const publisher=await signer(options.publisher),executor=await signer(options.executor??'0');
    const stop=new AbortController(),interrupt=()=>stop.abort();process.once('SIGINT',interrupt);
    try{
      do{
        const result=await run({provider,...bindings,job,publisher,executor},{signal:stop.signal,onStep:r=>console.log(JSON.stringify(r))});
        if(isPrize||isRevenue)console.log(JSON.stringify({action:isPrize?'prizeFlowPass':'revenuePass',...result}));
        if(result.status==='error'){process.exitCode=1;break;}
        if(result.status==='terminal'||result.status==='stopped'||!options.watch)break;
        await new Promise(resolve=>{
          const finish=()=>{clearTimeout(timer);stop.signal.removeEventListener('abort',finish);resolve();};
          const timer=setTimeout(finish,(isPrize||isRevenue)?job.pollSeconds*1000:isFunding?10000:1000);
          stop.signal.addEventListener('abort',finish,{once:true});if(stop.signal.aborted)finish();
        });
      }while(!stop.signal.aborted);
    }finally{process.removeListener('SIGINT',interrupt);}
  }finally{provider.destroy();}
}
function reportError(error){
  console.error(JSON.stringify({status:'error',message:error.message,code:error.code,stage:error.stage,transactionHash:error.transactionHash}));
  process.exitCode=1;
}
if(require.main===module)main().catch(reportError);
module.exports={main,reportError};
