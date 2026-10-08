// Adapted from QIANQI ae445254; deployment admission handled by scanner.mjs.
// Pure decoder for direct ERC20-quoted curve buys. Shape checks are NOT deployment admission.
const {Interface,isAddress,ZeroAddress}=require('ethers');
const ID='rh-pons-direct-curve-v1',SCHEMA='direct-buy-pons-curve-v1';
const FIELDS=['factory','hook','curve','token','quote','registry'];
const CALL=new Interface(['function buy(uint256 quoteIn,uint256 minTokensOut,address recipient) payable returns(uint256)']);
const EVENTS=new Interface(['event CurveBuy(address indexed buyer,address indexed recipient,uint256 quoteIn,uint256 tokensOut,uint256 fee,uint256 tax)',
 'event CurveSell(address indexed seller,address indexed recipient,uint256 tokensIn,uint256 quoteOut,uint256 fee,uint256 tax)',
 'event CurveBuyRefunded(address indexed buyer,uint256 amount)']);
const TRANSFER=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const low=x=>x.toLowerCase(),num=x=>{const n=Number(BigInt(x));if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid index');return n;};
const check=(v,m)=>{if(!v)throw Error(m);};
function decode(m,tx,receipt){
 const topics=['CurveBuy','CurveSell'].map(n=>EVENTS.getEvent(n).topicHash);
 const trades=receipt.logs.filter(l=>low(l.address)===low(m.curve)&&topics.includes(l.topics[0]));
 return trades.map(log=>{
  const base={candidateId:[m.chainId,low(log.blockHash),low(log.transactionHash),num(log.logIndex)].join(':'),blockNumber:num(log.blockNumber),blockHash:low(log.blockHash),transactionHash:low(log.transactionHash),transactionIndex:num(log.transactionIndex),logIndex:num(log.logIndex),payer:null,recipient:null,grossQuoteRaw:null,evidenceLogIndexes:[num(log.logIndex)]};
  const result=(status,reason,extra={})=>({...base,status,reason,...extra});
  try{
   const event=EVENTS.parseLog(log),e=event.args;if(event.name==='CurveSell')return result('INELIGIBLE','SELL');
   if(!tx.to||low(tx.to)!==low(m.curve))return result('UNSUPPORTED_ROUTE','NOT_DIRECT_CURVE_CALL');
   if(trades.length!==1)return result('AMBIGUOUS','MULTIPLE_CURVE_TRADES');
   const call=CALL.parseTransaction({data:tx.input});
   if(!call||low(CALL.encodeFunctionData('buy',call.args))!==low(tx.input))return result('UNSUPPORTED_ROUTE','NON_CANONICAL_BUY_CALL');
   const a=call.args,payer=low(tx.from);
   if(payer!==low(a.recipient)||payer!==low(e.buyer)||payer!==low(e.recipient))return result('UNSUPPORTED_ROUTE','PAYER_RECIPIENT_SENDER_DIFFER');
   if(FIELDS.some(k=>low(m[k])===payer))return result('UNSUPPORTED_ROUTE','SERVICE_ADDRESS');
   if(BigInt(receipt.status)!==1n||BigInt(tx.value)!==0n||a.quoteIn<=0n||e.quoteIn<=0n||e.tokensOut<=0n||
      e.quoteIn>a.quoteIn||e.fee+e.tax>=e.quoteIn||e.quoteIn*a.minTokensOut>a.quoteIn*e.tokensOut)return result('AMBIGUOUS','EXECUTION_MISMATCH');
   const transfers=receipt.logs.filter(l=>[low(m.quote),low(m.token)].includes(low(l.address))&&l.topics[0]===TRANSFER.getEvent('Transfer').topicHash)
    .map(l=>({log:l,...TRANSFER.parseLog(l).args.toObject()}));
   const asset=(t,a)=>low(t.log.address)===low(a),from=(t,a)=>low(t.from)===low(a),to=(t,a)=>low(t.to)===low(a);
   const payments=transfers.filter(t=>asset(t,m.quote)&&from(t,payer)),refunds=transfers.filter(t=>asset(t,m.quote)&&to(t,payer));
   if(payments.length!==1||!to(payments[0],m.curve)||payments[0].value!==a.quoteIn||num(payments[0].log.logIndex)>=num(log.logIndex))return result('AMBIGUOUS','PAYMENT_MISMATCH');
   const delivery=transfers.filter(t=>asset(t,m.token)&&(from(t,payer)||to(t,payer)));
   if(delivery.length!==1||!from(delivery[0],m.curve)||!to(delivery[0],payer)||delivery[0].value!==e.tokensOut||
      num(delivery[0].log.logIndex)<=num(payments[0].log.logIndex)||num(delivery[0].log.logIndex)>=num(log.logIndex))return result('AMBIGUOUS','DELIVERY_MISMATCH');
   const refund=a.quoteIn-e.quoteIn;
   const refundEvents=receipt.logs.filter(l=>low(l.address)===low(m.curve)&&l.topics[0]===EVENTS.getEvent('CurveBuyRefunded').topicHash);
   if(refund===0n){if(refunds.length||refundEvents.length)return result('AMBIGUOUS','UNEXPECTED_REFUND');}
   else{
    if(refunds.length!==1||refundEvents.length!==1)return result('AMBIGUOUS','REFUND_MISMATCH');
    const r=refunds[0],re=EVENTS.parseLog(refundEvents[0]).args;
    if(!from(r,m.curve)||r.value!==refund||low(re.buyer)!==payer||re.amount!==refund||
       num(refundEvents[0].logIndex)<=num(delivery[0].log.logIndex)||num(r.log.logIndex)<=num(refundEvents[0].logIndex)||num(r.log.logIndex)>=num(log.logIndex))return result('AMBIGUOUS','REFUND_MISMATCH');
   }
   return result('ELIGIBLE','SUPPORTED_BUY',{payer,recipient:payer,grossQuoteRaw:String(e.quoteIn),netQuoteDebitRaw:String(e.quoteIn),refundQuoteRaw:String(refund),quoteBasis:m.quoteBasis,evidenceLogIndexes:[num(log.logIndex),...transfers.map(t=>num(t.log.logIndex)),...refundEvents.map(l=>num(l.logIndex))]});
  }catch{return result('AMBIGUOUS','MALFORMED_OR_INCONSISTENT_EVIDENCE');}
 });
}
module.exports={CALL,EVENTS,TRANSFER,decode};
