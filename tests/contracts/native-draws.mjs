import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {BrowserProvider,ContractFactory,id,keccak256,ZeroAddress} from 'ethers';
import {compileNativePrograms} from '../../src/worker/native-build.mjs';
import {compileProduction} from '../../src/worker/production-build.mjs';
import {compileDrawPrograms} from '../../src/worker/draw-build.mjs';
import {verifyDrawPolicy} from '../../src/worker/draw-policy.mjs';
import {qianqiPreset} from '../../src/draws/config.mjs';
import {compute,QIANQI_RULES} from '../../src/draws/short-outcome.mjs';
import {computeMonthly} from '../../src/draws/monthly-outcome.mjs';
import {nativeDeliveryReady} from '../../src/worker/native-delivery.mjs';
process.env.HARDHAT_CONFIG=resolve('tests/contracts/production-worker-hardhat.config.cjs');
const {default:hre}=await import('hardhat');const provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
const root='.local/test-results/native-draws-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});
const report={status:'FAIL',checks:[],limits:['Isolated EVM 4663, Pons fixtures, no network or real funds','Outcome branches use test seed; BLS adapter unchanged']};
try{
 const build=compileNativePrograms(),f=compileProduction({'tests/contracts/NativeFixtures.sol':{content:readFileSync('tests/contracts/NativeFixtures.sol','utf8')}});
 assert.equal(compileDrawPrograms().manifest.buildHash,'0x2824a5d90a5160f42449e82ad770e57d68c9124dbf99177da396b74dd853f640');
 const signer=await provider.getSigner(0),owner=await signer.getAddress(),publisher=await (await provider.getSigner(2)).getAddress(),team=await (await provider.getSigner(3)).getAddress();
 const tx=async p=>(await p).wait(),deploy=async(a,args=[])=>{const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const prod=(name,args)=>deploy(build.artifacts[name],args),fixture=(name,args=[],file='NativeFixtures')=>deploy(f.contracts['tests/contracts/'+file+'.sol'][name],args);
 const timing={lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30},instance=id('native-draw-fixture');
 const c={};c.hook=await fixture('WorkerHook',[],'WorkerFixtures');c.factory=await fixture('WorkerFactory',[c.hook.target],'WorkerFixtures');c.router=await fixture('WorkerRouter',[c.factory.target],'WorkerFixtures');
 c.escrow=await fixture('NativeEscrowFixture');const receiver=await fixture('NativeRecipientFixture');
 const setup={asset:ZeroAddress,operator:owner,instance,interval:3600,minimumFund:5000000000000000n,minimumUnit:5000000000000000n};
 c.short=await prod('ShortProgram',[setup,[1],timing]);c.shortAdapter={target:await c.short.randomness()};
 c.fundingRouter=await prod('DrawFundingRouter',[ZeroAddress,c.short.target,ZeroAddress,10000]);
 c.splitter=await prod('FeeSplitter',[ZeroAddress,c.fundingRouter.target,team,receiver.target,[8000,1500,500]]);
 c.collector=await prod('PonsFeeCollector',[ZeroAddress,c.escrow.target,c.splitter.target,c.factory.target]);
 c.token=await fixture('TestUSDG',[],'Fixtures');c.curve=await fixture('NativeCurveFixture',[c.token.target,c.factory.target,c.collector.target,c.escrow.target]);
 await tx(c.factory.setLaunch([c.token.target,c.curve.target,owner,c.collector.target,ZeroAddress,4200000,3000,60,300,false,0,0,0,0,true]));await tx(c.collector.bind(c.token.target));
 c.recognition=await prod('PurchaseRecognition',[instance,publisher]);const anchor=await provider.getBlock('latest');
 const config={...qianqiPreset(),version:4,asset:'ETH',ticketPurchase:'0.001',fees:{prizesBps:8000,teamBps:1500,operationsBps:500},allocation:{shortBps:10000},short:{enabled:true,intervalSeconds:3600,minimumFund:'0.005',basket:{weights:[1],minimumUnit:'0.005'}},monthly:{enabled:false,intervalSeconds:2592000,minimumFund:'0.005',nextReserve:'0.005',winnerCount:1}};
 const policy={schema:'draw-production-policy-v2',purchaseAccounting:'pons-api-v1',chainId:4663,projectId:'a5897d1a-def5-4c9f-a7bb-a76f2b16519e',executor:owner,publisher,buildHash:build.manifest.buildHash,anchor:{number:anchor.number,hash:anchor.hash},contracts:Object.fromEntries(await Promise.all(Object.entries(c).map(async([k,v])=>[k,{address:v.target,codeHash:keccak256(await provider.getCode(v.target))}]))),limits:{maxGasPrice:'100000000000',maxGasLimit:'15000000',nativeFloor:'1000'},timing,template:{schema:'draw-template-v2',instanceId:instance,config,team,operations:receiver.target,creatorTaxBps:300}};
 await verifyDrawPolicy(provider,policy);report.checks.push('native policy bindings and unchanged legacy build');
 await tx(c.curve.recordFees({value:1000000000000000000n}));await tx(c.collector.sweepCurve());assert.equal(await c.escrow.balanceOf(c.collector.target),1000000000000000000n);
 await tx(c.collector.collect());await tx(c.collector.forward());assert.equal(await c.splitter.totalReceived(),1000000000000000000n);
 await tx(receiver.configure(true,ZeroAddress,'0x'));assert.equal(await nativeDeliveryReady(c.splitter,'deliver',[2],15000000n),false);await assert.rejects(c.splitter.deliver(2));assert.equal(await c.splitter.credit(2),50000000000000000n);
 const before=await provider.getBalance(team);await tx(c.splitter.deliver(1));assert.equal(await provider.getBalance(team)-before,150000000000000000n);
 await tx(c.splitter.deliver(0));await tx(c.fundingRouter.deliver(0));assert.equal(await c.short.freeFund(),800000000000000000n);
 await tx(receiver.configure(false,c.splitter.target,c.splitter.interface.encodeFunctionData('deliver',[2])));await tx(c.splitter.deliver(2));assert.equal(await c.splitter.credit(2),0n);
 await assert.rejects(c.short.fund(1,{value:2}));await assert.rejects(c.fundingRouter.fund(1));await assert.rejects(c.splitter.fund(1,{value:0}));
 report.checks.push('native escrow -> collector -> split -> draw, failed recipient isolation, reentry and amount/value mismatch');
 const h=await fixture('NativeShortHarness',[{...setup,interval:1},[1],timing]);await tx(h.fund(10000000000000000n,{value:10000000000000000n}));
 const people=[{wallet:receiver.target,firstAttempt:1,lastAttempt:1}];
 for(const winning of [false,true]){
  const ready=Number(await h.lastTerminal())+Number(await h.interval());
  const latest=await provider.getBlock('latest');
  if(latest.timestamp<=ready){await hre.network.provider.send('evm_setNextBlockTimestamp',[ready+1]);await hre.network.provider.send('evm_mine');}
  const b=await provider.getBlock('latest');await tx(h.freeze(people,{number:b.number,blockHash:b.hash,timestamp:b.timestamp,ledgerHash:id('native-ledger'+b.number)}));
  const cycle=await h.cycle(),d=await h.draws(cycle);let seed;
  for(let i=0;i<1000;i++){seed=id('native-seed'+i);if((compute(d.context,seed,people,QIANQI_RULES,[d.budget]).winners.length>0)===winning)break;if(i===999)throw Error('No outcome vector');}
  await tx(h.testSeed(seed));await tx(h.settle(people));
  if(!winning){assert.equal(await h.freeFund(),10000000000000000n);assert.equal(await h.liabilities(),0n);}
  else{
   await tx(receiver.configure(true,ZeroAddress,'0x'));await assert.rejects(h.claim(cycle,receiver.target));assert.equal(await h.liabilities(),10000000000000000n);
   await tx(receiver.configure(false,h.target,h.interface.encodeFunctionData('claim',[cycle,receiver.target])));const balance=await provider.getBalance(receiver.target);await tx(h.claim(cycle,receiver.target));assert.equal(await provider.getBalance(receiver.target)-balance,10000000000000000n);assert.equal(await h.liabilities(),0n);await assert.rejects(h.claim(cycle,receiver.target));
  }
  people[0].firstAttempt++;people[0].lastAttempt++;
 }
 report.checks.push('no-winner carry, winner native payout, failed claim preserves debt, reentry rejected, no double claim');
 for(const winning of [false,true]){
  const m=await fixture('NativeMonthlyHarness',[{asset:ZeroAddress,operator:owner,instance:id('monthly-native-'+winning),minimumFund:5n,nextTarget:3n},timing]);
  await tx(m.fund(21n,{value:21n}));assert.equal(await m.freeNext(),3n);assert.equal(await m.freeFund(),18n);
  await hre.network.provider.send('evm_setNextBlockTimestamp',[Number(await m.lastTerminal())+2592001]);await hre.network.provider.send('evm_mine');
  const b=await provider.getBlock('latest'),p=[{wallet:receiver.target,firstAttempt:1,lastAttempt:1}];
  await tx(m.freeze(p,{number:b.number,blockHash:b.hash,timestamp:b.timestamp,ledgerHash:id('monthly-ledger')}));
  const d=await m.draws(1);let seed;
  for(let i=0;i<1000;i++){seed=id('monthly-native-seed'+i);if((computeMonthly(d.context,seed,p,d.budget).awarded>0n)===winning)break;if(i===999)throw Error('No monthly vector');}
  await tx(m.fund(3n,{value:3n}));await tx(m.testSeed(seed));await tx(m.settle(p));
  assert.equal(await m.freeNext(),winning?0n:3n);assert.equal(await m.freeFund(),winning?6n:21n);
  if(winning){await tx(receiver.configure(true,ZeroAddress,'0x'));await assert.rejects(m.claim(1,receiver.target));assert.equal(await m.liabilities(),18n);
   await tx(receiver.configure(false,m.target,m.interface.encodeFunctionData('claim',[1,receiver.target])));const before=await provider.getBalance(receiver.target);await tx(m.claim(1,receiver.target));assert.equal(await provider.getBalance(receiver.target)-before,18n);assert.equal(await m.liabilities(),0n);await assert.rejects(m.claim(1,receiver.target));}
  assert.equal(await m.solvent(),true);
 }
 report.checks.push('native Monthly Next cap, pending funding, carry and winner reserve rollover, failed/reentrant/double claim');
 report.status='PASS';console.log('PASS '+report.checks.join('; '));
}finally{writeFileSync(root+'/report.json',JSON.stringify(report,null,2));console.log(root+'/report.json');provider.destroy();}
