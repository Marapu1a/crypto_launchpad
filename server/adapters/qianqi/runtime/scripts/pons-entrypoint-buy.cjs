// Genesis-only extension. One signed UserOperation, pinned pre-existing delegate,
// canonical execute → holder → one USDG pool. Bundler is never the participant.
const E=require('ethers'),Z=require('./pons-zeroex-buy.cjs'),C=require('./pons-entrypoint-codec.cjs');
const SCHEMA='direct-buy-pons-launch-v4',ID='rh-pons-curve-pool-batch-zeroex-entrypoint-v1';
const FIELDS=[...Z.FIELDS,'entryPoint','entryPointAccount'];
const PINS={entryPoint:[C.ENTRY,C.ENTRY_HASH],entryPointAccount:[C.IMPLEMENTATION,C.IMPLEMENTATION_HASH]};
const low=x=>x.toLowerCase(),check=(v,m)=>{if(!v)throw Error(m);};
function canonical(abi,name,data){const a=abi.decodeFunctionData(name,data);check(low(abi.encodeFunctionData(name,a))===low(data),'NONCANONICAL_CALL');return a;}
function validate(m){
 check(m.schema===SCHEMA&&m.routeVersion===ID,'Wrong Pons EntryPoint profile');
 Z.validate({...m,schema:Z.SCHEMA,routeVersion:Z.ID});
 for(const [k,[a,h]]of Object.entries(PINS))check(low(m[k]||'')===a&&m.codeHashes[k]===h,'Unexpected EntryPoint '+k+' pin');
 check(new Set(FIELDS.map(k=>low(m[k]))).size===FIELDS.length,'Overlapping EntryPoint identities');
}
async function validateBindings(m,rpc,tag){
 await Z.validateBindings(m,rpc,tag);
 const result=await rpc('eth_call',[{to:m.entryPointAccount,data:C.ACCOUNT.encodeFunctionData('entryPoint')},tag]);
 check(low(C.ACCOUNT.decodeFunctionResult('entryPoint',result)[0])===low(m.entryPoint),'Account EntryPoint binding mismatch');
}
// Bounded scanner hint, not admission. Malformed/multi-op calls do not trigger
// arbitrary historical account reads or select an arbitrary wallet in a bundle.
function accountCandidate(m,tx){
 if(!tx.to||low(tx.to)!==low(m.entryPoint))return null;
 try{const a=canonical(C.ENTRY_ABI,'handleOps',tx.input);return a.ops.length===1?low(a.ops[0].sender):null;}catch{return null;}
}
function decode(m,tx,receipt,block){
 const original=Z.decode(m,tx,receipt,block);
 if(!tx.to||low(tx.to)!==low(m.entryPoint)||!original.some(d=>d.poolId===low(m.poolId)&&d.reason!=='SELL'))return original;
 let stage='ENVELOPE',observedAccount;
 try{
  require('./pons-channel-attribution.cjs').inspect(m,tx,receipt);
  check(block&&low(block.hash)===low(tx.blockHash),'MISSING_BLOCK');
  check(BigInt(tx.value)===0n,'OUTER_NATIVE_VALUE');
  const outer=canonical(C.ENTRY_ABI,'handleOps',tx.input);check(outer.ops.length===1,'MULTIPLE_USER_OPERATIONS');
  const op=outer.ops[0],account=low(op.sender),digest=C.userOpHash(op,m.chainId);
  const eventLogs=receipt.logs.filter(l=>low(l.address)===low(m.entryPoint)&&l.topics[0]===C.ENTRY_ABI.getEvent('UserOperationEvent').topicHash);
  const before=receipt.logs.filter(l=>low(l.address)===low(m.entryPoint)&&l.topics[0]===C.ENTRY_ABI.getEvent('BeforeExecution').topicHash);
  check(eventLogs.length===1&&before.length===1,'OP_EVENT_COUNT');
  const event=C.ENTRY_ABI.parseLog(eventLogs[0]).args;
  check(low(event.sender)===account&&event.nonce===op.nonce&&low(event.userOpHash)===low(digest)&&event.success&&low(event.paymaster)===E.ZeroAddress,'OP_EVENT_MISMATCH');
  observedAccount=account;
  stage='ACCOUNT';
  check(!FIELDS.some(k=>low(m[k])===account),'SERVICE_ACCOUNT');
  check(op.initCode==='0x'&&op.paymasterAndData==='0x'&&(op.nonce>>64n)===1n,'ACCOUNT_MODE');
  check(/^0xff00[0-9a-f]{130}$/i.test(op.signature)&&low(E.verifyMessage(E.getBytes(digest),'0x'+op.signature.slice(6)))===account,'OP_SIGNATURE');
  const saved=block.entrypointAccounts?.[account];
  check(saved&&low(saved.parentHash)===low(block.parentHash)&&low(saved.code)==='0xef0100'+low(m.entryPointAccount).slice(2),'MISSING_PARENT_DELEGATION');
  // EIP-7702 changes take effect before tx execution. Never infer a transaction's
  // delegate from end-of-block code or overlook another transaction's authority.
  for(const row of block.transactions)for(const a of row.tx.authorizationList||[]){
   if(BigInt(a.chainId)!==0n&&BigInt(a.chainId)!==BigInt(m.chainId))continue;
   let authority;try{authority=E.verifyAuthorization({address:a.address,chainId:a.chainId,nonce:a.nonce},E.Signature.from({r:a.r,s:a.s,yParity:Number(BigInt(a.yParity))}));}catch{continue;}
   check(low(authority)!==account,'IN_BLOCK_DELEGATION_CHANGE');
  }
  stage='CALL';
  const call=canonical(C.ACCOUNT,'execute',op.callData);
  check(low(call.target)===low(m.allowanceHolder)&&call.value===0n,'UNSUPPORTED_ACCOUNT_CALL');
  check(original.length===1,'MULTIPLE_CANDIDATES');
  const start=BigInt(before[0].logIndex),end=BigInt(eventLogs[0].logIndex);
  check(start<end&&BigInt(original[0].logIndex)>start&&BigInt(original[0].logIndex)<end,'OP_LOG_BOUNDARY');
  // All relevant asset/pool/hook logs must belong to execution, not validation
  // or another operation. The common proof checks their exact conservation.
  for(const l of receipt.logs)if([m.quote,m.token,m.manager,m.hook,m.curve].map(low).includes(low(l.address)))check(BigInt(l.logIndex)>start&&BigInt(l.logIndex)<end,'OUTSIDE_OPERATION');
  const proof=Z.proveCall(m,{payer:account,input:call.data,value:call.value},receipt,block);
  return [{...original[0],...proof,reason:'SUPPORTED_ENTRYPOINT_POOL_BUY',adapterId:ID,userOpHash:digest,entryPoint:low(m.entryPoint)}];
 }catch(e){return original.map(d=>d.poolId===low(m.poolId)&&d.reason!=='SELL'?{...d,status:'UNSUPPORTED_ROUTE',reason:'ENTRYPOINT_'+(e.routeStage||stage)+'_NOT_QUALIFIED',routeDetail:e.message,...(observedAccount?{observedAccount,attribution:'user-operation-sender-only'}:{})}:d);}
}
module.exports={SCHEMA,ID,FIELDS,PINS,validate,validateBindings,decode,accountCandidate};
