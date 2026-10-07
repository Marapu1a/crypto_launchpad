// Pinned V1 AUTO purchase adapter. Pure receipt validation, no RPC or activation.
const {Interface,AbiCoder,keccak256}=require('ethers');
const ID='rh-pair-auto-usdg-v1';
const ADDRESS='0x9d7741776098afa315e4d576ede4f2c67a21d8ce';
const CODE_HASH='0xcca69ea4c59b0c2c0ffc86505c8ffa913057ba837d39dd9faabd5d9feebebe6d';
const HOOK='0x16d1560630ce74af4478d9b8ad46548a092a2000';
const USDG='0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const ROUTER='0x8876789976decbfcbbbe364623c63652db8c0904';
const MANAGER='0x8366a39cc670b4001a1121b8f6a443a643e40951';
const ABI=new Interface([
 'function buyExactInput(address projectToken,address fundingToken,address recipient,(uint8 poolIndex,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,uint128 amountIn,uint128 minAmountOut)[] legs,uint256 aggregateMinOut,uint256 deadline) returns(uint256)',
 'event AggregatedBuy(address indexed payer,address indexed projectToken,address indexed recipient,address fundingToken,uint256 amountIn,uint256 amountOut)'
]);
const coder=AbiCoder.defaultAbiCoder(),low=x=>x.toLowerCase();
const check=(v)=>{if(!v)throw Error('AUTO evidence mismatch');};
const num=x=>{const n=Number(BigInt(x));check(Number.isSafeInteger(n)&&n>=0);return n;};
function validProfile(m){return ['4663','31337'].includes(String(m.chainId))&&low(m.hook)===HOOK&&low(m.quote)===USDG&&low(m.router)===ROUTER&&low(m.manager)===MANAGER;}
function decode(m,tx,receipt,{SWAP_ABI,TRANSFER_ABI}){
 const eventTopic=ABI.getEvent('AggregatedBuy').topicHash;
 const events=receipt.logs.filter(l=>low(l.address)===ADDRESS&&l.topics[0]===eventTopic);
 const relevant=events.filter(l=>l.topics[2]&&low(l.topics[2])==='0x'+'0'.repeat(24)+low(m.token).slice(2));
 if(!relevant.length)return [];
 const log=relevant[0];
 const base={candidateId:[m.chainId,low(log.blockHash),low(log.transactionHash),num(log.logIndex)].join(':'),
  blockNumber:num(log.blockNumber),blockHash:low(log.blockHash),transactionHash:low(log.transactionHash),transactionIndex:num(log.transactionIndex),logIndex:num(log.logIndex),
  purchaseKind:ID,payer:null,recipient:null,grossQuoteRaw:null,evidenceLogIndexes:[num(log.logIndex)]};
 const reject=reason=>[{...base,status:'AMBIGUOUS',reason}];
 try{
  check(validProfile(m)&&events.length===1&&BigInt(receipt.status)===1n&&low(tx.to)===ADDRESS&&BigInt(tx.value)===0n);
  const call=ABI.parseTransaction({data:tx.input});check(call?.name==='buyExactInput');
  check(low(ABI.encodeFunctionData('buyExactInput',call.args))===low(tx.input));
  const p=call.args,buy=ABI.parseLog(log).args,encoded=ABI.encodeEventLog('AggregatedBuy',buy);
  check(low(encoded.data)===low(log.data)&&JSON.stringify(encoded.topics.map(low))===JSON.stringify(log.topics.map(low)));
  check(low(p.projectToken)===low(m.token)&&low(p.fundingToken)===USDG&&low(p.recipient)===low(tx.from));
  check(low(buy.payer)===low(tx.from)&&low(buy.recipient)===low(tx.from)&&low(buy.projectToken)===low(m.token)&&low(buy.fundingToken)===USDG);
  // Only the one/two-leg envelope actually exercised on a real-contract fork.
  check(p.legs.length>=1&&p.legs.length<=2&&new Set(p.legs.map(l=>String(l.poolIndex))).size===p.legs.length);
  const total=p.legs.reduce((s,l)=>s+l.amountIn,0n);check(total>0n&&buy.amountIn===total&&buy.amountOut>0n&&buy.amountOut>=p.aggregateMinOut);
  const swaps=receipt.logs.filter(l=>low(l.address)===MANAGER&&l.topics[0]===SWAP_ABI.getEvent('Swap').topicHash).map(log=>({log,a:SWAP_ABI.parseLog(log).args}));
  check(swaps.length===p.legs.length);
  const transfers=receipt.logs.filter(l=>l.topics[0]===TRANSFER_ABI.getEvent('Transfer').topicHash).map(log=>({log,a:TRANSFER_ABI.parseLog(log).args}));
  let cursor=0;const consumed=[],poolIds=[];
  function take(asset,from,to,amount){const t=transfers[cursor++];check(t&&low(t.log.address)===low(asset)&&low(t.a.from)===low(from)&&low(t.a.to)===low(to)&&t.a.value===amount);consumed.push(t.log);return t.log;}
  take(USDG,tx.from,ADDRESS,total);
  let output=0n;
  for(let i=0;i<p.legs.length;i++){
   const leg=p.legs[i],key=leg.poolKey;check(leg.amountIn>0n&&BigInt(key.currency0)<BigInt(key.currency1)&&key.fee===10000n&&key.tickSpacing===200n&&low(key.hooks)===HOOK);
   check([low(key.currency0),low(key.currency1)].includes(low(m.token)));
   const project0=low(key.currency0)===low(m.token),quote=project0?key.currency1:key.currency0;
   check(low(quote)!==low(m.token));
   const poolId=keccak256(coder.encode(['address','address','uint24','int24','address'],key));check(!poolIds.includes(poolId));poolIds.push(poolId);
   const {log:sl,a:s}=swaps[i];check(s.id===poolId&&low(s.sender)===ROUTER&&s.fee===10000n);
   const out=project0?s.amount0:s.amount1,debt=-(project0?s.amount1:s.amount0);check(out>0n&&debt>0n&&out>=leg.minAmountOut);output+=out;
   if(low(quote)!==USDG){
    const conversion=transfers[cursor];check(conversion&&conversion.a.value===debt&&debt>0n);
    const venue=conversion.a.from;check(![ADDRESS,MANAGER,low(tx.from)].includes(low(venue)));
    take(quote,venue,ADDRESS,debt);take(USDG,ADDRESS,venue,leg.amountIn);
   }else check(debt===leg.amountIn);
   const previous=consumed.at(-1);check(num(previous.logIndex)<num(sl.logIndex));
   const payment=take(quote,ADDRESS,MANAGER,debt),delivery=take(m.token,MANAGER,tx.from,out);
   check(num(sl.logIndex)<num(payment.logIndex)&&num(payment.logIndex)<num(delivery.logIndex));consumed.push(sl);
  }
  check(cursor===transfers.length&&output===buy.amountOut&&consumed.every(l=>num(l.logIndex)<num(log.logIndex)));
  check(transfers.every((t,i)=>i===0||num(transfers[i-1].log.logIndex)<num(t.log.logIndex)));
  const indexes=[...consumed,log].map(l=>num(l.logIndex));check(new Set(indexes).size===indexes.length);
  return [{...base,logIndex:num(transfers[0].log.logIndex),purchaseEventLogIndex:num(log.logIndex),status:'ELIGIBLE',reason:'SUPPORTED_BUY',payer:low(tx.from),recipient:low(tx.from),grossQuoteRaw:String(total),poolIds,
   evidenceLogIndexes:indexes.sort((a,b)=>a-b)}];
 }catch{return reject('AUTO_EVIDENCE_MISMATCH');}
}
module.exports={ID,ADDRESS,CODE_HASH,HOOK,USDG,ROUTER,MANAGER,ABI,validProfile,decode};
