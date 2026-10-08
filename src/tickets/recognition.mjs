import { ROUTER } from '../pons/client.mjs';
import direct from './direct-curve.cjs';
const { EVENTS, TRANSFER } = direct;
const low = x => x.toLowerCase();
const same = (a,b) => low(a)===low(b);
const check = (x,m) => { if(!x) throw Error(m); };
export function recognize(profile, tx, receipt) {
  const trades=receipt.logs.filter(l=>same(l.address,profile.curve)&&['CurveBuy','CurveSell'].some(n=>l.topics[0]===EVENTS.getEvent(n).topicHash));
  if(!trades.length)return receipt.logs.filter(l=>same(l.address,profile.token)&&l.topics[0]===TRANSFER.getEvent('Transfer').topicHash).map(l=>({
    candidateId:[profile.chainId,low(l.blockHash),low(l.transactionHash),Number(BigInt(l.logIndex))].join(':'),blockNumber:Number(BigInt(l.blockNumber)),blockHash:low(l.blockHash),transactionHash:low(l.transactionHash),logIndex:Number(BigInt(l.logIndex)),status:'INELIGIBLE_OR_UNSUPPORTED',reason:'TOKEN_TRANSFER_WITHOUT_SUPPORTED_BUY'}));
  if(!tx.to || !same(tx.to,profile.router)) return direct.decode(profile,tx,receipt);
  return trades.map(log=>{
    const base={candidateId:[profile.chainId,low(log.blockHash),low(log.transactionHash),Number(BigInt(log.logIndex))].join(':'),blockNumber:Number(BigInt(log.blockNumber)),blockHash:low(log.blockHash),transactionHash:low(log.transactionHash),logIndex:Number(BigInt(log.logIndex))};
    try {
      const e=EVENTS.parseLog(log);if(e.name==='CurveSell')return {...base,status:'INELIGIBLE',reason:'SELL'};
      check(trades.length===1,'MULTIPLE_TRADES');
      const c=ROUTER.parseTransaction({data:tx.input});
      check(c?.name==='launchAndBuy'&&same(ROUTER.encodeFunctionData(c.name,c.args),tx.input),'UNSUPPORTED_ROUTER_CALL');
      const a=c.args,payer=low(tx.from),event=e.args;
      check(same(a[2],profile.quote)&&same(a[5],payer)&&same(event.recipient,payer)&&same(event.buyer,profile.router),'PAYER_RECIPIENT_MISMATCH');
      check(![profile.factory,profile.router,profile.curve,profile.token,profile.quote].some(x=>same(x,payer)),'SERVICE_ADDRESS');
      check(BigInt(receipt.status)===1n&&event.quoteIn>0n&&event.quoteIn<=a[3]&&event.tokensOut>0n&&event.fee+event.tax<event.quoteIn,'EXECUTION_MISMATCH');
      check(event.quoteIn*a[4]<=a[3]*event.tokensOut,'MIN_OUTPUT_MISMATCH');
      const launches=receipt.logs.filter(l=>same(l.address,profile.router)&&l.topics[0]===ROUTER.getEvent('Launched').topicHash);
      check(launches.length===1,'LAUNCH_EVENT_MISMATCH');
      const launch=ROUTER.parseLog(launches[0]).args;
      check(same(launch[0],profile.token)&&same(launch[1],profile.curve)&&same(launch[2],payer)&&same(launch[3],payer)&&launch[4]===a[3]&&launch[5]===event.tokensOut,'LAUNCH_BINDING_MISMATCH');
      const transfers=receipt.logs.filter(l=>[profile.quote,profile.token].some(x=>same(x,l.address))&&l.topics[0]===TRANSFER.getEvent('Transfer').topicHash)
        .map(l=>({asset:low(l.address),...TRANSFER.parseLog(l).args.toObject(),index:Number(BigInt(l.logIndex))}));
      const quote=transfers.filter(t=>same(t.asset,profile.quote));
      const legs=(from,to,value)=>quote.filter(t=>same(t.from,from)&&same(t.to,to)&&t.value===value);
      const paid=legs(payer,profile.router,a[3]),forward=legs(profile.router,profile.curve,a[3]);
      check(paid.length===1&&forward.length===1&&paid[0].index<forward[0].index,'PAYMENT_MISMATCH');
      const delivered=transfers.filter(t=>same(t.asset,profile.token)&&(same(t.from,payer)||same(t.to,payer)));
      check(delivered.length===1&&same(delivered[0].from,profile.curve)&&same(delivered[0].to,payer)&&delivered[0].value===event.tokensOut&&delivered[0].index>forward[0].index&&delivered[0].index<base.logIndex,'DELIVERY_MISMATCH');
      const refund=a[3]-event.quoteIn;
      const refundLogs=receipt.logs.filter(l=>same(l.address,profile.curve)&&l.topics[0]===EVENTS.getEvent('CurveBuyRefunded').topicHash);
      const walletLegs=quote.filter(t=>same(t.from,payer)||same(t.to,payer));
      if(refund===0n) check(walletLegs.length===1&&refundLogs.length===0,'UNEXPECTED_REFUND');
      else {
        const returned=legs(profile.router,payer,refund),curveRefund=legs(profile.curve,profile.router,refund);
        check(walletLegs.length===2&&returned.length===1&&curveRefund.length===1&&refundLogs.length===1,'REFUND_MISMATCH');
        const re=EVENTS.parseLog(refundLogs[0]).args;
        check(same(re.buyer,profile.router)&&re.amount===refund&&returned[0].index>base.logIndex&&curveRefund[0].index<base.logIndex,'REFUND_ORDER_MISMATCH');
      }
      return {...base,status:'ELIGIBLE',reason:'OPENING_BUY',payer,recipient:payer,netQuoteDebitRaw:String(event.quoteIn),refundQuoteRaw:String(refund)};
    }catch(error){return {...base,status:'UNSUPPORTED_OR_AMBIGUOUS',reason:error.message};}
  });
}
