// Optional late-credit evidence. Original BUY records remain immutable in position;
// only a canonical commitment determines when a verified purchase enters carry.
const E=require('ethers'),fs=require('node:fs'),path=require('node:path');
const ABI=new E.Interface(['event PurchasesRecognized(bytes32 indexed instanceId,bytes32 indexed bundleHash,uint256 count)','function confirm(bytes32 bundleHash,uint256 count)']);
const low=x=>String(x).toLowerCase(),n=x=>Number(BigInt(x)),check=(v,m)=>{if(!v)throw Error('Purchase recognition: '+m);};
const digest=x=>require('./direct-buy.cjs').hash(x);
const TOPIC=ABI.getEvent('PurchasesRecognized').topicHash;
const MAX_BYTES=8*1024*1024;
function trust(t){
 check(t?.schema==='purchase-recognition-v1'&&E.isAddress(t.source)&&t.source!==E.ZeroAddress&&E.isAddress(t.publisher)&&t.publisher!==E.ZeroAddress,'invalid source trust');
 check(E.isHexString(t.sourceCodeHash,32)&&E.isHexString(t.instanceId,32)&&t.instanceId!==E.ZeroHash,'invalid source identity');
 check(t.adapter==='pons-router-65050-v1','unknown adapter');
 if(t.publication){const p=t.publication,a=Date.parse(p.publishedAt),b=Date.parse(p.notBefore);check(Number.isFinite(a)&&Number.isFinite(b)&&b>=a+86400000&&/^https:\/\//.test(p.url)&&/^[0-9a-f]{64}$/.test(p.sha256),'invalid public notice');}
 const implementations={quote:['0x68184c449e1a8f34fa18d289737129fd27b66f8f','0x3a551ac5c744af57e68a1d1431ac403c0f516ffd7d224a75746aee11fc4f3baf'],weth:['0xc6b81b429797e0f555440b70cd99e032d7ae947e','0xbe1295f37be34ffe03ad779bda0ef278907e1856b51a3be2f35ee541d75d4650']};
 check(Object.keys(t.implementations||{}).sort().join(',')==='quote,weth','unexpected implementation set');
 for(const [key,[address,codeHash]] of Object.entries(implementations))check(low(t.implementations[key]?.address)===address&&low(t.implementations[key]?.codeHash)===codeHash,'unreviewed implementation pin');
 return t;
}
function attach(input,config){
 if(!config)return input;
 const {bundleDirectory,...publicTrust}=config;trust(publicTrust);
 check(!input.recognition,'duplicate recognition trust');
 return {...(input.schema==='buy-policy-history-v1'?input:{schema:'buy-policy-history-v1',versions:[{fromBlock:n(input.anchor.number),manifest:input}]}),recognition:publicTrust};
}
function events(block,t){
 return block.transactions.flatMap(({receipt})=>receipt.logs.filter(l=>low(l.address)===low(t.source)&&low(l.topics[0])===low(TOPIC))).sort((a,b)=>n(a.logIndex)-n(b.logIndex));
}
function pins(m,t){
 return {
  '0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc':'0xf9e0c7528d41526b7e818b1b8dcab413df3f20e8908b5386e4ba6f3c3ef07a8f',
  '0x56101165bcf508b288f383113892e6db6be6db0e':'0x138db16738c14ad90956aecbd0939fcbf72e9d39755867e02b87a4d927a2f4ab',
  '0xd17b21b65cc273a4b342f14b19063da8bb410dbd':'0x0f3e60976384e62a8359f1c3a6424b488b12a05bfa82366fdffafd9d3d1fbf95',
  '0x1ab4c5dfe15ff16170201d7fe0edc20c3d0cada3':'0x0a9f1cdcd49033dedb5525414b57d74ca5aa4832d86263a4189adab37f334174',
  ...Object.fromEntries(['quote','token','curve','weth','fundingPool'].map(k=>[low(m[k]),m.codeHashes[k]])),
  ...Object.fromEntries(Object.values(t.implementations).map(x=>[low(x.address),x.codeHash]))
 };
}
function verify(m,t,row,proof,block){
 const {tx,receipt}=row;
 check(!tx.authorizationList?.length,'authorization-bearing transaction');
 check(proof.transactionHash===low(tx.hash)&&proof.blockHash===low(block.hash),'proof purchase binding');
 const shape=require('./pons-router-calldata-research.cjs').decode(m,tx);
 check(shape.deadline>=BigInt(block.timestamp),'expired purchase');
 const result=require('./pons-router-trace-research.cjs').inspect({manifest:m,tx,receipt,trace:proof.trace});
 const expected=pins(m,t),fee='0xb8159ba378904f803639d274cec79f788931c9c8';
 const executed=new Set();
 function walk(frame){
  const address=low(frame.to);executed.add(address);
  if(address===fee)check(frame.type==='CALL'&&frame.input==='0x'&&!(frame.calls?.length)&&!(frame.logs?.length),'fee receiver callback');
  else check(expected[address],'unreviewed execution target');
  for(const child of frame.calls||[])walk(child);
 }
 walk(proof.trace);
 for(const address of executed){
  const codeHash=proof.codeHashes?.[address];check(E.isHexString(codeHash,32),'missing runtime evidence');
  check(proof.parentCodeHashes?.[address]===codeHash,'runtime changed or missing parent evidence');
  check(codeHash===(address===fee?E.keccak256('0x'):low(expected[address])),'runtime mismatch');
 }
 // The outer signer is the only supported beneficiary. Contract/7702 accounts
 // require a separate adapter; never infer ownership through an arbitrary caller.
 check(proof.codeHashes?.[low(tx.from)]===E.keccak256('0x')&&proof.parentCodeHashes?.[low(tx.from)]===E.keccak256('0x'),'non-EOA payer');
 if(shape.native){
  const feeAmount=shape.amountIn/100n,payments=result.nativePayments;
  check(payments.length===2&&payments[0].to===fee&&BigInt(payments[0].valueRaw)===feeAmount&&payments[1].to===low(m.weth)&&BigInt(payments[1].valueRaw)===shape.amountIn-feeAmount,'native funding mismatch');
 }
 return {payer:result.recipient,recipient:result.recipient,grossQuoteRaw:shape.native?result.curveQuoteRaw:result.observedWalletQuoteDebitRaw};
}
function apply(input,blocks,ledger){
 const t=trust(input.recognition),m=require('./direct-buy.cjs').buyPolicyHistory(input).genesis;
 const originals=new Map();
 for(const block of blocks){
  require('./project-history.cjs').validateSources(block,[t.source]);
  require('./pons-bloom-evidence.cjs').validateOmission(block,m,[t.source]);
  for(const row of block.transactions)originals.set(low(row.tx.hash),{row,block});
 }
 const byTx=new Map();
 for(const d of ledger.decisions){
  if(!byTx.has(d.transactionHash))byTx.set(d.transactionHash,[]);byTx.get(d.transactionHash).push(d);
  if(d.status==='UNSUPPORTED_ROUTE'){
   d.status='WAITING_RECOGNITION';d.observedSender??=low(originals.get(d.transactionHash).row.tx.from);
  }
 }
 const seen=new Set();
 for(const block of blocks)for(const log of events(block,t)){
  check(block.recognitionSourceCode&&E.keccak256(block.recognitionSourceCode)===low(t.sourceCodeHash),'source runtime evidence');
  const event=ABI.parseLog(log),encoded=ABI.encodeEventLog(event.fragment,event.args);
  check(digest(encoded.topics.map(low))===digest(log.topics.map(low))&&low(encoded.data)===low(log.data),'non-canonical confirmation');
  const {instanceId,bundleHash,count}=event.args;
  const confirmation=originals.get(low(log.transactionHash)).row.tx;
  check(low(confirmation.from)===low(t.publisher)&&low(confirmation.to)===low(t.source)&&BigInt(confirmation.value||0)===0n&&low(confirmation.input)===low(ABI.encodeFunctionData('confirm',[bundleHash,count])),'confirmation authority/calldata');
  check(low(instanceId)===low(t.instanceId)&&count>0n&&count<=50n&&!seen.has(bundleHash),'invalid or duplicate batch');seen.add(bundleHash);
  const bundle=block.recognitionBundles?.[bundleHash];
  check(bundle&&Buffer.byteLength(JSON.stringify(bundle))<=MAX_BYTES&&digest(bundle)===bundleHash,'missing or corrupt committed bundle');
  check(bundle.schema==='purchase-recognition-bundle-v1'&&bundle.instanceId===low(t.instanceId)&&String(bundle.chainId)===String(m.chainId)&&bundle.token===low(m.token)&&bundle.proofs.length===Number(count),'bundle domain/count');
  const within=new Set();
  for(const proof of bundle.proofs){
   check(!within.has(proof.transactionHash),'duplicate purchase in batch');within.add(proof.transactionHash);
   const original=originals.get(proof.transactionHash),candidates=byTx.get(proof.transactionHash);
   check(original&&n(original.block.number)<n(block.number)&&candidates?.length===1,'missing/ambiguous/non-historical purchase');
   const d=candidates[0],verified=verify(m,t,original.row,proof,original.block);
   check(BigInt(verified.grossQuoteRaw)>0n,'invalid purchase amount');
   // Repeat confirmations are harmless and cannot move the first credit forward.
   if(d.recognition){check(digest(verified)===digest({payer:d.payer,recipient:d.recipient,grossQuoteRaw:d.grossQuoteRaw}),'conflicting repeated purchase');continue;}
   check(d.status==='WAITING_RECOGNITION','purchase already counted or ineligible');
   Object.assign(d,verified,{status:'ELIGIBLE',reason:'VERIFIED_LATE_PURCHASE',recognition:{bundleHash,source:low(t.source)},creditedAt:{blockNumber:n(block.number),blockHash:low(block.hash),transactionHash:low(log.transactionHash),transactionIndex:n(log.transactionIndex),logIndex:n(log.logIndex)}});
  }
 }
 const wallets=new Map(),eligible=ledger.decisions.filter(d=>d.status==='ELIGIBLE').sort(order);
 for(const d of eligible){
  const w=wallets.get(d.payer)||{carryRaw:0n,entriesMinted:0n},total=w.carryRaw+BigInt(d.grossQuoteRaw),threshold=BigInt(m.entryThresholdRaw);
  d.entriesMinted=String(total/threshold);w.carryRaw=total%threshold;w.entriesMinted+=total/threshold;wallets.set(d.payer,w);
 }
 ledger.wallets=[...wallets].sort(([a],[b])=>a.localeCompare(b)).map(([wallet,w])=>({wallet,carryRaw:String(w.carryRaw),entriesMinted:String(w.entriesMinted),shortAttemptsMinted:String(w.entriesMinted),monthlyAttemptsMinted:String(w.entriesMinted)}));
 return ledger;
}
function position(d){return d.creditedAt||d;}
function order(a,b){const x=position(a),y=position(b);return x.blockNumber-y.blockNumber||x.transactionIndex-y.transactionIndex||x.logIndex-y.logIndex||a.candidateId.localeCompare(b.candidateId);}
async function hydrate(input,blocks,config,rpc){
 if(!input.recognition)return;
 const t=trust(input.recognition);
 for(const block of blocks){
  const logs=events(block,t);if(!logs.length)continue;
  const tag='0x'+BigInt(block.number).toString(16);
  block.recognitionSourceCode=await rpc('eth_getCode',[t.source,tag]);
  check(E.keccak256(block.recognitionSourceCode)===low(t.sourceCodeHash),'source runtime mismatch');
  block.recognitionBundles??={};
  for(const log of logs){
   const key=ABI.parseLog(log).args.bundleHash;
   if(block.recognitionBundles[key])continue;
   check(config.bundleDirectory,'bundle directory required');
   const file=path.join(config.bundleDirectory,key+'.json');
   check(fs.statSync(file).size<=MAX_BYTES,'bundle too large');
   const bundle=JSON.parse(fs.readFileSync(file,'utf8'));check(digest(bundle)===key,'bundle hash mismatch');block.recognitionBundles[key]=bundle;
  }
 }
}
module.exports={ABI,trust,attach,apply,hydrate,position,order,verify,pins,MAX_BYTES};
