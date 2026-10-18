import {Contract,Interface,keccak256,id} from 'ethers';
import {address,check,hash,identity,scope,uint} from './values.mjs';

const splitterAbi=[
 'event Revenue(bytes32 indexed instance,address indexed source,uint256 amount,uint256 totalReceived)',
 'event Delivered(uint256 indexed lane,address indexed recipient,uint256 amount)',
 'function instance() view returns(bytes32)','function source() view returns(address)',
 'function holderFund() view returns(address)','function drawFund() view returns(address)',
 'function project() view returns(address)','function bps(uint256) view returns(uint16)'
];
const vaultAbi=['event Deposited(bytes32 indexed instance,address indexed source,uint256 amount,uint256 totalReceived)',
 'function instance() view returns(bytes32)','function source() view returns(address)'];
export const holderFundingInstance=input=>id('holder-funding:'+identity(scope(input)));
export function validateFundingPolicy(input,instanceScope){
 const instance=scope(instanceScope);
 check(instance.chainId===4663&&instance.asset==='0x'+'0'.repeat(40),'Native holder funding requires chain 4663');
 check(input?.schema==='holder-funding-observer-v1'&&input.scopeId===identity(instance)&&input.instance===holderFundingInstance(instance),'Funding scope mismatch');
 check(Number.isSafeInteger(input.fromBlock)&&input.fromBlock>=0,'Invalid funding start block');
 for(const role of ['splitter','vault','collector','draw']){address(input[role]?.address);hash(input[role]?.codeHash);}
 address(input.project);
 check(new Set(['splitter','vault','collector','draw'].map(r=>address(input[r].address)).concat(address(input.project))).size===5,'Funding roles overlap');
 return structuredClone(input);
}

// On-demand observation only. Caller supplies a pinned deployment policy, never a signer.
export async function observeHolderFunding({provider,policy,scope:input,txHash,logIndex}){
 const instance=scope(input);validateFundingPolicy(policy,instance);txHash=hash(txHash);
 check(Number.isSafeInteger(logIndex)&&logIndex>=0,'Explicit log index required');
 check(Number((await provider.getNetwork()).chainId)===instance.chainId,'Wrong RPC chain');
 const receipt=await provider.getTransactionReceipt(txHash);
 check(receipt&&receipt.status===1&&receipt.hash.toLowerCase()===txHash,'Missing or failed funding receipt');
 check(receipt.blockNumber>=policy.fromBlock,'Receipt precedes funding deployment');
 const finalized=await provider.getBlock('finalized');
 check(finalized&&finalized.number>=receipt.blockNumber,'Funding receipt not finalized');
 const block=await provider.getBlock(receipt.blockNumber);
 check(block?.hash===receipt.blockHash,'Funding receipt reorg');
 const overrides={blockTag:receipt.blockNumber};
 for(const role of ['splitter','vault','collector','draw']){
  const code=await provider.getCode(policy[role].address,receipt.blockNumber);
  check(code!=='0x'&&keccak256(code)===policy[role].codeHash,'Funding code changed: '+role);
 }
 const split=new Contract(policy.splitter.address,splitterAbi,provider),vault=new Contract(policy.vault.address,vaultAbi,provider);
 const collector=new Contract(policy.collector.address,['function destination() view returns(address)','function quote() view returns(address)'],provider);
 const eq=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
 const comparisons=[
  [await split.instance(overrides),policy.instance],[await vault.instance(overrides),policy.instance],
  [await split.source(overrides),policy.collector.address],[await vault.source(overrides),policy.splitter.address],
  [await split.holderFund(overrides),policy.vault.address],[await split.drawFund(overrides),policy.draw.address],
  [await split.project(overrides),policy.project],[await collector.destination(overrides),policy.splitter.address],
  [await collector.quote(overrides),instance.asset]
 ];
 check(comparisons.every(([a,b])=>eq(a,b)),'Funding contract binding mismatch');
 for(const [lane,bps] of [6000n,2000n,2000n].entries())check(await split.bps(lane,overrides)===bps,'Wrong PW funding split');
 const log=receipt.logs.find(l=>l.index===logIndex);check(log&&!log.removed,'Funding log missing');
 let parsed,type;
 if(eq(log.address,policy.splitter.address)){
  parsed=new Interface(splitterAbi).parseLog(log);check(parsed?.name==='Revenue'&&eq(parsed.args.source,policy.collector.address),'Not collector revenue');type='fee.received';
 }else{
  check(eq(log.address,policy.vault.address),'Wrong funding emitter');parsed=new Interface(vaultAbi).parseLog(log);
  check(parsed?.name==='Deposited'&&eq(parsed.args.source,policy.splitter.address),'Not a holder deposit');type='holder.deposited';
  const deliveries=receipt.logs.filter(l=>eq(l.address,policy.splitter.address)).map(l=>{try{return new Interface(splitterAbi).parseLog(l);}catch{return null;}});
  check(deliveries.some(d=>d?.name==='Delivered'&&d.args.lane===0n&&eq(d.args.recipient,policy.vault.address)&&d.args.amount===parsed.args.amount),'Missing matching holder delivery');
 }
 check(parsed.args.instance===policy.instance&&parsed.args.amount>0n,'Funding event identity/amount');
 // Check again after RPC reads; do not persist a receipt displaced mid-observation.
 check((await provider.getBlock(receipt.blockNumber))?.hash===block.hash,'Funding receipt reorg during observation');
 const receiptId=instance.chainId+':'+txHash+':'+logIndex;
 return {id:'funding:'+receiptId,scopeId:identity(instance),type,amount:String(parsed.args.amount),evidence:{
  mode:'chain-funding-observation-v1',finalized:true,scope:instance,amount:String(parsed.args.amount),receiptId,
  policyHash:identity(policy),txHash,logIndex,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,
  finalityTag:'finalized',totalReceived:String(parsed.args.totalReceived)
 }};
}

// Replay validates stored observation structure/bindings, not a fresh RPC or cryptographic proof.
export function validateFundingObservation(e,policy,input){
 validateFundingPolicy(policy,input);const v=e.evidence;
 check(v?.mode==='chain-funding-observation-v1'&&v.finalized===true&&v.policyHash===identity(policy),'Funding observation policy mismatch');
 check(identity(scope(v.scope))===identity(scope(input))&&v.amount===e.amount,'Funding observation scope/amount');
 hash(v.txHash);hash(v.blockHash);uint(v.totalReceived);
 check(v.finalityTag==='finalized'&&Number.isSafeInteger(v.logIndex)&&v.logIndex>=0&&Number.isSafeInteger(v.blockNumber)&&v.blockNumber>=policy.fromBlock,'Invalid funding checkpoint');
 check(v.receiptId===input.chainId+':'+v.txHash+':'+v.logIndex,'Noncanonical funding receipt identity');
}
