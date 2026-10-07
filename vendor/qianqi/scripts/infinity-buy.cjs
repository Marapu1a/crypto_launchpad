// Infinity exact-input BUY specification. Pure decoder; runtime admission is performed by scan.
const {Interface,AbiCoder,keccak256,isAddress,ZeroAddress}=require('ethers');
const ID='rh-infinity-exact-input-v1',SCHEMA='direct-buy-infinity-v1';
const KEY='tuple(address,address,address,address,uint24,bytes32)',coder=AbiCoder.defaultAbiCoder();
const CALL=new Interface([`function executeExactInput(${KEY} key,bool zeroForOne,uint256 amountIn,uint256 inputMaximum,uint256 amountOutMinimum,address payer,address recipient,uint256 deadline,bytes hookData)`]);
const SWAP=new Interface(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee,uint16 protocolFee)']);
const TRANSFER=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const PINS={router:['0x6ace84c6d8d286e55933774bce9c97ab7a107df5','0x1fd55366e9d3b3e0d9b1a182e3ea37b9a262193fdb7554857665f008cc143281'],manager:['0xee04c68742e6bf434be8039580d2e89bbe55bc6f','0xc7a718bdecefbe9d1a1708097bc856f9c13d87701f050cedbafcafe01fd42064'],hook:['0x647895e9ba75a4747d8a7ed1dd56ee8b7b9e3067','0x15c23c4d612dc48ff4df298936cfc97f762af43334e23988691cdfe88250e300']};
const low=x=>x.toLowerCase(),num=x=>Number(BigInt(x)),check=(v,m)=>{if(!v)throw Error(m);};
const poolId=key=>keccak256(coder.encode([KEY],[key]));
function validate(m){
 check(m.schema===SCHEMA&&m.routeVersion===ID&&m.routes===undefined,'Unsupported Infinity route');
 check(m.eligibility==='automatic-buy-v1'&&m.quoteBasis==='wallet-net-debit-v1','Infinity eligibility/basis mismatch');
 check(['31337','4663'].includes(String(m.chainId)),'Unsupported Infinity chain');
 for(const [k,[a,h]]of Object.entries(PINS))check(low(m[k])===a&&low(m.codeHashes[k])===h,'Unsupported Infinity '+k);
 check(low(m.quote)==='0x5fc5360d0400a0fd4f2af552add042d716f1d168','Unsupported Infinity quote');
 check(isAddress(m.settlement)&&low(m.settlement)==='0x4f922d5b15e6691e0469663e4f5c4177f23c5faf','Unsupported Infinity settlement');
 check(m.quoteDecimals===6&&m.entryThresholdRaw==='100000000','Expected 100 nominal USDG');
 for(const k of ['token','quote','registry'])check(isAddress(m[k])&&low(m[k])!==ZeroAddress,'Invalid '+k);
 for(const k of ['router','manager','hook','token','quote','registry','settlement'])check(/^0x[0-9a-fA-F]{64}$/.test(m.codeHashes?.[k]||''),'Missing runtime '+k);
 const key=m.poolKey;check(Array.isArray(key)&&key.length===6&&BigInt(key[0])<BigInt(key[1]),'Invalid Infinity key');
 check(key.slice(0,2).map(low).sort().join()===[m.token,m.quote].map(low).sort().join()&&low(key[2])===low(m.hook)&&low(key[3])===low(m.manager),'Infinity pool binding mismatch');
 check(poolId(key)===low(m.poolId),'Wrong Infinity pool id');
 check(Number.isSafeInteger(m.anchor?.number)&&m.anchor.number>=0&&/^0x[0-9a-fA-F]{64}$/.test(m.anchor.hash),'Invalid anchor');
}
function decode(m,tx,receipt){
 const all=receipt.logs.filter(l=>low(l.address)===low(m.manager)&&l.topics[0]===SWAP.getEvent('Swap').topicHash);
 return all.filter(l=>low(l.topics[1])===low(m.poolId)).map(log=>{
  const base={candidateId:[m.chainId,low(log.blockHash),low(log.transactionHash),num(log.logIndex)].join(':'),blockNumber:num(log.blockNumber),blockHash:low(log.blockHash),transactionHash:low(log.transactionHash),transactionIndex:num(log.transactionIndex),logIndex:num(log.logIndex),poolId:low(m.poolId),payer:null,recipient:null,grossQuoteRaw:null,evidenceLogIndexes:[num(log.logIndex)]};
  const result=(status,reason,extra={})=>({...base,status,reason,...extra});
  try{
   const swap=SWAP.parseLog(log).args,q0=low(m.poolKey[0])===low(m.quote),q=q0?swap.amount0:swap.amount1,t=q0?swap.amount1:swap.amount0;
   if(q>0n&&t<0n)return result('INELIGIBLE','SELL');
   if(q>=0n||t<=0n)return result('AMBIGUOUS','INVALID_BUY_DELTAS');
   if(!tx.to||low(tx.to)!==low(m.router))return result('UNSUPPORTED_ROUTE','NOT_DIRECT_ADAPTER_CALL');
   if(all.length!==1)return result('UNSUPPORTED_ROUTE','MULTIPLE_POOL_SWAPS');
   const call=CALL.parseTransaction({data:tx.input});if(!call)return result('UNSUPPORTED_ROUTE','CALL_SELECTOR');
   if(low(CALL.encodeFunctionData(call.fragment,call.args))!==low(tx.input))return result('UNSUPPORTED_ROUTE','NON_CANONICAL_CALLDATA');
   const a=call.args,payer=low(a.payer),recipient=low(a.recipient);
   if(payer!==recipient||payer!==low(tx.from))return result('UNSUPPORTED_ROUTE','PAYER_RECIPIENT_SENDER_DIFFER');
   if([m.router,m.manager,m.hook,m.settlement,m.registry,m.token,m.quote].map(low).includes(payer))return result('UNSUPPORTED_ROUTE','SERVICE_ADDRESS');
   if(poolId(a.key)!==low(m.poolId))return result('AMBIGUOUS','CALLDATA_POOL_MISMATCH');
   if(a.zeroForOne!==q0||a.amountIn===0n||a.inputMaximum<a.amountIn||a.hookData!=='0x')return result('UNSUPPORTED_ROUTE','SWAP_PARAMETERS');
   if(BigInt(receipt.status)!==1n||BigInt(tx.value)!==0n||low(swap.sender)!==low(m.router)||-q>a.amountIn||t<a.amountOutMinimum)return result('AMBIGUOUS','SWAP_EXECUTION_MISMATCH');
   const transfers=receipt.logs.filter(l=>[m.token,m.quote].map(low).includes(low(l.address))&&l.topics[0]===TRANSFER.getEvent('Transfer').topicHash).map(l=>({log:l,...TRANSFER.parseLog(l).args.toObject()}));
   const asset=(x,a)=>low(x.log.address)===low(a),from=(x,a)=>low(x.from)===low(a),to=(x,a)=>low(x.to)===low(a);
   const payments=transfers.filter(x=>asset(x,m.quote)&&from(x,payer));
   const refunds=transfers.filter(x=>asset(x,m.quote)&&to(x,payer));
   const tokenMoves=transfers.filter(x=>asset(x,m.token));
   if(payments.length!==1||!to(payments[0],m.router)||payments[0].value!==a.inputMaximum||num(payments[0].log.logIndex)>=num(log.logIndex))return result('AMBIGUOUS','PAYMENT_MISMATCH');
   if(refunds.some(x=>![low(m.settlement),low(m.router)].includes(low(x.from))||num(x.log.logIndex)<=num(log.logIndex)))return result('AMBIGUOUS','REFUND_MISMATCH');
   if(tokenMoves.length!==1||!from(tokenMoves[0],m.settlement)||!to(tokenMoves[0],payer)||tokenMoves[0].value!==t||num(tokenMoves[0].log.logIndex)<=num(log.logIndex))return result('AMBIGUOUS','DELIVERY_MISMATCH');
   const refund=refunds.reduce((s,x)=>s+x.value,0n),net=payments[0].value-refund;
   if(net<-q||net<=0n)return result('AMBIGUOUS','NET_DEBIT_MISMATCH');
   return result('ELIGIBLE','SUPPORTED_BUY',{payer,recipient,grossQuoteRaw:String(net),netQuoteDebitRaw:String(net),refundQuoteRaw:String(refund),poolQuoteRaw:String(-q),quoteBasis:m.quoteBasis,evidenceLogIndexes:[num(log.logIndex),...transfers.map(x=>num(x.log.logIndex))]});
  }catch{return result('AMBIGUOUS','MALFORMED_OR_INCONSISTENT_EVIDENCE');}
 });
}
module.exports={ID,SCHEMA,PINS,KEY,CALL,SWAP,TRANSFER,poolId,validate,decode};
