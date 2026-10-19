import {Contract,ContractFactory,Transaction,getCreateAddress,keccak256,parseEther,ZeroAddress} from 'ethers';
import {withOwnerLaunch,plain,check,same} from './store.mjs';
import {verifyOwnerHistory,ownerFinality} from './confirmation.mjs';
import {compilePwLaunch} from '../../src/launch/pw-build.mjs';
import {preparePlan,simulatePlan,encodeLaunch} from '../../src/pons/plan.mjs';
import {FACTORY,NETWORK} from '../../src/pons/client.mjs';
import {holderFundingInstance} from '../../src/holders/funding-receipt.mjs';
import {identity,uint,address} from '../../src/holders/values.mjs';
import {validatePwProductionProfile,verifyPwProductionEnvironment} from './pw-profile.mjs';

let cachedBuild;
// Keyless coordinator. Public recording/broadcast requires a server-owned switch.
// Local forks retain their original instance binding and durable journal.
export function createPwOwnerCoordinator({pool,provider,profile,preparation,allowPublicTransactions=false}){
 profile=plain(profile);preparation=plain(preparation);
 const production=profile.mode==='production';
 check(typeof allowPublicTransactions==='boolean','Explicit signing switch required');
 check((production||profile.mode==='pw-fork-rehearsal')&&profile.executionEnabled===false,'PW profile required');
 check(preparation.executionEnabled===false&&preparation.quoteAsset==='ETH'&&preparation.creatorTaxBps===300,'PW preparation required');
 check(identity(preparation.feeSplitBps)===identity({holders:6000,draw:2000,operations:2000})&&!preparation.buyback.enabled&&!preparation.burn.enabled,'PW fee policy changed');
 check(preparation.draw.intervalSeconds===2592000&&preparation.holders.intervalSeconds===2592000&&identity(preparation.draw.prizeWeights)===identity([1]),'PW periods changed');
 const owner=address(profile.owner),roles={executor:address(profile.executor),publisher:address(profile.publisher)};
 check(new Set([owner,...Object.values(roles)]).size===3&&![owner,...Object.values(roles)].includes(ZeroAddress),'Separate owner/executor/publisher required');
 for(const field of ['maxGasLimit','maxFeePerGas','totalNativeLimit'])check(uint(profile[field])>0n,'Explicit launch budget required');
 const build=cachedBuild??=compilePwLaunch(),a=build.artifacts;
 if(production)validatePwProductionProfile(profile,build.manifest.buildHash);
 const binding=identity({profile,preparation,build:build.manifest.buildHash});
 async function environment(){
  check(Number((await provider.getNetwork()).chainId)===4663,'Wrong chain');
  if(production)await verifyPwProductionEnvironment(provider,profile,build.manifest.buildHash);
  else{const meta=await provider.send('hardhat_metadata',[]);
   check(meta.instanceId===profile.instanceId&&Number(meta.forkedNetwork?.chainId)===4663,'Wrong fork instance');}
  const head=await provider.getBlock('latest');
  for(const role of ['factory','router','escrow','hook','launchDeployer']){const pin=profile.externals[role];check(pin&&keccak256(await provider.getCode(pin.address,head.number))===pin.codeHash,'External runtime changed: '+role);}
  check(same(profile.externals.factory.address,NETWORK.factory)&&same(profile.externals.router.address,NETWORK.router),'Pons endpoint changed');
  const factory=new Contract(NETWORK.factory,FACTORY,provider),opts={blockTag:head.number};
  for(const [method,role] of [['launchDeployer','launchDeployer'],['feeEscrow','escrow'],['memeHook','hook'],['launchForwarder','router']])check(same(await factory[method](opts),profile.externals[role].address),'Pons binding changed: '+role);
  for(const role of [owner,...Object.values(roles)])check(await provider.getCode(role,head.number)==='0x','Working roles must be EOA');
  return head;
 }
 function lock(id,run){return withOwnerLaunch({pool,projectId:id,owner},run);}
 function stateCheck(s){check(s?.schema==='pw-owner-launch-v1'&&s.binding===binding,'PW journal/profile mismatch');}
 async function history(s){stateCheck(s);await environment();await verifyOwnerHistory(provider,s.history);
  for(const pin of Object.values(s.contracts))check(keccak256(await provider.getCode(pin.address))===pin.codeHash,'Deployed runtime changed');
 }
 const c=(target,name)=>new Contract(target,a[name].abi,provider);
 async function finish(s){
  const p=s.addresses,vault=c(p.vault,'ManagedNativeHolderPayoutVault'),split=c(p.splitter,'NativeHolderFeeSplitter'),collector=c(p.collector,'NativeHolderCollector'),draw=c(p.draw,'PwNativeShortProgram');
  const launch=await new Contract(NETWORK.factory,FACTORY,provider).getLaunchedToken(s.scope.token);
  check(launch.exists&&same(launch.curve,s.curve)&&same(launch.creatorFeeRecipient,p.collector)&&same(launch.pairToken,ZeroAddress)&&!launch.buybackEnabled&&launch.creatorTaxBps===300n,'Launch record changed');
  check(await vault.instance()===s.instance&&same(await vault.owner(),owner)&&same(await vault.publisher(),roles.publisher)&&same(await vault.source(),p.splitter)&&String(await vault.minimumPayment())===preparation.holders.minimumPaymentRaw,'Vault binding changed');
  check(same(await split.source(),p.collector)&&same(await split.holderFund(),p.vault)&&same(await split.drawFund(),p.draw)&&same(await split.project(),profile.project)&&await split.instance()===s.instance,'Splitter binding changed');
  check(same(await collector.token(),s.scope.token)&&same(await collector.curve(),s.curve)&&same(await collector.destination(),p.splitter),'Collector binding changed');
  check(await draw.launchBound()&&same(await draw.operator(),roles.executor)&&await draw.instanceId()===s.instance,'Draw binding changed');
  const launchStep=s.history.find(h=>h.kind==='launch'),launchedAt=(await provider.getBlock(launchStep.blockNumber)).timestamp;
  check(Number(await draw.launchAt())===launchedAt,'Draw launch clock mismatch');
  s.launchAt=launchedAt;s.finality=await ownerFinality(provider,s.history);s.stage=s.finality.ready?'deployed':'awaiting-finality';
 }
 return {
  info(){return {mode:profile.mode,profileHash:identity(profile),preparationHash:identity(preparation),buildHash:build.manifest.buildHash,signingEnabled:!production||allowPublicTransactions,executionEnabled:false};},
  async inspect(id){return lock(id,async({state})=>{if(state)stateCheck(state);return state;});},
  async prepare(input){return lock(input.id,async({state,save})=>{
   if(production)check(input.id===profile.id&&input.draft.name===preparation.name&&typeof input.draft.symbol==='string'&&input.draft.symbol.length>0,'Production project/name/ticker required');
   if(state){stateCheck(state);check(identity(input)===state.inputHash,'Launch input changed');await history(state);return state;}
   check(/^[a-z0-9][a-z0-9-]{1,49}$/.test(input.slug),'Invalid slug');await environment();
   const nonce=await provider.getTransactionCount(owner,'latest');check(nonce===await provider.getTransactionCount(owner,'pending'),'Owner has pending transactions');
   const addresses=Object.fromEntries(['vault','draw','splitter','collector'].map((role,i)=>[role,getCreateAddress({from:owner,nonce:nonce+i})]));
   const draft={...input.draft,pair:ZeroAddress,creatorFee:'3',openingBuy:'0',destination:'wallet',feeWallet:addresses.collector};
   const launchPlan=await simulatePlan(provider,await preparePlan(provider,draft,owner));
   const scope={projectId:input.id,chainId:4663,token:address(launchPlan.token),asset:ZeroAddress},instance=holderFundingInstance(scope);
   const steps=[];
   async function deploy(kind,name,args){const req=await new ContractFactory(a[name].abi,a[name].evm.bytecode.object).getDeployTransaction(...args);steps.push({kind,contract:addresses[kind],request:{to:null,data:req.data,value:'0'}});}
   await deploy('vault','ManagedNativeHolderPayoutVault',[instance,owner,roles.publisher,preparation.holders.minimumPaymentRaw]);
   await deploy('draw','PwNativeShortProgram',[{asset:ZeroAddress,operator:roles.executor,instance,interval:preparation.draw.intervalSeconds,minimumFund:parseEther(preparation.draw.minimumFund),minimumUnit:parseEther(preparation.draw.minimumUnit)},preparation.draw.prizeWeights,profile.timing,NETWORK.factory,scope.token,addresses.collector]);
   await deploy('splitter','NativeHolderFeeSplitter',[instance,addresses.vault,addresses.draw,address(profile.project),[6000,2000,2000]]);
   await deploy('collector','NativeHolderCollector',[profile.externals.escrow.address,addresses.splitter,NETWORK.factory]);
   steps.push({kind:'launch',request:plain(encodeLaunch(launchPlan.input,launchPlan.terms,owner))});
   for(const [kind,role,name,method,args] of [['bindCollector','collector','NativeHolderCollector','bind',[scope.token]],['bindVault','vault','ManagedNativeHolderPayoutVault','bindSource',[addresses.splitter]],['bindSplitter','splitter','NativeHolderFeeSplitter','bindSource',[addresses.collector]],['bindSchedule','draw','PwNativeShortProgram','bindLaunch',[]]])steps.push({kind,request:{to:addresses[role],data:c(addresses[role],name).interface.encodeFunctionData(method,args),value:'0'}});
   steps.forEach((step,i)=>{step.request.nonce=nonce+i;step.request.chainId=4663;});
   const maximum=steps.reduce((sum,s)=>sum+BigInt(s.request.value)+uint(profile.maxGasLimit)*uint(profile.maxFeePerGas),0n);
   check(maximum<=uint(profile.totalNativeLimit)&&await provider.getBalance(owner)>=maximum+uint(profile.nativeFloor??'0'),'Deployment budget insufficient');
   const s=plain({schema:'pw-owner-launch-v1',identity:identity({binding,input,scope,nonce}),binding,input,inputHash:identity(input),roles,scope,instance,addresses,curve:launchPlan.curve,steps,history:[],contracts:{},pending:null,stage:'prepared',executionEnabled:false});await save(s);return s;
  });},
  async read(id){return lock(id,async({state})=>{await history(state);return state;});},
  async quote(id){return lock(id,async({state:s})=>{
   await history(s);check(!s.pending&&!['failed','deployed','awaiting-finality'].includes(s.stage),'Resolve launch before next quote');
   const step=s.steps[s.history.length];check(step,'No next launch step');
   check(await provider.getTransactionCount(owner,'latest')===step.request.nonce&&await provider.getTransactionCount(owner,'pending')===step.request.nonce,'Owner nonce changed');
   const fees=await provider.getFeeData(),maxFee=fees.maxFeePerGas??fees.gasPrice,priority=fees.maxPriorityFeePerGas??0n;
   check(maxFee>0n&&maxFee<=uint(profile.maxFeePerGas)&&priority<=maxFee,'Launch fee exceeds approved budget');
   const request={...step.request,from:owner,type:2,maxFeePerGas:maxFee,maxPriorityFeePerGas:priority};
   const estimate=await provider.estimateGas(request),gasLimit=(estimate*120n+99n)/100n;
   check(gasLimit<=uint(profile.maxGasLimit),'Launch gas exceeds approved budget');
   const maximum=gasLimit*maxFee+BigInt(request.value);
   check(await provider.getBalance(owner)>=maximum+uint(profile.nativeFloor??'0'),'Owner gas reserve insufficient');
   return plain({kind:step.kind,request:{...request,gasLimit},estimatedGas:estimate,maximumNativeCost:maximum,totalNativeLimit:profile.totalNativeLimit,authorizationToSend:false});
  });},
  async record(id,raw){check(!production||allowPublicTransactions,'Public signing is disabled');return lock(id,async({state:s,save})=>{
   await history(s);const tx=Transaction.from(raw);
   if(s.pending){check(s.pending.raw===tx.serialized,'Resolve pending launch transaction first');return s;}
   check(!['failed','deployed'].includes(s.stage),'Launch not writable');
   const step=s.steps[s.history.length];check(step,'No next launch step');const r=step.request;
   check(tx.isSigned()&&same(tx.from,owner)&&Number(tx.chainId)===4663&&tx.nonce===r.nonce&&same(tx.to,r.to??null)&&tx.data===r.data&&tx.value===BigInt(r.value),'Signed launch request mismatch');
   check(tx.type===2&&tx.gasLimit>0n&&tx.gasLimit<=uint(profile.maxGasLimit)&&tx.maxFeePerGas>0n&&tx.maxFeePerGas<=uint(profile.maxFeePerGas)&&tx.maxPriorityFeePerGas<=tx.maxFeePerGas,'Launch gas budget exceeded');
   check(tx.nonce===await provider.getTransactionCount(owner,'latest')&&tx.nonce===await provider.getTransactionCount(owner,'pending'),'Owner nonce changed');
   await provider.call({from:owner,to:tx.to,data:tx.data,value:tx.value,gasLimit:tx.gasLimit});
   s.pending={kind:step.kind,hash:tx.hash,raw:tx.serialized};s.stage='pending';await save(s);return s;
  });},
  async broadcast(id){
   check(!production||allowPublicTransactions,'Public broadcasting is disabled');
   return lock(id,async({state:s})=>{
    await history(s);check(s.pending&&s.stage==='pending','No reserved transaction');
    const found=await provider.getTransaction(s.pending.hash);if(found)return {hash:s.pending.hash,replayed:true};
    const tx=Transaction.from(s.pending.raw);
    check(await provider.getTransactionCount(owner,'latest')===tx.nonce&&await provider.getTransactionCount(owner,'pending')===tx.nonce,'Owner nonce changed; resolve before rebroadcast');
    check(await provider.getBalance(owner)>=tx.value+tx.gasLimit*tx.maxFeePerGas+uint(profile.nativeFloor??'0'),'Owner gas reserve insufficient');
    const sent=await provider.broadcastTransaction(s.pending.raw);check(sent.hash===s.pending.hash,'Broadcast hash mismatch');return {hash:sent.hash,replayed:false};
   });
  },
  async resolve(id){return lock(id,async({state:s,save})=>{
   await history(s);
   if(!s.pending){if(s.history.length===s.steps.length){await finish(s);await save(s);}return s;}
   const receipt=await provider.getTransactionReceipt(s.pending.hash);if(!receipt)return s;
   const block=await provider.getBlock(receipt.blockNumber);check(block.hash===receipt.blockHash&&same(receipt.from,owner),'Launch receipt branch changed');
   const actual=await provider.getTransaction(s.pending.hash),signed=Transaction.from(s.pending.raw);
   check(actual&&actual.hash===signed.hash&&actual.data===signed.data&&actual.nonce===signed.nonce&&actual.value===signed.value&&same(actual.to,signed.to),'Launch receipt request mismatch');
   if(receipt.status!==1){s.stage='failed';await save(s);return s;}
   const step=s.steps[s.history.length];
   if(step.contract){check(same(receipt.contractAddress,step.contract),'Deployment address mismatch');const code=await provider.getCode(step.contract);check(code!=='0x','Missing deployed code');s.contracts[step.kind]={address:step.contract,codeHash:keccak256(code)};}
   if(step.kind==='launch')for(const [role,target] of [['token',s.scope.token],['curve',s.curve]]){const code=await provider.getCode(target);check(code!=='0x','Missing Pons '+role);s.contracts[role]={address:target,codeHash:keccak256(code)};}
   s.history.push({kind:step.kind,hash:receipt.hash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash});s.pending=null;s.stage='prepared';
   if(s.history.length===s.steps.length)await finish(s);await save(s);return s;
  });}
 };
}
