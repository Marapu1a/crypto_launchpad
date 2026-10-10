import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BrowserProvider,Contract,ContractFactory,HDNodeWallet,id,keccak256,ZeroAddress} from 'ethers';
import {compileProduction} from '../../src/worker/production-build.mjs';
import {compileDrawPrograms} from '../../src/worker/draw-build.mjs';
import {qianqiPreset,amount} from '../../src/draws/config.mjs';
import {upgradeProgramDraft} from '../../src/draws/program-config.mjs';
import {createTestPostgres} from './production-postgres.mjs';
import {runDrawWorker,runDrawProjects} from '../../server/shared/draw-worker.mjs';
import {registerDeployedDraw} from '../../server/owner-launch/draw-handoff.mjs';
import {withOwnerLaunch} from '../../server/owner-launch/store.mjs';
import {creditedPurchases,snapshotProductionTickets} from '../../src/tickets/draw-ledger.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {GENESIS,PERIOD} from '../../src/randomness/drand.mjs';
const vector=JSON.parse(readFileSync('vendor/qianqi/research/drand-feasibility/vector.json')),preceding=JSON.parse(readFileSync('tests/fixtures/production-pre-freeze-beacon.json'));
const time=GENESIS+(vector.beacon.round-1)*PERIOD;
process.env.PRODUCTION_TEST_START=new Date((time-2592000-100000)*1000).toISOString();process.env.HARDHAT_CONFIG=resolve('tests/contracts/production-worker-hardhat.config.cjs');
const {default:hre}=await import('hardhat');const base=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});base.pollingInterval=10;let clock,finality;
const provider=new Proxy(base,{get(t,k){if(k==='getBlock')return n=>t.getBlock(n==='finalized'?(finality??'latest'):n);if(k==='broadcastTransaction')return async raw=>{await hre.network.provider.send('evm_setNextBlockTimestamp',[clock]);return t.broadcastTransaction(raw);};const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
const root='.local/test-results/draw-worker-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});const report={scenarios:[],limits:['Modeled Pons/chain4663/finality; no public sends','Historical BLS vector, not future-seed secrecy test','No deployed service or UI; internal worker invoked by harness']};let db;
const scenario=async(name,f)=>{await f();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);};const tx=async p=>(await p).wait();
try{
 const build=compileDrawPrograms(),fixtures=compileProduction({'tests/contracts/WorkerFixtures.sol':{content:readFileSync('tests/contracts/WorkerFixtures.sol','utf8')}});report.buildHash=build.manifest.buildHash;
 const deployer=await base.getSigner(0),owner=await deployer.getAddress();
 const deploy=async(a,args=[])=>{const c=await new ContractFactory(a.abi,a.evm.bytecode.object,deployer).deploy(...args);await c.waitForDeployment();return c;};
 const prod=(name,args)=>deploy(build.artifacts[name],args),fixture=(name,args=[],file='WorkerFixtures')=>deploy(fixtures.contracts['tests/contracts/'+file+'.sol'][name],args);
 const quote=await fixture('TestUSDG',[],'Fixtures'),hook=await fixture('WorkerHook'),factory=await fixture('WorkerFactory',[hook.target]),router=await fixture('WorkerRouter',[factory.target]),escrow=await fixture('WorkerEscrow',[quote.target]);
 db=await createTestPostgres(root+'/postgres');const projects=[];
 const wallet=i=>HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/"+i).connect(provider);
 const timing={lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30};
 for(const [i,bps] of [10000,0,5000].entries()){
  const signer=wallet(1+i*2),publisher=wallet(2+i*2),projectId=randomUUID(),instance=id(projectId);
  const raw=qianqiPreset();raw.short.enabled=bps>0;raw.monthly.enabled=bps<10000;raw.short.minimumFund='1';raw.short.basket={weights:[1],minimumUnit:'1'};raw.monthly.minimumFund='1';raw.monthly.nextReserve='1';raw.ticketPurchase='10';raw.fees={prizesBps:8000,teamBps:1500,operationsBps:500};const config=upgradeProgramDraft(raw,bps);
  const c={quote,hook,factory,router,escrow};
  if(bps>0){c.short=await prod('ShortProgram',[{asset:quote.target,operator:signer.address,instance,interval:raw.short.intervalSeconds,minimumFund:1000000,minimumUnit:1000000},[1],timing]);c.shortAdapter=new Contract(await c.short.randomness(),build.artifacts.ShortDrandAdapter.abi,deployer);}
  if(bps<10000){c.monthly=await prod('MonthlyProgram',[{asset:quote.target,operator:signer.address,instance,minimumFund:1000000,nextTarget:1000000},timing]);c.monthlyAdapter=new Contract(await c.monthly.randomness(),build.artifacts.ShortDrandAdapter.abi,deployer);}
  c.fundingRouter=await prod('DrawFundingRouter',[quote.target,c.short?.target??ZeroAddress,c.monthly?.target??ZeroAddress,bps]);
  c.splitter=await prod('FeeSplitter',[quote.target,c.fundingRouter.target,wallet(15).address,wallet(16).address,[8000,1500,500]]);
  c.collector=await prod('PonsFeeCollector',[quote.target,escrow.target,c.splitter.target,factory.target]);c.token=await fixture('TestUSDG',[],'Fixtures');c.curve=await fixture('WorkerCurve',[c.token.target,factory.target,quote.target,c.collector.target,escrow.target]);
  await tx(factory.setLaunch([c.token.target,c.curve.target,owner,c.collector.target,quote.target,4200000,3000,60,200,false,0,0,0,0,true]));await tx(c.collector.bind(c.token.target));await tx(c.token.mint(c.curve.target,1000000000000n));
  c.recognition=await prod('PurchaseRecognition',[instance,publisher.address]);const anchor=await provider.getBlock('latest');
  const policy={schema:'draw-production-policy-v2',chainId:4663,projectId,executor:signer.address,publisher:publisher.address,buildHash:build.manifest.buildHash,anchor:{number:anchor.number,hash:anchor.hash},contracts:{},limits:{maxGasPrice:'100000000000',maxGasLimit:'15000000',nativeFloor:'100000'},timing,template:{schema:'draw-template-v2',instanceId:instance,config,team:wallet(15).address,operations:wallet(16).address,creatorTaxBps:200}};
  for(const [role,obj] of Object.entries(c))policy.contracts[role]={address:obj.target,codeHash:keccak256(await provider.getCode(obj.target))};
  await withOwnerLaunch({pool:db.pools.executor,projectId,owner},async({save})=>{const s={schema:'owner-launch-v2',stage:'deployed',input:{id:projectId,slug:'worker-'+i,draft:{name:'Worker '+i}},roles:{executor:signer.address,publisher:publisher.address},identity:digest({projectId}),policy,launch:{token:c.token.target}};await save(s);await save(s);});
  const handoff={pool:db.pools.executor,adminPool:db.admin,provider,projectId,owner};
  // adminPool needs a leased client; use isolated admin connection adapter without closing it.
  handoff.adminPool={connect:async()=>({query:(...a)=>db.admin.query(...a),release:()=>{}})};
  assert.equal((await registerDeployedDraw(handoff)).enabled,false);assert.equal((await registerDeployedDraw(handoff)).enabled,false);
  projects.push({pool:db.pools.executor,provider,signer,publisher,projectId,moduleId:projectId,policy,c,now:()=>clock,getLatestBeacon:async()=>preceding,getBeacon:async round=>{assert.equal(round,vector.beacon.round);return vector.beacon;}});
 }
 const state=async p=>JSON.parse((await db.admin.query('SELECT state_text FROM launchpad.production_senders WHERE project_id=$1',[p.projectId])).rows[0].state_text);
 const pass=p=>runDrawWorker(p),until=async(p,predicate,max=50)=>{for(let i=0;i<max;i++){if(await predicate())return;const r=await pass(p);if(r.status==='blocked')throw Error(JSON.stringify(r));}assert.ok(await predicate(),'Worker condition not reached');};
 const move=async t=>{clock=t;await hre.network.provider.send('evm_setNextBlockTimestamp',[t]);await hre.network.provider.send('evm_mine');};
 const buy=async(p,n)=>{const b=await base.getSigner(8);await tx(quote.mint(await b.getAddress(),n));await tx(quote.connect(b).approve(p.c.curve.target,n));await tx(p.c.curve.connect(b).buy(n,0,await b.getAddress()));};
 await scenario('Shared handoff, three fee modes and one recognition ledger per token',async()=>{
  assert.equal((await db.admin.query('SELECT count(*) FROM launchpad.production_wallets')).rows[0].count,'6');
  for(const p of projects)await buy(p,400000000n);await move(time-timing.lead-61);
  for(const p of projects)await until(p,async()=>{const s=await state(p);return s.runtime&&creditedPurchases(p.policy,s.runtime.ledger).length===1&&await p.c.fundingRouter.totalReceived()===6400000n&&await p.c.fundingRouter.credit(0)===0n&&await p.c.fundingRouter.credit(1)===0n&&await p.c.splitter.credit(1)===0n&&await p.c.splitter.credit(2)===0n;});
  assert.equal(await projects[0].c.short.freeFund(),6400000n);assert.equal(await projects[1].c.monthly.freeFund(),5400000n);assert.equal(await projects[2].c.short.freeFund(),3200000n);assert.equal(await projects[2].c.monthly.freeFund(),2200000n);
 });
 await scenario('Restart from saved signed intent, gas wait, independent projects and four frozen cycles',async()=>{
  await move(time-timing.lead-1);const p=projects[0];let stopped=false;
  await assert.rejects(pass({...p,hook:async phase=>{if(phase==='prepared'){stopped=true;throw Error('simulated process interruption');}}}));assert.ok(stopped);const hash=(await state(p)).pending.hash;
  const balance=await provider.getBalance(p.signer.address);await hre.network.provider.send('hardhat_setBalance',[p.signer.address,'0x0']);assert.equal((await pass(p)).reason,'native-balance');
  await until(projects[1],async()=>await projects[1].c.monthly.cycle()===1n);
  await hre.network.provider.send('hardhat_setBalance',[p.signer.address,'0x'+balance.toString(16)]);await pass(p);assert.equal((await state(p)).history.at(-1).hash,hash);
  for(const p of projects)for(const k of ['short','monthly'])if(p.c[k])await until(p,async()=>await p.c[k].cycle()===1n);
  const s=await state(projects[2]);assert.ok(s.runtime.cycles.short['1']);assert.ok(s.runtime.cycles.monthly['1']);assert.notEqual((await projects[2].c.short.draws(1)).context,(await projects[2].c.monthly.draws(1)).context);
 });
 await scenario('Late credits do not rewrite snapshots; both draw outcomes settle and restart without repeat payouts',async()=>{
  const p=projects[2],snap=digest((await state(p)).runtime.cycles);await buy(p,10000000n);clock=(await base.getBlock('latest')).timestamp;
  let held=false;
  await until({...p,hook:async phase=>{if(phase==='prepared'&&(await state(p)).runtime.operation.method==='confirm'){finality=(await base.getBlock('latest')).number;held=true;}}},async()=>held&&Boolean((await state(p)).runtime.publisher.pending));
  assert.equal(creditedPurchases(p.policy,(await state(p)).runtime.ledger).length,1);
  assert.equal((await pass(p)).reason,'receipt-finality');finality=undefined;await pass(p);
  await until(p,async()=>creditedPurchases(p.policy,(await state(p)).runtime.ledger).length===2);assert.equal(digest((await state(p)).runtime.cycles),snap);
  await move(time+30);
  for(const p of projects){for(const k of ['short','monthly'])if(p.c[k])await until(p,async()=>(await p.c[k].draws(1)).settled&&await p.c[k].liabilities()===0n);
   await until(p,async()=>await p.c.curve.creatorTaxBalance()===0n&&await p.c.curve.quoteFeeBalance()===0n&&await quote.balanceOf(p.c.collector.target)===0n&&await p.c.escrow.balanceOfToken(p.c.collector.target,quote.target)===0n&&await p.c.splitter.credit(0)===0n&&await p.c.splitter.credit(1)===0n&&await p.c.splitter.credit(2)===0n&&await p.c.fundingRouter.credit(0)===0n&&await p.c.fundingRouter.credit(1)===0n);
   const n=await provider.getTransactionCount(p.signer.address);await pass(p);await pass(p);assert.equal(await provider.getTransactionCount(p.signer.address),n);
  }
  const s=await state(p);for(const k of ['short','monthly']){const next=await snapshotProductionTickets(p.policy,s.runtime.ledger,p.c[k]);assert.equal(next.participants.length,1);assert.equal(next.participants[0].firstAttempt,'41');assert.equal(next.participants[0].lastAttempt,'41');}
 });
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.shortMessage||e.message;console.error(e);process.exitCode=1;}
finally{writeFileSync(root+'/report.json',JSON.stringify(report,null,2));console.log(root+'/report.json');await db?.close();base.destroy();}
