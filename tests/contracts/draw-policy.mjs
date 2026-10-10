import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {BrowserProvider,ContractFactory,id,keccak256,ZeroAddress} from 'ethers';
import {compileProduction} from '../../src/worker/production-build.mjs';
import {compileDrawPrograms} from '../../src/worker/draw-build.mjs';
import {validateDrawPolicy,verifyDrawPolicy} from '../../src/worker/draw-policy.mjs';
import {validatePolicy} from '../../src/worker/production-policy.mjs';
import {qianqiPreset,amount} from '../../src/draws/config.mjs';
import {upgradeProgramDraft} from '../../src/draws/program-config.mjs';
process.env.HARDHAT_CONFIG=resolve('tests/contracts/production-hardhat.config.cjs');const {default:hre}=await import('hardhat');
const provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
const root='.local/test-results/draw-policy-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});
const report={scenarios:[],limits:['Isolated chain4663 with Pons fixtures','Read-only verification, not signing/deployment UI or worker integration','External Pons code pins provided by policy; not an official deployment allowlist']};
const tx=async p=>(await p).wait();const scenario=async(name,fn)=>{await fn();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);};
try{
 const build=compileDrawPrograms(),fixtures=compileProduction({'tests/contracts/WorkerFixtures.sol':{content:readFileSync('tests/contracts/WorkerFixtures.sol','utf8')}});
 report.buildHash=build.manifest.buildHash;writeFileSync(root+'/manifest.json',JSON.stringify(build.manifest,null,2));
 assert.equal(compileProduction().manifest.buildHash,'0x24fe240da110404159ec3b3695b4b4c1dd6a312f4dabf60e261f7880207c9ad1');
 const signer=await provider.getSigner(0),owner=await signer.getAddress(),publisher=await (await provider.getSigner(1)).getAddress();
 const deploy=async(a,args=[])=>{const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const fixture=(name,args=[],file='WorkerFixtures')=>deploy(fixtures.contracts['tests/contracts/'+file+'.sol'][name],args);
 const prod=(name,args)=>deploy(build.artifacts[name],args);
 const quote=await fixture('TestUSDG',[],'Fixtures'),hook=await fixture('WorkerHook'),factory=await fixture('WorkerFactory',[hook.target]),router=await fixture('WorkerRouter',[factory.target]),escrow=await fixture('WorkerEscrow',[quote.target]);
 const timing={lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30};let dual;
 await scenario('Trusted v2 artifacts and all three complete Pons/funding/program bindings',async()=>{
  for(const [i,bps] of [10000,0,3700].entries()){
   const raw=qianqiPreset();raw.short.enabled=bps>0;raw.monthly.enabled=bps<10000;const config=upgradeProgramDraft(raw,bps),instance=id('v2-'+i);
   const c={quote,hook,factory,router,escrow};
   if(raw.short.enabled){c.short=await prod('ShortProgram',[{asset:quote.target,operator:owner,instance,interval:raw.short.intervalSeconds,minimumFund:amount(raw.short.minimumFund),minimumUnit:amount(raw.short.basket.minimumUnit)},raw.short.basket.weights,timing]);c.shortAdapter={target:await c.short.randomness()};}
   if(raw.monthly.enabled){c.monthly=await prod('MonthlyProgram',[{asset:quote.target,operator:owner,instance,minimumFund:amount(raw.monthly.minimumFund),nextTarget:amount(raw.monthly.nextReserve)},timing]);c.monthlyAdapter={target:await c.monthly.randomness()};}
   c.fundingRouter=await prod('DrawFundingRouter',[quote.target,c.short?.target??ZeroAddress,c.monthly?.target??ZeroAddress,bps]);
   c.splitter=await prod('FeeSplitter',[quote.target,c.fundingRouter.target,owner,publisher,[9000,500,500]]);
   c.collector=await prod('PonsFeeCollector',[quote.target,escrow.target,c.splitter.target,factory.target]);
   c.token=await fixture('TestUSDG',[],'Fixtures');c.curve=await fixture('WorkerCurve',[c.token.target,factory.target,quote.target,c.collector.target,escrow.target]);
   await tx(factory.setLaunch([c.token.target,c.curve.target,owner,c.collector.target,quote.target,4200000,3000,60,200,false,0,0,0,0,true]));await tx(c.collector.bind(c.token.target));
   c.recognition=await prod('PurchaseRecognition',[instance,publisher]);const anchor=await provider.getBlock('latest');
   const p={schema:'draw-production-policy-v2',chainId:4663,projectId:'a5897d1a-def5-4c9f-a7bb-a76f2b16519e',executor:owner,publisher,buildHash:build.manifest.buildHash,anchor:{number:anchor.number,hash:anchor.hash},contracts:{},limits:{maxGasPrice:'100000000000',maxGasLimit:'15000000',nativeFloor:'100000'},timing,template:{schema:'draw-template-v2',instanceId:instance,config,team:owner,operations:publisher,creatorTaxBps:200}};
   for(const [role,contract] of Object.entries(c))p.contracts[role]={address:contract.target,codeHash:keccak256(await provider.getCode(contract.target))};
   const result=await verifyDrawPolicy(provider,p);assert.equal(result.authorizationToSend,false);assert.throws(()=>validatePolicy(p));if(i===2)dual=p;
  }
 });
 await scenario('Wrong build, mode, immutable settings, roles, anchor and code cannot pass',async()=>{
  for(const change of [p=>p.buildHash=id('wrong'),p=>p.template.config.monthly.enabled=false,p=>p.template.config.allocation.shortBps=4000,p=>p.template.instanceId=id('other'),p=>p.template.config.monthly.nextReserve='101',p=>p.template.config.short.basket.weights.pop(),p=>p.template.config.fees={prizesBps:8000,teamBps:1500,operationsBps:500},p=>p.timing.lead=4000,p=>p.template.creatorTaxBps=100,p=>p.executor=p.publisher,p=>p.anchor.hash=id('fork'),p=>p.contracts.monthly.codeHash=id('code'),p=>p.contracts.extra=p.contracts.monthly]){
   const p=structuredClone(dual);change(p);await assert.rejects(verifyDrawPolicy(provider,p));
  }
  const p=structuredClone(dual),address=p.contracts.monthly.address,wrongCode=await provider.getCode(p.contracts.short.address);p.contracts.monthly.codeHash=keccak256(wrongCode);
  const fake=new Proxy(provider,{get(t,k){if(k==='getCode')return async(a,...args)=>a===address?wrongCode:t.getCode(a,...args);const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
  await assert.rejects(verifyDrawPolicy(fake,p),/Untrusted artifact/);
  const wrongChain=new Proxy(provider,{get(t,k){if(k==='getNetwork')return async()=>({chainId:1n});const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});await assert.rejects(verifyDrawPolicy(wrongChain,dual),/Wrong chain/);
 });
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.shortMessage||e.message;console.error(e);process.exitCode=1;}
finally{writeFileSync(root+'/report.json',JSON.stringify(report,null,2));console.log(root+'/report.json');provider.destroy();}
