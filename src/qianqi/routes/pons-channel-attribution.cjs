// Adapted pure route verifier from rh_project 11a050d; no CLI or production configuration.
// Read-only research diagnostics. Transfer flows are not execution/ownership proof.
const {isAddress}=require('ethers');
const P=require('../../tickets/direct-curve.cjs');
const low=x=>String(x).toLowerCase();
const check=(v,m)=>{if(!v)throw Error(m);};
function inspect(manifest,tx,receipt){
 check(tx&&/^0x[0-9a-f]{64}$/i.test(tx.hash)&&/^0x[0-9a-f]{64}$/i.test(tx.blockHash)&&isAddress(tx.from)&&isAddress(tx.to),'Invalid transaction identity');
 check(/^0x(?:[0-9a-f]{2}){4,}$/i.test(tx.input)&&Array.isArray(receipt?.logs),'Invalid transaction/receipt shape');
 check(receipt&&tx&&low(receipt.transactionHash)===low(tx.hash)&&low(receipt.blockHash)===low(tx.blockHash),'Receipt identity mismatch');
 check(BigInt(receipt.blockNumber)===BigInt(tx.blockNumber)&&BigInt(receipt.transactionIndex)===BigInt(tx.transactionIndex),'Receipt position mismatch');
 check(low(receipt.from)===low(tx.from)&&low(receipt.to)===low(tx.to),'Receipt envelope mismatch');
 check(BigInt(receipt.status)===1n,'Unsuccessful receipt');
 const indexes=new Set();
 for(const log of receipt.logs){
  check(!log.removed&&low(log.transactionHash)===low(tx.hash)&&low(log.blockHash)===low(tx.blockHash),'Log identity mismatch');
  check(BigInt(log.blockNumber)===BigInt(tx.blockNumber)&&BigInt(log.transactionIndex)===BigInt(tx.transactionIndex),'Log position mismatch');
  const i=BigInt(log.logIndex);check(i>=0n&&!indexes.has(String(i)),'Duplicate/invalid log index');indexes.add(String(i));
 }
 const assets=[low(manifest.quote),low(manifest.token)];
 const transfers=receipt.logs.filter(l=>assets.includes(low(l.address))&&l.topics[0]===P.TRANSFER.getEvent('Transfer').topicHash).map(l=>{
  const a=P.TRANSFER.parseLog(l).args;return {asset:low(l.address),from:low(a.from),to:low(a.to),amountRaw:String(a.value),logIndex:String(BigInt(l.logIndex))};
 }).sort((a,b)=>BigInt(a.logIndex)<BigInt(b.logIndex)?-1:1);
 const balances=new Map();
 for(const t of transfers)for(const [address,sign]of [[t.from,-1n],[t.to,1n]]){
  check(isAddress(address),'Invalid transfer address');const key=t.asset+':'+address;
  balances.set(key,{asset:t.asset,address,delta:(balances.get(key)?.delta??0n)+sign*BigInt(t.amountRaw)});
 }
 const events=receipt.logs.filter(l=>low(l.address)===low(manifest.curve)&&l.topics[0]===P.EVENTS.getEvent('CurveBuy').topicHash).map(l=>{
  const a=P.EVENTS.parseLog(l).args;return {candidateId:[manifest.chainId,low(tx.blockHash),low(tx.hash),BigInt(l.logIndex)].join(':'),logIndex:String(BigInt(l.logIndex)),curveCaller:low(a.buyer),curveRecipient:low(a.recipient),quoteInRaw:String(a.quoteIn),tokensOutRaw:String(a.tokensOut)};
 });
 return {schema:'pons-attribution-observation-v1',admitted:false,eligibility:null,transactionHash:low(tx.hash),transactionSender:low(tx.from),transactionTarget:low(tx.to),selector:tx.input.slice(0,10),events,transfers,
  assetDeltas:[...balances.values()].filter(x=>x.delta!==0n).map(x=>({...x,delta:String(x.delta)})),
  directDecoder:P.decode(manifest,tx,receipt).map(x=>({candidateId:x.candidateId,status:x.status,reason:x.reason})),
  limits:['No wallet ownership or batch classification inferred from transfers','Whole-transaction deltas are not per-BUY spending','No runtime, signature, call-boundary or deployment admission']};
}

module.exports={inspect};
