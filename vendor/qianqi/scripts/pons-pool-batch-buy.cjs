// New genesis version: exact Pons terminal v4 self-batches, never arbitrary calls.
const E=require('ethers'),L=require('./pons-launch-buy.cjs'),V=require('./pons-v4-buy.cjs');
const B=require('./pons-batch-buy.cjs'),F=require('./pons-batch-funding.cjs'),X=require('./pons-batch-route.cjs');
const SCHEMA='direct-buy-pons-launch-v2',ID='rh-pons-curve-pool-self-batch-v1',FIELDS=L.FIELDS;
const PERMIT=new E.Interface(['function approve(address token,address spender,uint160 amount,uint48 expiration)']);
const low=x=>x.toLowerCase(),check=(v,m)=>{if(!v)throw Error(m);};
function canonical(abi,name,data){const v=abi.decodeFunctionData(name,data);check(low(abi.encodeFunctionData(name,v))===low(data),'Noncanonical '+name);return v;}
function validate(m){check(m.schema===SCHEMA&&m.routeVersion===ID,'Wrong Pons pool batch profile');L.validate({...m,schema:L.SCHEMA,routeVersion:L.ID});}
function decode(m,tx,receipt,block){
 const original=L.decode(m,tx,receipt,block);
 if(!tx.to||low(tx.to)!==low(tx.from)||!original.some(d=>d.poolId===low(m.poolId)))return original;
 try{
  require('./pons-channel-attribution.cjs').inspect(m,tx,receipt);
  X.execution(m,tx,block);check(BigInt(tx.value)===0n,'Unexpected outer native value');
  check(!FIELDS.some(k=>low(m[k])===low(tx.from)),'Service payer');
  const outer=canonical(B.EXEC,'execute',tx.input);check(outer.mode===B.MODE,'Unsupported execution mode');
  const [calls]=E.AbiCoder.defaultAbiCoder().decode(B.TYPES,outer.executionCalldata);
  check(low(E.AbiCoder.defaultAbiCoder().encode(B.TYPES,[calls]))===low(outer.executionCalldata),'Noncanonical batch');
  check(calls.length===3||calls.length===6,'Unsupported batch calls');
  const funded=calls.length===6,[approval,permit,buy]=calls.slice(-3);
  check(calls.slice(funded?1:0).every(c=>c.value===0n),'Unexpected native value');
  check(low(approval.target)===low(m.quote)&&low(permit.target)===low(m.permit2)&&low(buy.target)===low(m.router),'Wrong purchase targets');
  const a=canonical(B.APPROVE,'approve',approval.callData),p=canonical(PERMIT,'approve',permit.callData);
  check(low(a.spender)===low(m.permit2)&&a.amount===E.MaxUint256,'Wrong quote approval');
  check(low(p.token)===low(m.quote)&&low(p.spender)===low(m.router)&&p.amount===2n**160n-1n&&p.expiration>BigInt(block.timestamp),'Wrong Permit2 approval');
  const route=canonical(V.CALL,'execute',buy.callData);
  check(route.commands==='0x10'&&route.inputs.length===1,'Wrong pool commands');
  const [actions,parameters]=E.AbiCoder.defaultAbiCoder().decode(['bytes','bytes[]'],route.inputs[0]);
  check(actions==='0x060c0f'&&parameters.length===3,'Wrong terminal actions');
  const [[,,amountIn]]=E.AbiCoder.defaultAbiCoder().decode([V.SPEC],parameters[0]);
  let filtered=receipt,fundingQuoteRaw='0';
  if(funded){
   const [wrap,wa,swap]=calls,payer=low(tx.from);
   check(low(wrap.target)===low(m.weth)&&wrap.callData==='0xd0e30db0'&&wrap.value>0n,'Wrong wrap');
   check(low(wa.target)===low(m.weth)&&low(swap.target)===low(m.fundingRouter),'Wrong funding targets');
   const w=canonical(B.APPROVE,'approve',wa.callData);check(low(w.spender)===low(m.fundingRouter)&&w.amount===wrap.value,'Wrong WETH approval');
   const multi=canonical(F.ROUTER,'multicall',swap.callData);check(multi.data.length===1,'Multiple funding swaps');
   const {params}=canonical(F.ROUTER,'exactInput',multi.data[0]);
   check(low(params.path)===low(m.weth)+'000064'+low(m.quote).slice(2)&&low(params.recipient)===payer&&params.amountIn===wrap.value&&params.amountOutMinimum===amountIn&&amountIn>0n,'Wrong funding parameters');
   const transfers=receipt.logs.filter(l=>l.topics[0]===V.TRANSFER.getEvent('Transfer').topicHash&&[m.weth,m.quote].map(low).includes(low(l.address))).map(l=>({asset:low(l.address),index:BigInt(l.logIndex),...V.TRANSFER.parseLog(l).args.toObject()}));
   const wt=transfers.filter(t=>t.asset===low(m.weth)),qt=transfers.filter(t=>t.asset===low(m.quote));
   const mint=wt.find(t=>low(t.from)===E.ZeroAddress&&low(t.to)===payer),spend=wt.find(t=>low(t.from)===payer&&low(t.to)===low(m.fundingPool));
   const funding=qt.find(t=>low(t.from)===low(m.fundingPool)&&low(t.to)===payer),payment=qt.find(t=>low(t.from)===payer&&low(t.to)===low(m.manager));
   check(wt.length===2&&qt.length===2&&mint&&spend&&funding&&payment,'Unexpected funding flow');
   check(mint.value===wrap.value&&spend.value===wrap.value&&funding.value>=params.amountOutMinimum&&payment.value===params.amountOutMinimum,'Funding amount mismatch');
   check(mint.index<funding.index&&funding.index<spend.index&&spend.index<payment.index,'Funding order mismatch');
   filtered={...receipt,logs:receipt.logs.filter(l=>BigInt(l.logIndex)!==funding.index)};fundingQuoteRaw=String(funding.value);
  }
  const decoded=V.decodePool(m,{...tx,to:m.router,input:buy.callData},filtered);
  check(decoded.length===1&&decoded[0].status==='ELIGIBLE','Unqualified nested pool BUY');
  // No curve trades or extra target candidates may be hidden by the projection.
  check(original.length===1,'Mixed venues');
  return [{...decoded[0],reason:'SUPPORTED_POOL_SELF_BATCH_BUY',batchRoute:ID,fundingQuoteRaw,evidenceLogIndexes:receipt.logs.map(l=>Number(BigInt(l.logIndex)))}];
 }catch(e){return original.map(d=>d.poolId===low(m.poolId)?{...d,status:'UNSUPPORTED_ROUTE',reason:'POOL_BATCH_NOT_QUALIFIED',batchDetail:e.message}:d);}
}
module.exports={SCHEMA,ID,FIELDS,validate,validateBindings:L.validateBindings,decode,PERMIT};
