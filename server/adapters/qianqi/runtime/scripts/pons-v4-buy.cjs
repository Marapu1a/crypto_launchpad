// Local replay profile: direct curve + single-hop Universal Router v4 BUY.
// Runtime pins and binding checks are necessary, not public deployment admission.
const {Interface,AbiCoder,keccak256}=require('ethers'),CURVE=require('./pons-curve-buy.cjs');
const SCHEMA='direct-buy-pons-v2',ID='rh-pons-curve-ur-v1',FIELDS=[...CURVE.FIELDS,'router','manager','permit2'];
const PINS={router:['0x8876789976decbfcbbbe364623c63652db8c0904','0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde'],manager:['0x8366a39cc670b4001a1121b8f6a443a643e40951','0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626'],permit2:['0x000000000022d473030f116ddee9f6b43ac78ba3','0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca']};
const coder=AbiCoder.defaultAbiCoder(),KEY='(address,address,uint24,int24,address)',SPEC=`(${KEY},bool,uint128,uint128,uint256,bytes)`;
const CALL=new Interface(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
const SWAP=new Interface(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const FEE=new Interface(['event HookFeeCollected(bytes32 indexed poolId,address currency,uint256 feeAmount,uint256 taxAmount)']);
const TRANSFER=CURVE.TRANSFER,low=x=>x.toLowerCase(),num=x=>Number(BigInt(x));
const check=(v,m)=>{if(!v)throw Error(m);},poolId=k=>keccak256(coder.encode([KEY],[k]));
function validate(m){
 check(m.schema===SCHEMA&&m.routeVersion===ID,'Unsupported Pons v4 profile');
 CURVE.validate({...m,schema:CURVE.SCHEMA,routeVersion:CURVE.ID});
 for(const [k,[a,h]]of Object.entries(PINS))check(low(m[k]||'')===a&&m.codeHashes[k]===h,'Unexpected Pons '+k+' pin');
 check(new Set(FIELDS.map(k=>low(m[k]))).size===FIELDS.length,'Overlapping Pons identities');
 const k=m.poolKey;check(Array.isArray(k)&&k.length===5&&BigInt(k[0])<BigInt(k[1]),'Invalid Pons pool key');
 check(k.slice(0,2).map(low).sort().join()===[m.token,m.quote].map(low).sort().join()&&low(k[4])===low(m.hook),'Pons pool asset mismatch');
 check(BigInt(k[2])===0n&&BigInt(k[3])>0n&&poolId(k)===low(m.poolId),'Pons pool ID/fee mismatch');
 check(Number.isInteger(m.hookFeeBps)&&Number.isInteger(m.creatorTaxBps)&&m.hookFeeBps>=0&&m.creatorTaxBps>=0&&m.hookFeeBps+m.creatorTaxBps<=2000,'Invalid fee rates');
}
async function validateBindings(m,rpc,tag,curveRecord){
 const record=curveRecord||await CURVE.validateBindings(m,rpc,tag);
 check(record.poolFee===BigInt(m.poolKey[2])&&record.tickSpacing===BigInt(m.poolKey[3])&&record.creatorTaxBps===BigInt(m.creatorTaxBps),'Pons pool record mismatch');
 const abi=new Interface(['function poolManager() view returns(address)','function launches(bytes32) view returns(bool registered,bool memecoinIsCurrency0,address memecoin,address quoteToken,address creator,address buybackCreatorRecipient,address protocolFeeRecipient,uint16 creatorTaxBps,uint16 protocolFeeShareBps,uint16 buybackBurnBps,uint16 hookFeeBps,uint16 maxInternalPriceImpactBps,bool buybackEnabled)']);
 const read=async(name,args=[])=>abi.decodeFunctionResult(name,await rpc('eth_call',[{to:m.hook,data:abi.encodeFunctionData(name,args)},tag]));
 check(low((await read('poolManager'))[0])===low(m.manager),'Pons manager binding mismatch');
 if(record.phase===2n){const info=await read('launches',[m.poolId]);check(info.registered&&low(info.memecoin)===low(m.token)&&low(info.quoteToken)===low(m.quote)&&info.memecoinIsCurrency0===(low(m.poolKey[0])===low(m.token))&&info.creatorTaxBps===BigInt(m.creatorTaxBps)&&info.hookFeeBps===BigInt(m.hookFeeBps),'Pons registered pool mismatch');}
}
function canonical(types,data){const values=coder.decode(types,data);check(low(coder.encode(types,values))===low(data),'Noncanonical ABI');return values;}
function decodePool(m,tx,receipt){
 const all=receipt.logs.filter(l=>low(l.address)===low(m.manager)&&l.topics[0]===SWAP.getEvent('Swap').topicHash);
 return all.filter(l=>low(l.topics[1])===low(m.poolId)).map(log=>{
  const base={candidateId:[m.chainId,low(log.blockHash),low(log.transactionHash),num(log.logIndex)].join(':'),blockNumber:num(log.blockNumber),blockHash:low(log.blockHash),transactionHash:low(log.transactionHash),transactionIndex:num(log.transactionIndex),logIndex:num(log.logIndex),poolId:low(m.poolId),payer:null,recipient:null,grossQuoteRaw:null,evidenceLogIndexes:[num(log.logIndex)]};
  const result=(status,reason,extra={})=>({...base,status,reason,...extra});
  try{
   const s=SWAP.parseLog(log).args,q0=low(m.poolKey[0])===low(m.quote),q=q0?s.amount0:s.amount1,t=q0?s.amount1:s.amount0;
   if(q>0n&&t<0n)return result('INELIGIBLE','SELL');
   if(q>=0n||t<=0n)return result('AMBIGUOUS','INVALID_BUY_DELTAS');
   if(!tx.to||low(tx.to)!==low(m.router))return result('UNSUPPORTED_ROUTE','NOT_DIRECT_ROUTER_CALL');
   if(all.length!==1)return result('UNSUPPORTED_ROUTE','MULTIPLE_POOL_SWAPS');
   const c=CALL.parseTransaction({data:tx.input});
   if(!c||low(CALL.encodeFunctionData('execute',c.args))!==low(tx.input)||c.args.commands!=='0x10'||c.args.inputs.length!==1)return result('UNSUPPORTED_ROUTE','COMMAND_SEQUENCE');
   const [actions,params]=canonical(['bytes','bytes[]'],c.args.inputs[0]);
   if(!['0x060b0e','0x060c0f'].includes(actions)||params.length!==3)return result('UNSUPPORTED_ROUTE','ACTION_SEQUENCE');
   const [[key,z,amount,minimum,price,data]]=canonical([SPEC],params[0]);
   if(poolId(key)!==low(m.poolId)||z!==q0||amount<=0n||price!==0n||data!=='0x')return result('UNSUPPORTED_ROUTE','SWAP_PARAMETERS');
   const payer=low(tx.from);if(FIELDS.some(k=>low(m[k])===payer))return result('UNSUPPORTED_ROUTE','SERVICE_ADDRESS');
   const fee=t*BigInt(m.hookFeeBps)/10000n,tax=t*BigInt(m.creatorTaxBps)/10000n,netTokens=t-fee-tax;
   if(actions==='0x060b0e'){
    const [currency,settle,user]=canonical(['address','uint256','bool'],params[1]);
    const [output,recipient,take]=canonical(['address','address','uint256'],params[2]);
    if(low(currency)!==low(m.quote)||settle!==0n||!user||low(output)!==low(m.token)||take!==0n||![payer,'0x0000000000000000000000000000000000000001'].includes(low(recipient)))return result('UNSUPPORTED_ROUTE','SETTLEMENT_PARAMETERS');
   }else{
    const [currency,max]=canonical(['address','uint256'],params[1]),[output,min]=canonical(['address','uint256'],params[2]);
    if(low(currency)!==low(m.quote)||low(output)!==low(m.token)||-q>max||netTokens<min)return result('UNSUPPORTED_ROUTE','SETTLEMENT_PARAMETERS');
   }
   if(BigInt(receipt.status)!==1n||BigInt(tx.value)!==0n||low(s.sender)!==low(m.router)||s.fee!==0n||-q>amount||netTokens<=0n||netTokens<minimum)return result('AMBIGUOUS','EXECUTION_MISMATCH');
   const moves=receipt.logs.filter(l=>[low(m.quote),low(m.token)].includes(low(l.address))&&l.topics[0]===TRANSFER.getEvent('Transfer').topicHash).map(l=>({log:l,...TRANSFER.parseLog(l).args.toObject()}));
   const matches=(x,asset,from,to,value)=>low(x.log.address)===low(asset)&&low(x.from)===low(from)&&low(x.to)===low(to)&&x.value===value;
   const payment=moves.filter(x=>matches(x,m.quote,payer,m.manager,-q)),delivery=moves.filter(x=>matches(x,m.token,m.manager,payer,netTokens)),taxMoves=moves.filter(x=>matches(x,m.token,m.manager,m.hook,fee+tax));
   const fees=receipt.logs.filter(l=>low(l.address)===low(m.hook)&&l.topics[0]===FEE.getEvent('HookFeeCollected').topicHash);
   if(moves.length!==(fee+tax>0n?3:2)||payment.length!==1||delivery.length!==1||num(payment[0].log.logIndex)<=num(log.logIndex)||num(delivery[0].log.logIndex)<=num(payment[0].log.logIndex))return result('AMBIGUOUS','SETTLEMENT_TRANSFER_MISMATCH');
   if(fee+tax>0n){
    if(fees.length!==1||taxMoves.length!==1)return result('AMBIGUOUS','HOOK_FEE_MISMATCH');
    const f=FEE.parseLog(fees[0]).args;
    if(low(f.poolId)!==low(m.poolId)||low(f.currency)!==low(m.token)||f.feeAmount!==fee||f.taxAmount!==tax||num(taxMoves[0].log.logIndex)<=num(log.logIndex)||num(fees[0].logIndex)<=num(taxMoves[0].log.logIndex)||num(fees[0].logIndex)>=num(payment[0].log.logIndex))return result('AMBIGUOUS','HOOK_FEE_MISMATCH');
   }else if(fees.length)return result('AMBIGUOUS','UNEXPECTED_HOOK_FEE');
   return result('ELIGIBLE','SUPPORTED_BUY',{payer,recipient:payer,grossQuoteRaw:String(-q),netQuoteDebitRaw:String(-q),refundQuoteRaw:'0',poolTokenOutRaw:String(t),netTokenOutRaw:String(netTokens),hookFeeTokenRaw:String(fee+tax),quoteBasis:m.quoteBasis,evidenceLogIndexes:[num(log.logIndex),...moves.map(x=>num(x.log.logIndex)),...fees.map(x=>num(x.logIndex))]});
  }catch{return result('AMBIGUOUS','MALFORMED_OR_INCONSISTENT_EVIDENCE');}
 });
}
function decode(m,tx,receipt){return [...CURVE.decode(m,tx,receipt),...decodePool(m,tx,receipt)].sort((a,b)=>a.logIndex-b.logIndex);}
module.exports={SCHEMA,ID,FIELDS,PINS,KEY,SPEC,CALL,SWAP,FEE,TRANSFER,poolId,validate,validateBindings,decode,decodePool};
