// QIANQI self-batch execution admission, adapted from ae445254.
const {Signature,verifyAuthorization}=require('ethers');
const C=require('../../tickets/direct-curve.cjs'),B=require('./pons-batch-buy.cjs'),F=require('./pons-batch-funding.cjs');
const ID='rh-pons-curve-self-batch-v1',low=x=>x.toLowerCase(),check=(v,m)=>{if(!v)throw Error(m);};
function authority(a){return low(verifyAuthorization({address:a.address,chainId:a.chainId,nonce:a.nonce},Signature.from({r:a.r,s:a.s,yParity:Number(BigInt(a.yParity))})));}
function execution(m,tx,block){
 check(block&&low(tx.blockHash)===low(block.hash),'Missing batch block context');
 const payer=low(tx.from),marker='0xef0100'+low(m.batchExecutor).slice(2);
 if(BigInt(tx.type)===4n){
  check(tx.authorizationList?.length===1,'Multiple/missing authorizations');const a=tx.authorizationList[0];
  check(BigInt(a.chainId)===BigInt(m.chainId)&&BigInt(a.nonce)===BigInt(tx.nonce)+1n&&BigInt(a.nonce)<2n**64n-1n,'Wrong authorization domain/nonce');
  check(authority(a)===payer&&low(a.address)===low(m.batchExecutor),'Wrong authorization authority/executor');
 }else{
  check(BigInt(tx.type)===2n&&!tx.authorizationList?.length,'Unsupported batch tx type');
  const evidence=block.batchAccounts?.[payer];
  check(evidence&&low(evidence.parentHash)===low(block.parentHash)&&low(evidence.code)===marker,'Missing parent delegation evidence');
  // Conservative: an authorization to this account anywhere in the block
  // needs finer execution evidence. Do not infer order from end-of-block code.
  for(const row of block.transactions)for(const a of row.tx.authorizationList||[]){
   if(BigInt(a.chainId)!==0n&&BigInt(a.chainId)!==BigInt(m.chainId))continue;
   let signer;try{signer=authority(a);}catch{continue;} // Invalid signatures are skipped by EIP-7702.
   check(signer!==payer,'In-block delegation change');
  }
 }
}
function decode(m,tx,receipt,block){
 const original=C.decode(m,tx,receipt);
 if(!tx.to||low(tx.to)!==low(tx.from))return original;
 if(!original.length||original.every(d=>d.reason==='SELL'))return original;
 try{
  execution(m,tx,block);
  let shape=B.decode(m,tx,receipt),filtered=receipt;
  if(shape.status!=='SHAPE_MATCH'){
   shape=F.decode(m,{weth:m.weth,router:m.fundingRouter,pool:m.fundingPool},tx,receipt);
   check(shape.status==='SHAPE_MATCH','Unqualified batch shape');
   // Only the uniquely matched pool->payer funding transfer is excluded from
   // the BUY-local projection. Original evidence stays intact in the ledger.
   filtered={...receipt,logs:receipt.logs.filter(l=>BigInt(l.logIndex)!==BigInt(shape.fundingLogIndex))};
  }
  const outer=B.EXEC.decodeFunctionData('execute',tx.input);
  const {AbiCoder}=require('ethers');const [calls]=AbiCoder.defaultAbiCoder().decode(B.TYPES,outer.executionCalldata);
  const buy=calls[calls.length-1];
  const decisions=C.decode(m,{...tx,to:m.curve,input:buy.callData},filtered);
  check(decisions.length===1&&decisions[0].status==='ELIGIBLE','Inconsistent batch BUY');
  return decisions.map(d=>({...d,reason:'SUPPORTED_SELF_BATCH_BUY',batchRoute:ID,fundingQuoteRaw:shape.fundingQuoteRaw??'0',evidenceLogIndexes:receipt.logs.map(l=>Number(BigInt(l.logIndex)))}));
 }catch(e){return original.map(d=>d.reason==='SELL'?d:({...d,status:'UNSUPPORTED_ROUTE',reason:'BATCH_EXECUTION_NOT_QUALIFIED',batchDetail:e.message}));}
}
module.exports={decode};
