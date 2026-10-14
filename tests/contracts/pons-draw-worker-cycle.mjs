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
import {buildDrawSnapshot} from '../../server/short-runtime/draw-projection.mjs';
import {snapshotPonsTickets} from '../../src/tickets/pons-accounting.mjs';
import {DEFERRED} from '../../src/tickets/deferred-recognition.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {GENESIS,PERIOD} from '../../src/randomness/drand.mjs';
import {rpcMeter} from './rpc-meter.mjs';
import {createPonsDrawService} from '../../server/shared/pons-draw-service.mjs';
import {runPonsRuntime} from '../../server/shared/pons-runtime.mjs';
import rpcBudget from '../../server/shared/rpc-budget.cjs';
import {createServer} from 'node:http';
const vector=JSON.parse(readFileSync('vendor/qianqi/research/drand-feasibility/vector.json')),preceding=JSON.parse(readFileSync('tests/fixtures/production-pre-freeze-beacon.json'));
const time=GENESIS+(vector.beacon.round-1)*PERIOD;
process.env.PRODUCTION_TEST_START=new Date((time-2592000-100000)*1000).toISOString();process.env.HARDHAT_CONFIG=resolve('tests/contracts/production-worker-hardhat.config.cjs');
const {default:hre}=await import('hardhat');const base=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});base.pollingInterval=10;let clock,finality;
const meter=rpcMeter(hre.network.provider),rpcPasses=[];
const provider=new Proxy(base,{get(t,k){if(k==='getBlock')return n=>t.getBlock(n==='finalized'?(finality??'latest'):n);if(k==='broadcastTransaction')return async raw=>{await hre.network.provider.send('evm_setNextBlockTimestamp',[clock]);return t.broadcastTransaction(raw);};if(k==='getLogs')return()=>{throw Error('Pons rehearsal must not scan logs');};if(k==='send')return(method,args)=>{if(method.startsWith('debug_')||method==='eth_getLogs')throw Error('Forbidden purchase RPC '+method);return t.send(method,args);};const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
const root='.local/test-results/pons-draw-worker-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});const report={scenarios:[],limits:['Modeled Pons/chain4663/finality; no public sends','Historical BLS vector, not future-seed secrecy test','Shared host with fixture bootstrap; no deployed service or UI']};let db;
const budgetOptions={file:resolve(root,'rpc-budget.json'),maxRequests:1000000,windowMs:86400000,intervalMs:0};await rpcBudget.initializeBudget(budgetOptions.file,budgetOptions);
const bridge=createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 const q=JSON.parse(body);res.setHeader('content-type','application/json');
 try{
  if(q.method.startsWith('debug_')||q.method==='eth_getLogs')throw Error('Forbidden Pons RPC');
  const args=structuredClone(q.params);
  if(q.method==='eth_getBlockByNumber'&&args[0]==='finalized')args[0]=finality===undefined?'latest':typeof finality==='number'?'0x'+finality.toString(16):finality;
  if(q.method==='eth_sendRawTransaction')await hre.network.provider.send('evm_setNextBlockTimestamp',[clock]);
  res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result:await hre.network.provider.send(q.method,args)}));
 }catch(e){res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:e.message}}));}
});await new Promise(r=>bridge.listen(0,'127.0.0.1',r));
const hostPass=async p=>{
 let result;
 await runPonsRuntime({mode:'rehearsal',lockFile:resolve(root,'host.lock'),healthFile:resolve(root,'health.json'),rpcBudget:budgetOptions,once:true,failFast:true,prepare:async({provider:makeProvider})=>{
  const gated=makeProvider('http://127.0.0.1:'+bridge.address().port);gated.pollingInterval=10;
  const input={...p,provider:gated,signer:p.signer.connect(gated),publisher:p.publisher.connect(gated)};
  return {projects:[{id:p.projectId,adapter:'draw-v2',input,publish:async r=>{result=r;}}]};
 }});return result;
};
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
 for(const [i,bps] of (process.argv.includes('--dual-only')?[5000]:[10000,0,5000]).entries()){
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
  const policy={schema:'draw-production-policy-v2',purchaseAccounting:DEFERRED,chainId:4663,projectId,executor:signer.address,publisher:publisher.address,buildHash:build.manifest.buildHash,anchor:{number:anchor.number,hash:anchor.hash},contracts:{},limits:{maxGasPrice:'100000000000',maxGasLimit:'15000000',nativeFloor:'100000'},timing,template:{schema:'draw-template-v2',instanceId:instance,config,team:wallet(15).address,operations:wallet(16).address,creatorTaxBps:200}};
  for(const [role,obj] of Object.entries(c))policy.contracts[role]={address:obj.target,codeHash:keccak256(await provider.getCode(obj.target))};
  await withOwnerLaunch({pool:db.pools.executor,projectId,owner},async({save})=>{const s={schema:'owner-launch-v2',stage:'deployed',history:[{hash:c.recognition.deploymentTransaction().hash,blockNumber:anchor.number,blockHash:anchor.hash}],input:{id:projectId,slug:'worker-'+i,draft:{name:'Worker '+i}},roles:{executor:signer.address,publisher:publisher.address},identity:digest({projectId}),policy,launch:{token:c.token.target}};await save(s);await save(s);});
  const handoff={pool:db.pools.executor,adminPool:db.admin,provider,projectId,owner};
  // adminPool needs a leased client; use isolated admin connection adapter without closing it.
  handoff.adminPool={connect:async()=>({query:(...a)=>db.admin.query(...a),release:()=>{}})};
  assert.equal((await registerDeployedDraw(handoff)).enabled,false);assert.equal((await registerDeployedDraw(handoff)).enabled,false);
  projects.push({pool:db.pools.executor,provider,signer,publisher,projectId,moduleId:projectId,policy,c,now:()=>clock,getLatestBeacon:async()=>preceding,getBeacon:async round=>{assert.equal(round,vector.beacon.round);return vector.beacon;}});
 }
 const state=async p=>JSON.parse((await db.admin.query('SELECT state_text FROM launchpad.production_senders WHERE project_id=$1',[p.projectId])).rows[0].state_text);
 const pass=async p=>{const m=await meter.measure(()=>hostPass(p));rpcPasses.push({status:m.result.status,action:m.result.action??null,methods:m.methods,total:m.total});return m.result;},until=async(p,predicate,max=50)=>{for(let i=0;i<max;i++){if(await predicate())return;const r=await pass(p);if(r.status==='blocked')throw Error(JSON.stringify(r));}assert.ok(await predicate(),'Worker condition not reached');};
 const move=async t=>{clock=t;await hre.network.provider.send('evm_setNextBlockTimestamp',[t]);await hre.network.provider.send('evm_mine');};
 const buy=async(p,n)=>{const b=await base.getSigner(8);await tx(quote.mint(await b.getAddress(),n));await tx(quote.connect(b).approve(p.c.curve.target,n));await tx(p.c.curve.connect(b).buy(n,0,await b.getAddress()));};

 for(const p of projects){
  p.apiRows=[];
  p.ponsRehearsal={load:async()=>({schema:'pons-purchase-accounting-v1',source:'Pons API',status:'current',error:null,reviewCount:0,checkedAt:clock,
   profile:{project:p.projectId,token:p.c.token.target,quote:quote.target,decimals:6,threshold:'10',excludedWallets:[],venues:['curve']},
   tradeCount:p.apiRows.length,activity:structuredClone(p.apiRows)})};
 }
 const apiBuy=async(p,n)=>{
  const buyer=await base.getSigner(8),address=(await buyer.getAddress()).toLowerCase();
  await tx(quote.mint(address,n));await tx(quote.connect(buyer).approve(p.c.curve.target,n));
  const receipt=await tx(p.c.curve.connect(buyer).buy(n,0,address));
  const block=await base.getBlock(receipt.blockNumber);const hash=receipt.hash.toLowerCase();
  p.apiRows.push({id:hash+':0',txHash:hash,trader:address,quoteRaw:String(n),timestamp:block.timestamp,side:'buy',venue:'curve',decision:'purchase'});
 };
 await scenario('Pons source: three modes, no event scan, no traces, no recognition transaction',async()=>{
  for(const p of projects)await apiBuy(p,400000000n);await move(time-timing.lead-61);
  for(const p of projects)await until(p,async()=>{const s=await state(p);return s.runtime?.ponsAccounting&&await p.c.fundingRouter.totalReceived()===6400000n&&await p.c.fundingRouter.credit(0)===0n&&await p.c.fundingRouter.credit(1)===0n&&await p.c.splitter.credit(1)===0n&&await p.c.splitter.credit(2)===0n;});
  for(const p of projects){const s=await state(p);assert.equal(s.runtime.publisher.history.length,0);assert.equal(s.runtime.ledger.events.length,0);}
 });
 await scenario('Pons freeze and persisted signed-intent restart',async()=>{
  await move(time-timing.lead-1);const p=projects[0];let stopped=false;
  await assert.rejects(pass({...p,hook:async phase=>{if(phase==='prepared'){stopped=true;throw Error('restart');}}}));assert.ok(stopped);
  const hash=(await state(p)).pending.hash;await pass(p);assert.equal((await state(p)).history.at(-1).hash,hash);
  for(const p of projects)for(const k of ['short','monthly'])if(p.c[k])await until(p,async()=>await p.c[k].cycle()===1n);
 });
 await scenario('Late Pons purchase preserves frozen sets and projects reserved tickets',async()=>{
  const p=projects.at(-1),frozen=digest((await state(p)).runtime.cycles);await apiBuy(p,10000000n);clock=(await base.getBlock('latest')).timestamp;
  await until(p,async()=>Object.keys((await state(p)).runtime.ponsAccounting.records).length===2);
  assert.equal(digest((await state(p)).runtime.cycles),frozen);
  const buyer=(await (await base.getSigner(8)).getAddress()).toLowerCase();
  for(const d of (await buildDrawSnapshot({provider,policy:p.policy,state:await state(p)})).draws){
   assert.equal(d.tickets.source,'pons-api-v1');const w=d.walletSnapshot.items[buyer];assert.equal(w.totalIssued,'41');assert.equal(w.reserved,'40');assert.equal(w.available,'1');
  }
 });
 await scenario('Both draw kinds prove, settle, pay and restart without duplicate payouts',async()=>{
  await move(time+30);
  for(const p of projects){
   const availableSource=p.ponsRehearsal;p.ponsRehearsal={load:async()=>{throw Error('Pons offline during settlement');}};
   for(const k of ['short','monthly'])if(p.c[k])await until(p,async()=>(await p.c[k].draws(1)).settled&&await p.c[k].liabilities()===0n);
   p.ponsRehearsal=availableSource;
   await until(p,async()=>await p.c.curve.creatorTaxBalance()===0n&&await p.c.curve.quoteFeeBalance()===0n&&await quote.balanceOf(p.c.collector.target)===0n&&await p.c.escrow.balanceOfToken(p.c.collector.target,quote.target)===0n&&await p.c.splitter.credit(0)===0n&&await p.c.splitter.credit(1)===0n&&await p.c.splitter.credit(2)===0n&&await p.c.fundingRouter.credit(0)===0n&&await p.c.fundingRouter.credit(1)===0n);
   const n=await provider.getTransactionCount(p.signer.address);await pass(p);await pass(p);assert.equal(await provider.getTransactionCount(p.signer.address),n);
  }
  const p=projects.at(-1),s=await state(p),buyer=(await (await base.getSigner(8)).getAddress()).toLowerCase();
  for(const k of ['short','monthly']){const next=await snapshotPonsTickets(p.policy,s.runtime.ponsAccounting,p.c[k]);assert.equal(next.participants.length,1);assert.equal(next.participants[0].firstAttempt,'41');assert.equal(next.participants[0].lastAttempt,'41');}
  const projection=await meter.measure(()=>buildDrawSnapshot({provider,policy:p.policy,state:s}));
  for(const d of projection.result.draws){const w=d.walletSnapshot.items[buyer];assert.equal(w.used,'40');assert.equal(w.reserved,'0');assert.equal(w.available,'1');}
  report.rpc={scope:'Local node calls during completed worker passes; fixture and failed crash pass excluded',passes:rpcPasses,quiet:rpcPasses.at(-1),projection:{methods:projection.methods,total:projection.total}};
  writeFileSync(root+'/public-snapshot.json',JSON.stringify(projection.result,null,2));
  const supervised=createPonsDrawService(p),first=await meter.measure(()=>supervised()),sleeping=await meter.measure(()=>supervised());
  assert.equal(first.result.service.ran,true);assert.equal(sleeping.result.service.ran,false);assert.equal(sleeping.total,0);
  report.rpc.supervisor={initial:first.total,unchangedSource:sleeping.total,nextCheckAt:sleeping.result.service.nextCheckAt};
 });
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.shortMessage||e.message;console.error(e);process.exitCode=1;}
finally{writeFileSync(root+'/report.json',JSON.stringify(report,null,2));console.log(root+'/report.json');await db?.close();base.destroy();meter.restore();bridge.closeAllConnections();await new Promise(r=>bridge.close(r));}
