import {Contract,Interface,Transaction,keccak256} from 'ethers';
import {address,check,hash,identity,scope,uint} from './values.mjs';
import {validatePolicy,finalizedObservation} from '../worker/production-policy.mjs';
import {holderFundingInstance} from './funding-receipt.mjs';
export const payoutAbi=new Interface([
 'function initialOwner() view returns(address)','function initialPublisher() view returns(address)',
 'function owner() view returns(address)','function pendingOwner() view returns(address)','function publicationsPaused() view returns(bool)',
 'function instance() view returns(bytes32)','function source() view returns(address)',
 'function publisher() view returns(address)','function minimumPayment() view returns(uint256)',
 'function totalReceived() view returns(uint256)','function totalAllocated() view returns(uint256)',
 'function totalPaid() view returns(uint256)','function pendingBudget() view returns(uint256)',
 'function available() view returns(uint256)','function lastPeriod() view returns(uint256)',
 'function rounds(uint256) view returns(bytes32 commitment,bytes32 rolling,uint256 budget,uint256 count,uint256 written,uint256 allocated,address lastWallet,bool complete)',
 'function entitlement(uint256,address) view returns(uint256)','function credit(address) view returns(uint256)',
 'function consolidated(uint256,address) view returns(bool)',
 'function openRound(uint256,bytes32,bytes32,uint256,uint256)',
 'function append(uint256,uint256,address[],uint256[])','function seal(uint256)',
 'function consolidate(address,uint256[])','function pay(address,uint256[])',
 'event Paid(address indexed wallet,uint256 amount,uint256 totalPaid)',
 'event RoundSealed(uint256 indexed period,uint256 allocated,uint256 remainder)'
]);
export function validateExecutionPolicy(policy,input){
 const s=scope(input);
 check(s.chainId===4663&&s.asset==='0x'+'0'.repeat(40),'Native execution scope required');
 check(['holder-execution-local-v1','holder-execution-local-v2','holder-execution-production-v1'].includes(policy?.schema)&&policy.executionEnabled===false&&policy.scopeId===identity(s),'Explicit execution policy required');
 check(policy.instance===holderFundingInstance(s),'Execution instance mismatch');
 for(const field of ['vault','publisher','source'])check(address(policy[field])!=='0x'+'0'.repeat(40),'Missing execution role');
 if(policy.schema!=='holder-execution-local-v1')check(address(policy.initialOwner)!=='0x'+'0'.repeat(40)&&address(policy.initialOwner)!==address(policy.publisher),'Separate initial owner required');
 hash(policy.codeHash);check(uint(policy.minimumPayment)>0n&&uint(policy.maxGasLimit)>0n&&uint(policy.maxFeePerGas)>0n,'Explicit positive execution limits required');
 if(policy.schema==='holder-execution-production-v1'){
  check(uint(policy.nativeFloor)>0n,'Explicit execution gas reserve required');
  validatePolicy({schema:'short-production-policy-v1',chainId:s.chainId,projectId:s.projectId,executor:policy.initialOwner,publisher:policy.publisher,buildHash:policy.codeHash,anchor:policy.anchor,contracts:{vault:{address:policy.vault,codeHash:policy.codeHash}},timing:policy.timing,limits:{maxGasLimit:policy.maxGasLimit,maxGasPrice:policy.maxFeePerGas,nativeFloor:policy.nativeFloor}});
 }
 return structuredClone(policy);
}
export async function checkpointExecution(provider,policy,input,at){
 validateExecutionPolicy(policy,input);
 check(Number((await provider.getNetwork()).chainId)===input.chainId,'Wrong execution chain');
 if(policy.schema==='holder-execution-production-v1'){
  const client=await provider.send('web3_clientVersion',[]);check(typeof client==='string'&&!/hardhat|anvil|ganache/i.test(client),'Production execution rejects development node');
  const o=await finalizedObservation(provider),t=policy.timing;
  check(o.finalized.number>=policy.anchor.number&&(await provider.getBlock(policy.anchor.number))?.hash===policy.anchor.hash,'Production execution anchor changed');
  check(o.now-o.latest.timestamp<=t.clockLag&&o.latest.timestamp-o.now<=t.clockAhead&&o.now-o.finalized.timestamp<=t.finalizedLag,'Production execution clock/finality outside policy');
 }
 const finalized=await provider.getBlock('finalized');check(finalized,'Finalized block unavailable');
 const block=at===undefined?finalized:await provider.getBlock(at);
 check(block&&block.number<=finalized.number,'Execution receipt not finalized');
 check(keccak256(await provider.getCode(policy.vault,block.number))===policy.codeHash,'Execution runtime mismatch');
 const vault=new Contract(policy.vault,payoutAbi,provider),opts={blockTag:block.number};
 check(await vault.instance(opts)===policy.instance
  &&address(await vault.source(opts))===address(policy.source)&&String(await vault.minimumPayment(opts))===policy.minimumPayment,'Execution binding mismatch');
 const publisher=address(await vault.publisher(opts));
 let authority={publisher,rotationSupported:false};
 if(policy.schema!=='holder-execution-local-v1'){
  check(address(await vault.initialOwner(opts))===address(policy.initialOwner)&&address(await vault.initialPublisher(opts))===address(policy.publisher),'Execution authority binding mismatch');
  authority={publisher,owner:address(await vault.owner(opts)),pendingOwner:address(await vault.pendingOwner(opts)),publicationsPaused:await vault.publicationsPaused(opts),rotationSupported:true};
 }else check(publisher===address(policy.publisher),'Execution binding mismatch');
 return {vault,block,authority};
}
export async function recheckExecutionBlock(provider,block){
 check((await provider.getBlock('finalized'))?.number>=block.number,'Execution finality regressed');
 check((await provider.getBlock(block.number))?.hash===block.hash,'Execution block reorg');
}
export function executionCall(plan,operation){
 const period=plan.period;
 if(operation.kind==='open')return payoutAbi.encodeFunctionData('openRound',[period,plan.snapshot,plan.commitment,plan.budget,plan.count]);
 if(operation.kind==='append'){
  const {offset,count}=operation;
  check(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(count)&&count>0&&count<=100&&offset+count<=plan.count,'Invalid publication chunk');
  const rows=plan.allocations.slice(offset,offset+count);
  return payoutAbi.encodeFunctionData('append',[period,offset,rows.map(h=>h.wallet),rows.map(h=>h.amount)]);
 }
 if(operation.kind==='seal')return payoutAbi.encodeFunctionData('seal',[period]);
 check(['pay','consolidate'].includes(operation.kind),'Unknown execution operation');
 const wallet=address(operation.wallet),periods=operation.periods;
 check(plan.allocations.some(h=>h.wallet===wallet),'Recipient missing from reference plan');
 check(Array.isArray(periods)&&periods.length<=100&&periods.every((n,i)=>Number.isSafeInteger(n)&&n>0&&(i===0||n>periods[i-1])),'Invalid claim periods');
 return payoutAbi.encodeFunctionData(operation.kind,[wallet,periods]);
}
export function validateSignedExecution(raw,policy,input,plan,operation,expectedPublisher=policy.publisher){
 validateExecutionPolicy(policy,input);const tx=Transaction.from(raw);
 check(tx.isSigned()&&Number(tx.chainId)===input.chainId&&address(tx.to)===address(policy.vault)&&address(tx.from)===address(policy.schema!=='holder-execution-local-v1'?expectedPublisher:policy.publisher),'Signed transaction scope/sender mismatch');
 check(tx.value===0n&&tx.data===executionCall(plan,operation),'Signed transaction payload mismatch');
 check(tx.type===2&&tx.gasLimit>0n&&tx.gasLimit<=uint(policy.maxGasLimit)&&tx.maxFeePerGas>0n&&tx.maxFeePerGas<=uint(policy.maxFeePerGas)&&tx.maxPriorityFeePerGas<=tx.maxFeePerGas,'Signed transaction gas policy mismatch');
 return {raw:tx.serialized,txHash:tx.hash,sender:address(tx.from),nonce:tx.nonce,period:plan.period,operation:structuredClone(operation)};
}
// No signing or broadcasting. Missing/unfinalized receipts remain unresolved.
export async function observeExecution(provider,policy,input,body){
 const receipt=await provider.getTransactionReceipt(body.txHash);
 if(!receipt)return {status:'unknown'};
 const finalized=await provider.getBlock('finalized');
 if(!finalized||receipt.blockNumber>finalized.number)return {status:'unknown'};
 const {block}=await checkpointExecution(provider,policy,input,receipt.blockNumber);
 check(block.hash===receipt.blockHash&&receipt.hash===body.txHash&&address(receipt.to)===address(policy.vault)&&address(receipt.from)===body.sender,'Execution receipt mismatch');
 check(receipt.status===0||receipt.status===1,'Invalid execution receipt status');
 const events=receipt.logs.filter(l=>address(l.address)===address(policy.vault)).map(l=>{try{return payoutAbi.parseLog(l);}catch{return null;}}).filter(Boolean);
 const observation={status:receipt.status===1?'succeeded':'reverted',txHash:body.txHash,block:{number:block.number,hash:block.hash},paid:'0',allocated:'0'};
 if(policy.schema!=='holder-execution-local-v1'){check(Number.isSafeInteger(receipt.index)&&receipt.index>=0,'Missing receipt transaction index');observation.transactionIndex=receipt.index;}
 if(receipt.status===1&&body.operation.kind==='pay'){
  const paid=events.filter(e=>e.name==='Paid');check(paid.length===1&&address(paid[0].args.wallet)===address(body.operation.wallet),'Missing payout evidence');
  observation.paid=String(paid[0].args.amount);
 }
 if(receipt.status===1&&body.operation.kind==='seal'){
  const seals=events.filter(e=>e.name==='RoundSealed');check(seals.length===1&&Number(seals[0].args.period)===body.period,'Missing allocation evidence');
  observation.allocated=String(seals[0].args.allocated);
 }
 await recheckExecutionBlock(provider,block);return observation;
}

// Import only actual Paid events emitted by this pinned vault. The transaction
// may be sent by any sponsor, or call through a batching contract.
export async function observeExternalPayments(provider,policy,input,txHash){
 hash(txHash);const receipt=await provider.getTransactionReceipt(txHash);
 check(receipt&&receipt.status===1&&receipt.hash===txHash,'Successful external receipt required');
 const {block}=await checkpointExecution(provider,policy,input,receipt.blockNumber);
 check(block.hash===receipt.blockHash,'External payment reorg');
 const payments=[];
 for(const log of receipt.logs){
  if(address(log.address)!==address(policy.vault))continue;
  let event;try{event=payoutAbi.parseLog(log);}catch{continue;}
  if(event?.name==='Paid'){
   check(event.args.amount>0n,'Empty external payment');
   payments.push({logIndex:log.index,wallet:address(event.args.wallet),amount:String(event.args.amount),totalPaid:String(event.args.totalPaid)});
  }
 }
 check(payments.length>0&&payments.length<=100,'External payment count outside budget');
 check(new Set(payments.map(p=>p.logIndex)).size===payments.length,'Duplicate external log');
 await recheckExecutionBlock(provider,block);
 return {schema:'holder-external-payments-v1',scopeId:identity(scope(input)),txHash,block:{number:block.number,hash:block.hash},payments,paid:String(payments.reduce((n,p)=>n+uint(p.amount),0n))};
}
