// Execution-shape matcher. Its research result alone is never admission;
// purchase-recognition adds source commitments, runtime pins and canonical replay.
const E=require('ethers'),P=require('./pons-curve-buy.cjs'),A=require('./pons-channel-attribution.cjs');
const ROUTER='0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc';
const low=x=>String(x).toLowerCase(),check=(v,m)=>{if(!v)throw Error(m);};
function inspect({manifest:m,tx,receipt,trace}){
 const observed=A.inspect(m,tx,receipt);
 check(low(tx.to)===ROUTER&&tx.input.slice(0,10)==='0x4d819a2a','Unexpected research route');
 const shape=require('./pons-router-calldata-research.cjs').decode(m,tx);
 check(trace.type==='CALL'&&low(trace.from)===low(tx.from)&&low(trace.to)===low(tx.to)&&low(trace.input)===low(tx.input)&&BigInt(trace.value||0)===BigInt(tx.value||0),'Trace envelope mismatch');
 const frames=[],logs=new Map();
 function walk(n,parent,path){
  check(!n.error&&!n.revertReason,'Failed trace frame');
  check(['CALL','DELEGATECALL','STATICCALL'].includes(n.type)&&E.isAddress(n.from)&&E.isAddress(n.to),'Unsupported trace frame');
  const context=n.type==='DELEGATECALL'?parent?.context:low(n.to);
  check(context&&(!parent||low(n.from)===parent.context),'Trace caller/context mismatch');
  const f={node:n,path,context};frames.push(f);
  for(const log of n.logs||[]){
   const index=String(BigInt(log.index));check(!logs.has(index),'Duplicate trace log');
   check(low(log.address)===context,'Trace log execution context mismatch');logs.set(index,{log,path});
  }
  (n.calls||[]).forEach((c,i)=>walk(c,f,path+'.'+i));
 }
 walk(trace,null,'0');check(logs.size===receipt.logs.length,'Trace/receipt log count mismatch');
 for(const log of receipt.logs){const found=logs.get(String(BigInt(log.logIndex)))?.log;
  check(found&&low(found.address)===low(log.address)&&low(found.data)===low(log.data)&&JSON.stringify(found.topics.map(low))===JSON.stringify(log.topics.map(low)),'Trace/receipt log mismatch');
 }
 check(observed.events.length===1,'Require one terminal curve BUY');
 check(!receipt.logs.some(l=>low(l.address)===low(m.curve)&&l.topics[0]===P.EVENTS.getEvent('CurveSell').topicHash),'Mixed BUY/SELL');
 const event=observed.events[0],calls=frames.filter(f=>f.node.type==='CALL'&&low(f.node.to)===low(m.curve)&&f.node.input?.slice(0,10)===P.CALL.getFunction('buy').selector);
 check(calls.length===1,'Require one curve buy call');const frame=calls[0],call=P.CALL.decodeFunctionData('buy',frame.node.input);
 check(low(frame.node.from)===ROUTER&&event.curveCaller===ROUTER&&event.curveRecipient===low(tx.from)&&low(call.recipient)===low(tx.from)&&String(call.quoteIn)===event.quoteInRaw,'Curve call/event mismatch');
 check(logs.get(event.logIndex).path===frame.path,'Curve event outside buy frame');
 const funding=observed.transfers.filter(t=>t.asset===low(m.quote)&&t.to===ROUTER),debits=observed.transfers.filter(t=>t.asset===low(m.quote)&&t.from===ROUTER);
 const delivery=observed.transfers.filter(t=>t.asset===low(m.token));
 check(delivery.length===1&&delivery[0].from===low(m.curve)&&delivery[0].to===low(tx.from)&&delivery[0].amountRaw===event.tokensOutRaw,'Ambiguous token delivery');
 const paid=debits.filter(t=>t.to===low(m.curve));
 check(paid.length===1&&paid[0].amountRaw===event.quoteInRaw&&logs.get(paid[0].logIndex).path.startsWith(frame.path+'.'),'Curve quote payment mismatch');
 const walletDelta=observed.assetDeltas.find(x=>x.asset===low(m.quote)&&x.address===low(tx.from));
 const directUsd=BigInt(tx.value||0)===0n;
 if(directUsd)check(funding.length===1&&funding[0].from===low(tx.from),'Ambiguous USDG payer');
 else check(funding.length===1&&funding[0].from!==low(tx.from)&&!walletDelta,'Ambiguous ETH funding');
 check(BigInt(event.tokensOutRaw)>=shape.minReturn,'Minimum output mismatch');
 const feeRecipient='0xb8159ba378904f803639d274cec79f788931c9c8',fee=shape.amountIn/100n;
 const expected=directUsd?[
  [m.quote,tx.from,feeRecipient,fee],[m.quote,tx.from,ROUTER,shape.amountIn-fee],
  [m.quote,ROUTER,m.curve,shape.amountIn-fee],[m.token,m.curve,tx.from,BigInt(event.tokensOutRaw)]
 ]:[
  [m.quote,m.fundingPool,ROUTER,BigInt(event.quoteInRaw)],
  [m.quote,ROUTER,m.curve,BigInt(event.quoteInRaw)],[m.token,m.curve,tx.from,BigInt(event.tokensOutRaw)]
 ];
 check(observed.transfers.length===expected.length,'Refund/extra project asset transfer');
 expected.forEach(([asset,from,to,amount],i)=>{const t=observed.transfers[i];check(t.asset===low(asset)&&t.from===low(from)&&t.to===low(to)&&BigInt(t.amountRaw)===amount,'Exact funding/payment flow mismatch');});
 const modules=[...new Set(frames.filter(f=>f.node.type==='DELEGATECALL'&&f.context===ROUTER).map(f=>low(f.node.to)))];
 const expectedModules=['0x56101165bcf508b288f383113892e6db6be6db0e',...(directUsd?[]:['0xd17b21b65cc273a4b342f14b19063da8bb410dbd']),'0x1ab4c5dfe15ff16170201d7fe0edc20c3d0cada3'];
 check(JSON.stringify(modules)===JSON.stringify(expectedModules),'Unexpected executed router module');
 return {schema:'pons-router-trace-research-v1',admitted:false,eligibility:null,transactionHash:tx.hash,blockNumber:Number(BigInt(tx.blockNumber)),recipient:low(tx.from),funding:directUsd?'USDG':'ETH',curveQuoteRaw:event.quoteInRaw,
  observedWalletQuoteDebitRaw:walletDelta?String(-BigInt(walletDelta.delta)):null,routerQuoteFunding:funding,routerQuoteDebits:debits,
  nativePayments:frames.filter(f=>f.node.type==='CALL'&&low(f.node.from)===ROUTER&&BigInt(f.node.value||0)>0n).map(f=>({to:low(f.node.to),valueRaw:String(BigInt(f.node.value)),selector:f.node.input?.slice(0,10)})),
  routerModules:[...new Set(frames.filter(f=>f.node.type==='DELEGATECALL'&&f.context===ROUTER).map(f=>low(f.node.to)))],frames:frames.length,receiptLogsBound:logs.size,
  limits:['RPC callTracer is trusted execution evidence, not cryptographic proof','Observed payment is not an approved ticket basis','Runtime/storage/upgrade/signature semantics not admitted','No new policy and no retroactive tickets']};
}
module.exports={inspect,ROUTER};
if(require.main===module){
 const fs=require('node:fs'),[input,output]=process.argv.slice(2);
 check(input&&output,'Usage: node scripts/pons-router-trace-research.cjs FIXTURE NEW_REPORT');
 fs.writeFileSync(output,JSON.stringify(inspect(JSON.parse(fs.readFileSync(input))),null,2)+'\n',{flag:'wx'});
}
