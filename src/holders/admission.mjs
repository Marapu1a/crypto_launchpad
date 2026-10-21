import {Interface,keccak256} from 'ethers';
import {address,check,hash,identity,scope,uint} from './values.mjs';
import {validateHolderSnapshot} from './snapshot.mjs';
const abi=new Interface(['function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)']);
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const hex=n=>'0x'+n.toString(16);
function block(value){
 check(value&&/^0x[0-9a-f]+$/i.test(value.number)&&/^0x[0-9a-f]+$/i.test(value.timestamp),'Missing block');
 const number=Number(BigInt(value.number)),timestamp=Number(BigInt(value.timestamp));
 check(integer(number)&&integer(timestamp),'Invalid block');return {number,timestamp,hash:hash(value.hash)};
}
export function validateSnapshotPolicy(policy,input){
 const instance=scope(input);
 check(policy?.schema==='holder-snapshot-policy-v1'&&policy.scopeId===identity(instance),'Snapshot policy scope mismatch');
 check(policy.semantics==='reviewed-nonproxy-erc20-supply-sum','Explicit reviewed ERC20 semantics required');
 hash(policy.tokenCodeHash);
 check(integer(policy.maxHolders)&&policy.maxHolders>0&&policy.maxHolders<=5000,'Invalid holder budget');
 check(integer(policy.maxRpcCalls)&&policy.maxRpcCalls>=8&&policy.maxRpcCalls<=5010,'Invalid RPC budget');
 check(integer(policy.maxAgeSeconds)&&policy.maxAgeSeconds>0&&policy.maxAgeSeconds<=86400,'Explicit snapshot freshness bound required');
 return structuredClone(policy);
}
export function validateSnapshotAdmission(proof,candidate,policy,input){
 validateSnapshotPolicy(policy,input);const valid=validateHolderSnapshot(candidate);
 check(valid.chainId===input.chainId&&valid.token===address(input.token),'Snapshot source mismatch');
 check(proof?.schema==='holder-chain-admission-v1'&&proof.policyHash===identity(policy)&&proof.scopeId===identity(scope(input))&&proof.candidateId===valid.id,'Snapshot admission identity mismatch');
 check(integer(proof.period)&&proof.period>0&&integer(proof.checkedAt)&&integer(proof.dueAt)&&integer(proof.until),'Invalid period');
 check(integer(proof.block?.number)&&integer(proof.block.timestamp)&&proof.block.timestamp>=proof.dueAt&&proof.block.timestamp<proof.until,'Snapshot block outside period');hash(proof.block.hash);
 check(proof.checkedAt>=valid.observedAt&&proof.checkedAt>=proof.block.timestamp&&proof.checkedAt<proof.until,'Invalid observation time');
 check(proof.checkedAt-valid.observedAt<=policy.maxAgeSeconds&&proof.checkedAt-proof.block.timestamp<=policy.maxAgeSeconds,'Stale snapshot');
 check(valid.holders.length<=policy.maxHolders&&valid.holders.length+8<=policy.maxRpcCalls,'Snapshot budget exceeded');
 check(proof.tokenCodeHash===policy.tokenCodeHash&&proof.totalSupply===valid.supply&&uint(valid.supply)>0n,'Snapshot supply/runtime mismatch');
 check(proof.balancesHash===identity(valid.holders)&&proof.executionEnabled===false,'Snapshot balance commitment mismatch');
 return valid;
}

// Pons enumerates addresses. A bounded monthly check binds all balances to one
// finalized block; completeness relies on reviewed nonnegative ERC20 supply semantics.
export function validateSnapshotRequest({candidate,policy,scope:input,period,dueAt,until,now}){
 const instance=scope(input),valid=validateHolderSnapshot(candidate);validateSnapshotPolicy(policy,instance);
 check(valid.chainId===instance.chainId&&valid.token===instance.token,'Snapshot source mismatch');
 check(integer(now)&&integer(period)&&period>0&&integer(dueAt)&&integer(until)&&dueAt<until&&now>=dueAt&&now<until,'Period not open');
 check(valid.observedAt<=now&&now-valid.observedAt<=policy.maxAgeSeconds,'Stale candidate');
 check(valid.holders.length<=policy.maxHolders&&valid.holders.length+8<=policy.maxRpcCalls,'Snapshot budget exceeded');
 return {instance,valid};
}
export async function admitHolderSnapshot({provider,candidate,policy,scope:input,period,dueAt,until,now}){
 const {instance,valid}=validateSnapshotRequest({candidate,policy,scope:input,period,dueAt,until,now});
 let calls=0;
 const rpc=async(method,args)=>{check(++calls<=policy.maxRpcCalls-2,'RPC budget exceeded');return provider.send(method,args);};
 check(BigInt(await rpc('eth_chainId',[]))===BigInt(instance.chainId),'Wrong snapshot chain');
 const checkpoint=block(await rpc('eth_getBlockByNumber',['finalized',false]));
 check(checkpoint.timestamp>=dueAt&&checkpoint.timestamp<until&&checkpoint.timestamp<=now&&now-checkpoint.timestamp<=policy.maxAgeSeconds,'Finalized snapshot block outside period/freshness');
 const tag=hex(checkpoint.number),code=await rpc('eth_getCode',[instance.token,tag]);
 check(code!=='0x'&&keccak256(code)===policy.tokenCodeHash,'Unreviewed token runtime');
 const call=async(method,args=[])=>abi.decodeFunctionResult(method,await rpc('eth_call',[{to:instance.token,data:abi.encodeFunctionData(method,args)},tag]))[0];
 const supply=await call('totalSupply');check(supply>0n&&String(supply)===valid.supply,'On-chain supply mismatch');
 let sum=0n;
 for(const h of valid.holders){const balance=await call('balanceOf',[h.wallet]);check(String(balance)===h.balance,'Pons balance differs at fixed block');sum+=balance;}
 check(sum===supply,'Incomplete on-chain holder universe');
 check(block(await rpc('eth_getBlockByNumber',[tag,false])).hash===checkpoint.hash,'Snapshot reorg during verification');
 check(block(await rpc('eth_getBlockByNumber',['finalized',false])).number>=checkpoint.number,'Snapshot finality regressed');
 const proof={schema:'holder-chain-admission-v1',scopeId:identity(instance),policyHash:identity(policy),candidateId:valid.id,period,dueAt,until,checkedAt:now,
  block:checkpoint,tokenCodeHash:policy.tokenCodeHash,totalSupply:valid.supply,balancesHash:identity(valid.holders),executionEnabled:false};
 validateSnapshotAdmission(proof,valid,policy,instance);return {proof,rpcCalls:calls,reservedCommitCalls:2};
}
export async function recheckAdmissionBlock(provider,proof){
 const finalized=block(await provider.send('eth_getBlockByNumber',['finalized',false]));
 check(finalized.number>=proof.block.number,'Snapshot finality regressed before commit');
 check(block(await provider.send('eth_getBlockByNumber',[hex(proof.block.number),false])).hash===proof.block.hash,'Snapshot reorg before commit');
}

// One page is verified atomically by the caller. A saved cursor always refers to
// the same candidate, policy, period and finalized block; never to latest balances.
export async function verifyHolderSnapshotPage({provider,candidate,policy,scope:input,period,dueAt,until,now,maxItems=100,progress=null}){
 const {instance,valid}=validateSnapshotRequest({candidate,policy,scope:input,period,dueAt,until,now});
 check(Number.isSafeInteger(maxItems)&&maxItems>=1&&maxItems<=200,'Invalid holder page size');
 const binding=identity({scope:instance,candidateId:valid.id,policyHash:identity(policy),period,dueAt,until});
 let cursor=0,sum=0n,checkpoint;
 if(progress){
  check(progress.schema==='holder-admission-progress-v1'&&progress.binding===binding,'Holder admission progress binding changed');
  check(integer(progress.cursor)&&progress.cursor<=valid.holders.length,'Invalid holder cursor');
  cursor=progress.cursor;sum=uint(progress.sum);checkpoint=progress.block;
  check(sum===valid.holders.slice(0,cursor).reduce((s,h)=>s+uint(h.balance),0n),'Holder progress sum changed');
  check(integer(checkpoint?.number)&&integer(checkpoint.timestamp)&&checkpoint.timestamp>=dueAt&&checkpoint.timestamp<until&&checkpoint.timestamp<=now&&now-checkpoint.timestamp<=policy.maxAgeSeconds,'Stale holder checkpoint');hash(checkpoint.hash);
 }
 let calls=0;const rpc=async(method,args)=>{check(++calls<=maxItems+6,'Holder page RPC budget exceeded');return provider.send(method,args);};
 check(BigInt(await rpc('eth_chainId',[]))===BigInt(instance.chainId),'Wrong snapshot chain');
 const finalized=block(await rpc('eth_getBlockByNumber',['finalized',false]));
 if(!checkpoint){
  checkpoint=finalized;
  check(checkpoint.timestamp>=dueAt&&checkpoint.timestamp<until&&checkpoint.timestamp<=now&&now-checkpoint.timestamp<=policy.maxAgeSeconds,'Finalized snapshot block outside period/freshness');
 }else{
  check(finalized.number>=checkpoint.number,'Snapshot finality regressed');
  check(block(await rpc('eth_getBlockByNumber',[hex(checkpoint.number),false])).hash===checkpoint.hash,'Snapshot reorg between pages');
 }
 const tag=hex(checkpoint.number);
 const call=async(method,args=[])=>abi.decodeFunctionResult(method,await rpc('eth_call',[{to:instance.token,data:abi.encodeFunctionData(method,args)},tag]))[0];
 if(!progress){
  const code=await rpc('eth_getCode',[instance.token,tag]);check(code!=='0x'&&keccak256(code)===policy.tokenCodeHash,'Unreviewed token runtime');
  check(String(await call('totalSupply'))===valid.supply&&uint(valid.supply)>0n,'On-chain supply mismatch');
 }
 const end=Math.min(cursor+maxItems,valid.holders.length);
 for(;cursor<end;cursor++){
  const h=valid.holders[cursor],balance=await call('balanceOf',[h.wallet]);check(String(balance)===h.balance,'Pons balance differs at fixed block');sum+=balance;
 }
 check(block(await rpc('eth_getBlockByNumber',[tag,false])).hash===checkpoint.hash,'Snapshot reorg during verification');
 check(block(await rpc('eth_getBlockByNumber',['finalized',false])).number>=checkpoint.number,'Snapshot finality regressed');
 const next={schema:'holder-admission-progress-v1',binding,block:checkpoint,cursor,sum:String(sum),checkedAt:now};
 let proof=null;
 if(cursor===valid.holders.length){
  check(sum===uint(valid.supply),'Incomplete on-chain holder universe');
  proof={schema:'holder-chain-admission-v1',scopeId:identity(instance),policyHash:identity(policy),candidateId:valid.id,period,dueAt,until,checkedAt:now,block:checkpoint,tokenCodeHash:policy.tokenCodeHash,totalSupply:valid.supply,balancesHash:identity(valid.holders),executionEnabled:false};
  validateSnapshotAdmission(proof,valid,policy,instance);
 }
 return {progress:next,proof,rpcCalls:calls};
}
