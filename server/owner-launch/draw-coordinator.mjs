import {Contract,ContractFactory,getAddress,getCreateAddress,id,keccak256,ZeroAddress} from 'ethers';
import {withOwnerLaunch,check,plain,same} from './store.mjs';
import {USDG,ESCROW} from '../studio/template.mjs';
import {compileDrawPrograms} from '../../src/worker/draw-build.mjs';
import {validateDrawLaunch as validateLaunch} from '../../src/launch/draw-template.mjs';
import {verifyDrawPolicy} from '../../src/worker/draw-policy.mjs';
import {matchesOwnerTransaction} from './coordinator.mjs';
import {preparePlan,simulatePlan} from '../../src/pons/plan.mjs';
import {NETWORK} from '../../src/pons/client.mjs';
import {verifyLaunch} from '../../src/pons/local-execution.mjs';
import {amount} from '../../src/draws/config.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {validatePolicy} from '../../src/worker/production-policy.mjs';

const BUILD='0x2824a5d90a5160f42449e82ad770e57d68c9124dbf99177da396b74dd853f640';
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const money=value=>typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value);
const labels={short:'Короткий розыгрыш и RNG',monthly:'Месячный розыгрыш и RNG',fundingRouter:'Распределение между розыгрышами',program:'Программа розыгрыша и RNG',splitter:'Распределение комиссий',collector:'Получатель комиссий Pons',recognition:'Подтверждение покупок',executorFunding:'Газ для исполнителя',publisherFunding:'Газ для регистрации покупок',approve:'Разрешение USDG', 'approve-reset':'Сброс прежнего разрешения USDG',launch:'Создание токена на Pons',bind:'Привязка комиссий к токену'};

// Private rehearsal is the only enabled transport. Same artifacts as the 4663
// candidate; no flag in a browser request can activate public mainnet signing.
let trustedBuild;
export function createDrawOwnerCoordinator({pool,adminPool,provider,profile}){
 const build=trustedBuild??=compileDrawPrograms();
 profile=plain(profile);const profileHash=digest(profile);
 check(build.manifest.buildHash===BUILD,'Production artifacts changed');
 const owner=getAddress(profile.owner);check(owner!==ZeroAddress,'Owner required');
 check(new Set([owner,profile.executor,profile.publisher].map(x=>getAddress(x).toLowerCase())).size===3,'Separate owner/executor/publisher required');
 check(profile.mode==='rehearsal'&&typeof profile.instanceId==='string'&&profile.instanceId.length>0,'Rehearsal instance required');
 check(money(profile.totalNativeLimit)&&BigInt(profile.totalNativeLimit)>0n,'Explicit total native budget required');
 for(const k of ['executor','publisher'])check(money(profile.funding?.[k]),'Explicit funding required');
 const roles={quote:USDG,escrow:ESCROW,factory:NETWORK.factory,router:NETWORK.router};
 for(const [k,address] of Object.entries(roles))check(same(profile.externals?.[k]?.address,address),'Unreviewed '+k);
 check(profile.externals.hook&&same(profile.externals.factory.codeHash,NETWORK.factoryHash),'Pinned Pons contracts required');
 validatePolicy({schema:'short-production-policy-v1',chainId:4663,projectId:'00000000-0000-4000-8000-000000000000',executor:profile.executor,publisher:profile.publisher,buildHash:BUILD,anchor:profile.anchor,contracts:profile.externals,timing:profile.timing,limits:profile.limits});
 const artifact=name=>build.artifacts[name];
 async function environment(){
  check((await provider.getNetwork()).chainId===4663n,'Wrong chain');
  const meta=await provider.send('hardhat_metadata',[]);
  check(meta.instanceId===profile.instanceId&&Number(meta.chainId)===4663&&Number(meta.forkedNetwork?.chainId)===4663,'Wrong rehearsal instance');
  check(same((await provider.getBlock(profile.anchor.number))?.hash,profile.anchor.hash),'Environment anchor changed');
  for(const c of Object.values(profile.externals))check(same(keccak256(await provider.getCode(c.address)),c.codeHash),'External runtime changed');
  check(await provider.getCode(owner)==='0x','This owner flow requires an EOA');
 }
 const contract=(address,name)=>new Contract(address,artifact(name).abi,provider);
 const termsIdentity=p=>digest(plain({economics:p.terms.economics,fee:p.terms.fee}));
 function policyFor(s){
  const externals=Object.fromEntries(['quote','escrow','factory','router','hook'].map(k=>[k,profile.externals[k]]));
  return {schema:'draw-production-policy-v2',chainId:4663,projectId:s.input.id,executor:profile.executor,publisher:profile.publisher,buildHash:BUILD,
   anchor:s.launchAnchor,contracts:{...externals,...s.contracts},limits:profile.limits,timing:profile.timing,
   template:{schema:'draw-template-v2',instanceId:id('owner-launch:'+s.input.id),config:s.input.draws,creatorTaxBps:s.creatorTaxBps,team:s.input.team,operations:s.input.operations}};
 }
 async function checkHistory(s){
  for(const step of s.history)check(same((await provider.getBlock(step.blockNumber))?.hash,step.blockHash),'Confirmed deployment branch changed');
  for(const pin of Object.values(s.contracts))check(same(keccak256(await provider.getCode(pin.address)),pin.codeHash),'Deployment runtime changed');
 }
 async function pin(s,role,address){
  const code=await provider.getCode(address);check(code!=='0x','Deployed code missing');s.contracts[role]={address:getAddress(address),codeHash:keccak256(code)};
 }
 async function applyReceipt(s,entry,receipt){
  if(entry.artifact){
   const address=getCreateAddress({from:owner,nonce:entry.request.nonce});check(same(receipt.contractAddress,address),'Deployment address mismatch');
   await pin(s,entry.kind,address);
   if(['short','monthly'].includes(entry.kind))await pin(s,entry.kind+'Adapter',await contract(address,entry.artifact).randomness());
  }
  if(entry.kind==='launch'){
   s.launch=plain(await verifyLaunch(provider,receipt,entry.plan));
   await pin(s,'token',s.launch.token);await pin(s,'curve',s.launch.curve);
   const anchor=await provider.getBlock(receipt.blockNumber-1);s.launchAnchor={number:anchor.number,hash:anchor.hash};
  }
  s.done[entry.kind]=true;
 }
 async function reconcile(s,save){
  const entry=s.pending;if(!entry?.hash)return;
  const tx=await provider.getTransaction(entry.hash);
  if(!tx)return;
  check(matchesOwnerTransaction(tx,entry,owner),'Wallet transaction differs from reserved request');
  const receipt=await provider.getTransactionReceipt(entry.hash);if(!receipt)return;
  check(same((await provider.getBlock(receipt.blockNumber))?.hash,receipt.blockHash),'Receipt branch changed');
  let finalized;try{finalized=await provider.getBlock('finalized');}catch{return;}
  if(!finalized||finalized.number<receipt.blockNumber)return;
  check(same((await provider.getBlock(finalized.number))?.hash,finalized.hash),'Finalized branch changed');
  if(receipt.status!==1){entry.state='reverted';s.stage='blocked';await save(s);return;}
  await applyReceipt(s,entry,receipt);
  s.spent=String(BigInt(s.spent)+BigInt(tx.value)+receipt.gasUsed*receipt.gasPrice);
  s.history.push({kind:entry.kind,hash:entry.hash,nonce:entry.request.nonce,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,requestId:entry.id});
  s.pending=null;s.candidate=null;s.stage='deploying';await save(s);
 }
 async function nextRequest(s){
  const short=s.input.draws.short,fees=s.input.draws.fees,a=k=>s.contracts[k]?.address;
  const monthly=s.input.draws.monthly,instance=id('owner-launch:'+s.input.id);
  const deployments=[
   ...(short.enabled?[['short','ShortProgram',()=>[{asset:USDG,operator:profile.executor,instance,interval:short.intervalSeconds,minimumFund:amount(short.minimumFund),minimumUnit:amount(short.basket.minimumUnit)},short.basket.weights,profile.timing]]]:[]),
   ...(monthly.enabled?[['monthly','MonthlyProgram',()=>[{asset:USDG,operator:profile.executor,instance,minimumFund:amount(monthly.minimumFund),nextTarget:amount(monthly.nextReserve)},profile.timing]]]:[]),
   ['fundingRouter','DrawFundingRouter',()=>[USDG,a('short')??ZeroAddress,a('monthly')??ZeroAddress,s.input.draws.allocation.shortBps]],
   ['splitter','FeeSplitter',()=>[USDG,a('fundingRouter'),s.input.team,s.input.operations,[fees.prizesBps,fees.teamBps,fees.operationsBps]]],
   ['collector','PonsFeeCollector',()=>[USDG,ESCROW,a('splitter'),NETWORK.factory]],
   ['recognition','PurchaseRecognition',()=>[instance,profile.publisher]]];
  for(const [kind,name,args] of deployments)if(!s.done[kind])return {kind,artifact:name,request:await new ContractFactory(artifact(name).abi,artifact(name).evm.bytecode.object).getDeployTransaction(...args())};
  for(const role of ['executor','publisher'])if(BigInt(profile.funding[role])>0n&&!s.done[role+'Funding'])return {kind:role+'Funding',request:{to:profile[role],data:'0x',value:BigInt(profile.funding[role])}};
  if(!s.done.launch){
   const draft={...s.input.draft,feeWallet:a('collector')};
   let plan=await preparePlan(provider,draft,owner);check(termsIdentity(plan)===s.termsIdentity,'Pons economics changed; stop and review launch');
   if(plan.steps.length){const step=plan.steps[0];check(!s.done[step.kind],'Approval changed after confirmation');return {kind:step.kind,request:step};}
   plan=await simulatePlan(provider,plan);return {kind:'launch',request:plan.tx,plan:plain(plan)};
  }
  if(!s.done.bind)return {kind:'bind',request:await contract(a('collector'),'PonsFeeCollector').bind.populateTransaction(s.launch.token)};
  return null;
 }
 async function candidate(s){
  const entry=await nextRequest(s);if(!entry)return null;
  const pending=await provider.getTransactionCount(owner,'pending'),latest=await provider.getTransactionCount(owner,'latest');
  check(pending===latest,'Owner has an unrelated pending transaction');
  const request={to:entry.request.to??null,data:entry.request.data??'0x',value:BigInt(entry.request.value??0),from:owner,chainId:4663,nonce:pending};
  const estimate=await provider.estimateGas(request),gasLimit=(estimate*120n+99n)/100n;
  const gasPrice=(await provider.getFeeData()).gasPrice;check(gasPrice!==null&&gasPrice>0n&&gasPrice<=BigInt(profile.limits.maxGasPrice),'Gas price budget');
  check(gasLimit<=BigInt(profile.limits.maxGasLimit),'Gas limit budget');
  request.gasLimit=gasLimit;request.gasPrice=gasPrice;
  const maximum=request.value+gasLimit*gasPrice;
  check(BigInt(s.spent)+maximum<=BigInt(profile.totalNativeLimit),'Total native budget exhausted');
  check(await provider.getBalance(owner)>=maximum,'Insufficient owner ETH');
  const result=plain({...entry,label:labels[entry.kind],request});result.id=digest({kind:result.kind,request:result.request,build:BUILD,identity:s.identity});return result;
 }
 async function register(s,save){
  const policy=policyFor(s);
  if(s.policy)check(digest(s.policy)===digest(policy),'Deployment policy changed');
  await verifyDrawPolicy(provider,policy);
  s.policy=policy;s.stage='deployed';await save(s);
  // v2 worker registration is deliberately separate; v1 executor rejects this policy.
 }
 function view(s,revision){return plain({id:s.input.id,input:s.input,owner,stage:s.stage,executionEnabled:false,policy:s.policy??null,revision,buildHash:BUILD,instanceId:profile.instanceId,profile:{executor:profile.executor,publisher:profile.publisher,timing:profile.timing,limits:profile.limits,funding:profile.funding,totalNativeLimit:profile.totalNativeLimit},candidate:s.candidate,pending:s.pending,history:s.history,contracts:s.contracts,launch:s.launch,spent:s.spent});}
 async function run(projectId,action,body={}){
  await environment();
  return withOwnerLaunch({pool,projectId,owner},async({state,save,lease,revision})=>{
   let s=state;
   if(!s){
    check(action==='create','Launch journal missing');const input=validateLaunch(body.input);check(input.id===projectId,'Launch ID mismatch');
    const existing=await adminPool.query('SELECT id FROM launchpad.projects WHERE id=$1 OR slug=$2',[projectId,input.slug]);check(!existing.rowCount,'Project already exists; cannot replace a lost journal');
    const used=await adminPool.query('SELECT sender FROM launchpad.production_wallets WHERE chain_id=4663 AND sender=ANY($1::text[])',[[profile.executor,profile.publisher].map(x=>x.toLowerCase())]);check(!used.rowCount,'Executor/publisher already belongs to another project');
    const preflight=await preparePlan(provider,input.draft,owner);
    s={schema:'owner-launch-v2',input,roles:{executor:profile.executor,publisher:profile.publisher},profileHash,identity:digest({input,profileHash,build:BUILD}),termsIdentity:termsIdentity(preflight),creatorTaxBps:preflight.input.params.creatorTaxBps,stage:'deploying',done:{},history:[],contracts:{},spent:'0',candidate:null,pending:null};await save(s);
   }else{
    check(s.schema==='owner-launch-v2'&&s.profileHash===profileHash&&s.identity===digest({input:s.input,profileHash,build:BUILD}),'Launch profile/input changed');
    if(action==='create')check(digest(validateLaunch(body.input))===digest(s.input),'Launch input is immutable');
   }
   await checkHistory(s);await lease();
   if(action==='attach'){
    check(s.pending&&s.pending.id===body.requestId&&s.pending.state!=='reverted'&&hash(body.hash),'No matching pending step');
    const tx=await provider.getTransaction(body.hash);check(matchesOwnerTransaction(tx,s.pending,owner),'Hash does not match reserved transaction');
    check(!s.pending.hash||same(s.pending.hash,body.hash),'A different hash is already recorded');
    s.pending.hash=body.hash;s.pending.state='pending';await save(s);
   }
   await reconcile(s,save);
   if(action==='arm'){
    check(String(body.revision)===String(revision()),'Review changed; refresh first');
    check(!s.pending&&s.candidate?.id===body.requestId,'Step already reserved or review changed');
    const fresh=await candidate(s);check(fresh?.id===s.candidate.id,'Conditions changed; refresh review');
    s.pending={...s.candidate,state:'requesting'};s.candidate=null;s.stage='awaiting-wallet';await save(s);
   }
   if(action==='retry'){
    check(s.pending?.id===body.requestId&&!s.pending.hash&&s.pending.state==='requesting','Only an unresolved request without a hash can be retried');
    check(await provider.getTransactionCount(owner,'latest')===s.pending.request.nonce&&await provider.getTransactionCount(owner,'pending')===s.pending.request.nonce,'Nonce already used; recover the hash');
    // Same exact nonce/request; never create a fresh nonce for an ambiguous send.
   }
   if(!s.pending&&s.stage!=='deployed'){
    s.candidate=await candidate(s);
    if(!s.candidate)await register(s,save);else await save(s);
   }
   return view(s,revision());
  });
 }
 return {run,info:()=>plain({owner,chainId:4663,instanceId:profile.instanceId,mode:'rehearsal',buildHash:BUILD,profile})};
}
