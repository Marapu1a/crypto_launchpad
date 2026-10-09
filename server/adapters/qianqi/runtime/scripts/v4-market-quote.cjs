const {ethers}=require('ethers');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
function validateMarketQuote(p){
  check(p?.kind==='v4-simulation-v1','Unknown market quote policy');
  for(const name of ['converterHash','adapterHash'])check(/^0x[0-9a-fA-F]{64}$/.test(p[name]),'Invalid '+name);
  for(const name of ['sampleInput','minSampleOutput','maxGasCostWei'])check(typeof p[name]==='string'&&/^[1-9][0-9]*$/.test(p[name]),'Invalid '+name);
  check(Number.isInteger(p.maxImpactBps)&&p.maxImpactBps>=0&&p.maxImpactBps<10000,'Invalid impact');
  check(Number.isInteger(p.maxCandidates)&&p.maxCandidates>=1&&p.maxCandidates<=8,'Invalid candidate bound');
  check(Number.isInteger(p.gasMarginBps)&&p.gasMarginBps>=10000&&p.gasMarginBps<=30000,'Invalid gas margin');
  return p;
}
// eth_call executes the exact converter->adapter->router path, then discards its state.
// This is a current-market simulation, not an independent price oracle.
function createV4MarketQuote({provider,job,onQuote=()=>{}}){
  return async request=>{
    check((await provider.getNetwork()).chainId===31337n,'Local simulation only');
    const entry=[job.active,...job.legacy].find(e=>same(e.address,request.converter));
    check(entry?.execution==='market-v1','Unknown converter');
    const p=validateMarketQuote(entry.marketQuote),at={blockTag:request.block.number};
    for(const [address,digest] of [[entry.address,p.converterHash],[entry.adapter,p.adapterHash]])
      check(ethers.keccak256(await provider.getCode(address,request.block.number))===digest,'Market simulation runtime mismatch');
    const c=new ethers.Contract(entry.address,[
      'function convert(uint256,uint256,uint256,uint256) returns(uint256)',
      'function adapter() view returns(address)','function adapterVersion() view returns(uint256)',
      'function executor() view returns(address)','function projectToken() view returns(address)','function quoteToken() view returns(address)'],provider);
    check(same(request.adapter,entry.adapter)&&same(await c.adapter(at),entry.adapter)&&
      request.version===BigInt(entry.version)&&await c.adapterVersion(at)===request.version&&
      same(await c.executor(at),entry.executor)&&same(await c.projectToken(at),request.token)&&same(await c.quoteToken(at),request.quote),
      'Market simulation binding mismatch');
    const seconds=BigInt(entry.deadlineSeconds)<BigInt(entry.maxQuoteAge)?BigInt(entry.deadlineSeconds):BigInt(entry.maxQuoteAge);
    const deadline=BigInt(request.block.timestamp)+seconds;
    const sample=request.amountIn<BigInt(p.sampleInput)?request.amountIn:BigInt(p.sampleInput);
    if(sample===0n)return null;
    const cache=new Map();
    async function simulate(amount){
      if(!cache.has(String(amount)))cache.set(String(amount),await c.convert.staticCall(amount,1n,deadline,request.version,{...at,from:entry.executor}));
      return cache.get(String(amount));
    }
    const baseline=await simulate(sample);
    if(baseline<BigInt(p.minSampleOutput)){await onQuote({reason:'sampleTooSmall'});return null;}
    const gasPrice=(await provider.getFeeData()).gasPrice;
    if(gasPrice==null||gasPrice>BigInt(job.maxGasPrice))return null;
    let amount=request.amountIn;
    for(let i=0;i<p.maxCandidates&&amount>=sample;i++){
      let output;
      try{output=await simulate(amount);}catch(error){
        if(error.code!=='CALL_EXCEPTION')throw error;
        await onQuote({reason:'simulationRejected',amountIn:String(amount)});
        if(amount===sample)break;amount=amount/2n<sample?sample:amount/2n;continue;
      }
      const acceptable=output*sample*10000n>=baseline*amount*BigInt(10000-p.maxImpactBps);
      const minOut=(output*BigInt(10000-entry.slippageBps)+9999n)/10000n;
      if(acceptable&&minOut>=BigInt(entry.minUSDG)){
        const tx=await c.convert.populateTransaction(amount,minOut,deadline,request.version);
        const gas=BigInt(await provider.send('eth_estimateGas',[{...tx,from:entry.executor},ethers.toQuantity(request.block.number)]));
        const gasCost=(gas*gasPrice*BigInt(p.gasMarginBps)+9999n)/10000n;
        const observation={amountIn:String(amount),amountOut:String(output),sampleInput:String(sample),sampleOutput:String(baseline),gasUnits:String(gas),gasCostWei:String(gasCost)};
        await onQuote({...observation,reason:gasCost<=BigInt(p.maxGasCostWei)?'candidate':'gasCost'});
        if(gasCost>BigInt(p.maxGasCostWei))return null;
        return {blockHash:request.block.hash,adapter:entry.adapter,version:request.version,amountIn:amount,amountOut:output};
      }
      await onQuote({reason:acceptable?'smallOutput':'priceImpact',amountIn:String(amount),amountOut:String(output)});
      if(amount===sample)break;amount=amount/2n<sample?sample:amount/2n;
    }
    return null;
  };
}
module.exports={createV4MarketQuote,validateMarketQuote};
