// Explicit genesis profile. Existing curve/v4 policies are never upgraded implicitly.
const {Interface,isAddress,Signature,verifyAuthorization}=require('ethers');
const C=require('./pons-curve-buy.cjs'),B=require('./pons-batch-buy.cjs'),F=require('./pons-batch-funding.cjs');
const SCHEMA='direct-buy-pons-batch-v1',ID='rh-pons-curve-self-batch-v1';
const FIELDS=[...C.FIELDS,'batchExecutor','weth','fundingRouter','fundingPool'];
const EXECUTOR='0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
const EXECUTOR_HASH='0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0';
const PINS={
 weth:['0x0bd7d308f8e1639fab988df18a8011f41eacad73','0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353'],
 fundingRouter:['0xcaf681a66d020601342297493863e78c959e5cb2','0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc'],
 fundingPool:['0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca','0x3298b5dd4e6f115074c526a55ad05a36fd73a0034ac22ec6cbaab32cc9c1e8d2']
};
const low=x=>x.toLowerCase(),check=(v,s)=>{if(!v)throw Error(s);};
const abi=new Interface(['function token0() view returns(address)','function token1() view returns(address)','function fee() view returns(uint24)','function factory() view returns(address)','function getPool(address,address,uint24) view returns(address)']);
function validate(m){
 check(m.schema===SCHEMA&&m.routeVersion===ID,'Wrong Pons batch profile');
 C.validate({...m,schema:C.SCHEMA,routeVersion:C.ID});
 check(low(m.batchExecutor||'')===EXECUTOR&&m.codeHashes.batchExecutor===EXECUTOR_HASH,'Unreviewed batch executor');
 for(const [field,[address,hash]]of Object.entries(PINS))check(low(m[field]||'')===address&&m.codeHashes[field]===hash,'Unexpected funding pin '+field);
 for(const field of FIELDS){check(isAddress(m[field])&&/^0x[0-9a-f]{64}$/.test(m.codeHashes[field]),'Missing batch dependency '+field);}
 check(new Set(FIELDS.map(k=>low(m[k]))).size===FIELDS.length,'Overlapping batch dependencies');
}
async function validateBindings(m,rpc,tag){
 const record=await C.validateBindings(m,rpc,tag);
 const read=async(to,name,args=[])=>abi.decodeFunctionResult(name,await rpc('eth_call',[{to,data:abi.encodeFunctionData(name,args)},tag]))[0];
 const tokens=[low(await read(m.fundingPool,'token0')),low(await read(m.fundingPool,'token1'))];
 check(tokens.join() === [m.weth,m.quote].map(low).sort().join(),'Funding pool assets mismatch');
 check(await read(m.fundingPool,'fee')===100n,'Funding fee mismatch');
 const factory=await read(m.fundingRouter,'factory');
 check(low(await read(m.fundingPool,'factory'))===low(factory),'Funding factory mismatch');
 check(low(await read(factory,'getPool',[m.weth,m.quote,100]))===low(m.fundingPool),'Funding pool binding mismatch');
 return record;
}
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
module.exports={SCHEMA,ID,FIELDS,PINS,EXECUTOR,EXECUTOR_HASH,validate,validateBindings,decode,execution};
