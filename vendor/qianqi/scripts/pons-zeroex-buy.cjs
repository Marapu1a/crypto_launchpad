// Genesis-only extension: pinned AllowanceHolder/Settler, one exact-input USDG pool.
// No calldata projection into the direct-router decoder. Receipt conservation is
// checked against the four actions executed by the pinned Settler runtime.
const E=require('ethers'),L=require('./pons-pool-batch-buy.cjs'),V=require('./pons-v4-buy.cjs');
const SCHEMA='direct-buy-pons-launch-v3',ID='rh-pons-curve-pool-batch-zeroex-v1';
const FIELDS=[...L.FIELDS,'allowanceHolder','zeroexSettler'];
const PINS={
 allowanceHolder:['0x0000000000001ff3684f28c67538d4d072c22734','0x99f5e8edaceacfdd183eb5f1da8a7757b322495b80cf7928db289a1b1a09f799'],
 zeroexSettler:['0x6aa80dbbed9ae5ab45fbf61f9644fada3b29326e','0xa1a2a85048dd0f8cccc5f2012ff175b88d928c87c84e66691357842ec34e572f']
};
const FEE_RECIPIENT='0xad01c20d5886137e056775af56915de824c8fce5',SURPLUS_RECIPIENT='0xf5c4f3dc02c3fb9279495a8fef7b0741da956157';
const HOLDER=new E.Interface(['function exec(address operator,address token,uint256 amount,address target,bytes data) payable returns(bytes)']);
const SETTLER=new E.Interface(['function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 zid) payable returns(bool)']);
const ACTIONS=new E.Interface([
 'function TRANSFER_FROM(address recipient,((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,bytes sig)',
 'function BASIC(address sellToken,uint256 ppm,address pool,uint256 offset,bytes data)',
 'function UNISWAPV4(address recipient,address sellToken,uint256 ppm,bool feeOnTransfer,uint256 hashMul,uint256 hashMod,bytes fills,uint256 amountOutMin)',
 'function POSITIVE_SLIPPAGE(address recipient,address token,uint256 expectedAmount,uint256 maxPpm)'
]);
const ERC=new E.Interface(['function transfer(address to,uint256 amount) returns(bool)']);
const low=x=>x.toLowerCase(),check=(v,m)=>{if(!v)throw Error(m);};
function canonical(abi,name,data){const a=abi.decodeFunctionData(name,data);check(low(abi.encodeFunctionData(name,a))===low(data),'NONCANONICAL_CALL');return a;}
function validate(m){
 check(m.schema===SCHEMA&&m.routeVersion===ID,'Wrong Pons 0x profile');
 L.validate({...m,schema:L.SCHEMA,routeVersion:L.ID});
 for(const [k,[a,h]]of Object.entries(PINS))check(low(m[k]||'')===a&&m.codeHashes[k]===h,'Unexpected 0x '+k+' pin');
 check(new Set([...FIELDS.map(k=>low(m[k])),FEE_RECIPIENT,SURPLUS_RECIPIENT]).size===FIELDS.length+2,'Overlapping 0x identities');
}
function fills(m){
 const price=low(m.poolKey[0])===low(m.quote)?4295128740n:1461446703485210103287273052203988822378723970341n;
 return low(E.solidityPacked(['uint24','uint160','uint8','address','uint24','int24','address','uint24'],[1000000,price,1,m.token,m.poolKey[2],m.poolKey[3],m.hook,0]));
}
// Shared call proof receives an explicitly established payer; it does not create
// a fictional transaction or change receipt provenance for nested executions.
function proveCall(m,{payer,input,value},receipt,block){
 let stage='EVIDENCE';
 try{
  const settler=low(m.zeroexSettler);
  check(BigInt(value)===0n,'NATIVE_VALUE');
  check(![...FIELDS.map(k=>low(m[k])),FEE_RECIPIENT,SURPLUS_RECIPIENT,E.ZeroAddress].includes(payer),'SERVICE_PAYER');
  stage='ENVELOPE';
  const a=canonical(HOLDER,'exec',input);
  check(low(a.operator)===settler&&low(a.target)===settler&&low(a.token)===low(m.quote),'WRONG_TARGET');
  check(a.amount>0n&&a.amount<2n**128n,'SELL_AMOUNT');
  const c=canonical(SETTLER,'execute',a.data),s=c.slippage;
  check(low(s.recipient)===payer&&low(s.buyToken)===low(m.token)&&s.minAmountOut>0n,'RECIPIENT_OR_MINIMUM');
  check(c.actions.length===4,'ACTION_COUNT');
  stage='ACTIONS';
  const pull=canonical(ACTIONS,'TRANSFER_FROM',c.actions[0]);
  check(low(pull.recipient)===settler&&low(pull.permit.permitted.token)===low(m.quote)&&pull.permit.permitted.amount===a.amount&&pull.permit.nonce===0n&&pull.permit.deadline>=BigInt(block.timestamp)&&pull.sig==='0x','PULL_PARAMETERS');
  const basic=canonical(ACTIONS,'BASIC',c.actions[1]),transfer=canonical(ERC,'transfer',basic.data);
  check(low(basic.sellToken)===low(m.quote)&&basic.ppm===1500n&&low(basic.pool)===low(m.quote)&&basic.offset===36n&&low(transfer.to)===FEE_RECIPIENT&&transfer.amount===0n,'FEE_ACTION');
  const swap=canonical(ACTIONS,'UNISWAPV4',c.actions[2]);
  check(low(swap.recipient)===settler&&low(swap.sellToken)===low(m.quote)&&swap.ppm===1000000n&&!swap.feeOnTransfer&&swap.hashMul===2n&&swap.hashMod===18446744073709551557n&&swap.amountOutMin===0n&&low(swap.fills)===fills(m),'SINGLE_POOL_ACTION');
  const positive=canonical(ACTIONS,'POSITIVE_SLIPPAGE',c.actions[3]);
  check(low(positive.recipient)===SURPLUS_RECIPIENT&&low(positive.token)===low(m.token)&&positive.expectedAmount>0n&&positive.maxPpm===1000000n,'SURPLUS_ACTION');
  stage='POOL';
  const swaps=receipt.logs.filter(l=>low(l.address)===low(m.manager)&&l.topics[0]===V.SWAP.getEvent('Swap').topicHash);
  const curveTrades=receipt.logs.filter(l=>low(l.address)===low(m.curve)&&[require('./pons-curve-buy.cjs').EVENTS.getEvent('CurveBuy').topicHash,require('./pons-curve-buy.cjs').EVENTS.getEvent('CurveSell').topicHash].includes(l.topics[0]));
  check(curveTrades.length===0&&swaps.length===1,'MULTIPLE_OR_MIXED_SWAPS');
  const event=V.SWAP.parseLog(swaps[0]).args,q0=low(m.poolKey[0])===low(m.quote);
  const q=q0?event.amount0:event.amount1,t=q0?event.amount1:event.amount0;
  check(low(event.id)===low(m.poolId)&&low(event.sender)===settler&&q<0n&&t>0n&&event.fee===0n,'SWAP_MISMATCH');
  const routeFee=a.amount*1500n/1000000n,fee=t*BigInt(m.hookFeeBps)/10000n,tax=t*BigInt(m.creatorTaxBps)/10000n;
  const net=t-fee-tax,surplus=net>positive.expectedAmount?net-positive.expectedAmount:0n,delivered=net-surplus;
  check(-q===a.amount-routeFee&&delivered>=s.minAmountOut,'POOL_AMOUNT_OR_MINIMUM');
  stage='TRANSFERS';
  const moves=receipt.logs.filter(l=>[low(m.quote),low(m.token)].includes(low(l.address))&&l.topics[0]===V.TRANSFER.getEvent('Transfer').topicHash).map(l=>{
   const v=V.TRANSFER.parseLog(l).args,encoded=V.TRANSFER.encodeEventLog(V.TRANSFER.getEvent('Transfer'),v);
   check(JSON.stringify(encoded.topics.map(low))===JSON.stringify(l.topics.map(low))&&low(encoded.data)===low(l.data),'NONCANONICAL_TRANSFER');
   return {asset:low(l.address),from:low(v.from),to:low(v.to),value:v.value,index:BigInt(l.logIndex)};
  });
  // BASIC transfer is called even for zero fee. No refunds, residual input,
  // extra funding or other relevant asset transfers are allowed in this profile.
  const expected=[
   [m.quote,payer,settler,a.amount],[m.quote,settler,FEE_RECIPIENT,routeFee],
   ...(fee+tax>0n?[[m.token,m.manager,m.hook,fee+tax]]:[]),
   [m.token,m.manager,settler,net],[m.quote,settler,m.manager,-q],
   ...(surplus>0n?[[m.token,settler,SURPLUS_RECIPIENT,surplus]]:[]),
   [m.token,settler,payer,delivered]
  ];
  moves.sort((a,b)=>a.index<b.index?-1:1);
  check(moves.length===expected.length,'EXTRA_OR_MISSING_TRANSFER');
  expected.forEach(([asset,from,to,value],i)=>{const v=moves[i];check(v.asset===low(asset)&&v.from===low(from)&&v.to===low(to)&&v.value===value,'FLOW_MISMATCH');});
  const swapIndex=BigInt(swaps[0].logIndex);
  check(moves[1].index<swapIndex&&swapIndex<moves[2].index,'SWAP_ORDER');
  stage='HOOK_FEE';
  const fees=receipt.logs.filter(l=>low(l.address)===low(m.hook)&&l.topics[0]===V.FEE.getEvent('HookFeeCollected').topicHash);
  if(fee+tax>0n){
   check(fees.length===1,'FEE_COUNT');const f=V.FEE.parseLog(fees[0]).args;
   check(low(f.poolId)===low(m.poolId)&&low(f.currency)===low(m.token)&&f.feeAmount===fee&&f.taxAmount===tax,'FEE_MISMATCH');
   check(moves[2].index<BigInt(fees[0].logIndex)&&BigInt(fees[0].logIndex)<moves[3].index,'FEE_ORDER');
  }else check(fees.length===0,'UNEXPECTED_FEE');
  return {status:'ELIGIBLE',reason:'SUPPORTED_ZEROEX_POOL_BUY',payer,recipient:payer,grossQuoteRaw:String(a.amount),netQuoteDebitRaw:String(a.amount),refundQuoteRaw:'0',poolQuoteRaw:String(-q),routeFeeQuoteRaw:String(routeFee),poolTokenOutRaw:String(t),netTokenOutRaw:String(delivered),hookFeeTokenRaw:String(fee+tax),positiveSlippageTokenRaw:String(surplus),quoteBasis:m.quoteBasis,adapterId:ID,evidenceLogIndexes:receipt.logs.map(l=>Number(BigInt(l.logIndex)))};
 }catch(e){e.routeStage=stage;throw e;}
}
function decode(m,tx,receipt,block){
 const original=L.decode(m,tx,receipt,block);
 if(!tx.to||low(tx.to)!==low(m.allowanceHolder)||!original.some(d=>d.poolId===low(m.poolId)&&d.reason!=='SELL'))return original;
 let stage='EVIDENCE';
 try{
  require('./pons-channel-attribution.cjs').inspect(m,tx,receipt);
  check(block&&low(block.hash)===low(tx.blockHash),'MISSING_BLOCK');
  return [{...original[0],...proveCall(m,{payer:low(tx.from),input:tx.input,value:tx.value},receipt,block)}];
 }catch(e){
  stage=e.routeStage||stage;
  // Top-level sender observation is not a qualifying payer or wallet ownership proof.
  return original.map(d=>d.poolId===low(m.poolId)&&d.reason!=='SELL'?{...d,status:'UNSUPPORTED_ROUTE',reason:'ZEROEX_'+stage+'_NOT_QUALIFIED',routeDetail:e.message,observedSender:low(tx.from),attribution:'transaction-sender-only'}:d);
 }
}
module.exports={SCHEMA,ID,FIELDS,PINS,FEE_RECIPIENT,SURPLUS_RECIPIENT,HOLDER,SETTLER,ACTIONS,ERC,fills,validate,validateBindings:L.validateBindings,decode,proveCall};
