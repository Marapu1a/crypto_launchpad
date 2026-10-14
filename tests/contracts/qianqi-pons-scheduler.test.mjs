import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {ZeroHash,id,keccak256,HDNodeWallet,Transaction} from 'ethers';
import {rpcMeter} from './rpc-meter.mjs';
import {createMigration} from '../../server/adapters/qianqi/pons-migration.mjs';
import {createPonsSchedulerService,createPonsSchedulerSupervisor} from '../../server/adapters/qianqi/pons-service.mjs';
import {buildPonsPublicSnapshot,renderPonsPublic} from '../../server/adapters/qianqi/pons-projection.mjs';
import {savePonsPublic,createPonsPublicReader} from '../../server/adapters/qianqi/pons-public-store.mjs';
import {runPonsRuntime} from '../../server/shared/pons-runtime.mjs';
import rpcBudget from '../../server/shared/rpc-budget.cjs';
const require=createRequire(import.meta.url),base='../../server/adapters/qianqi/runtime/';
process.env.HARDHAT_CONFIG=resolve('tests/contracts/qianqi-pons-hardhat.config.cjs');
const hre=require('hardhat'),{beacon,target}=require(base+'test/fixtures/robinhood-obligations.cjs');
hre.config.networks.hardhat.initialDate=new Date((target-40*86400)*1000).toISOString();
const {setup,rpc,sent}=require(base+'test/fixtures/robinhood-runtime.cjs');
 const {domainFor}=require(base+'scripts/attempt-lifecycle.cjs');
const compiled=require(base+'scripts/compile.cjs').compile();
const root='.local/test-results/qianqi-pons-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});
test('Pons source drives both legacy controllers through freeze, settle, claim and crash recovery',async t=>{
 const f=await setup(t,compiled),c=f.options.schedulerConfig;
 const escrow=await f.deploy('PonsEscrowFixture'),collector=await f.deploy('LocalPonsCollector',[f.owner,f.token.target,f.quote.target,escrow.target]);
 const recipients=[f.vault.target,...f.options.fundingJob.recipients.slice(1)],bps=[9000,500,500];
 await sent(collector.bindPromo([target+86400,recipients,bps]));
 const venue=await f.deploy('PonsVenueFixture');await sent(venue.configure(f.token.target,f.quote.target,collector.target,escrow.target));await sent(collector.bindVenue(venue.target));
 await sent(f.quote.mint(escrow.target,600_000000));await sent(escrow.fund(collector.target,f.quote.target,600_000000));
 await sent(f.quote.mint(venue.target,600_000000));await sent(venue.fund(600_000000));
 const funding={collector:collector.target,escrow:escrow.target,quote:f.quote.target,campaignId:'1',recipients,bps,codeHashes:{collector:keccak256(await f.provider.getCode(collector.target)),escrow:keccak256(await f.provider.getCode(escrow.target))}};
 await rpc('evm_setNextBlockTimestamp',[target-2300]);await rpc('evm_mine');
 const head=await f.provider.getBlock('latest'),wallet=f.owner.toLowerCase();
 const epochs=(kind)=>({currentEpoch:1,drainingEpoch:0,announced:null,epochs:[{epoch:1,firstBlock:Number(c.lifecycle[kind==='SHORT'?'shortRules':'monthlyRules'].firstBlock),rulesHash:kind==='SHORT'?c.lifecycle.shortRules.rulesHash:c.lifecycle.monthlyPolicy.rulesHash}],lastTerminalAt:Number(kind==='SHORT'?c.lifecycle.shortRules.startedAt:c.lifecycle.monthlyPolicy.startedAt)});
 const life={head:{number:head.number,hash:head.hash,timestamp:head.timestamp},pending:{SHORT:null,MONTHLY:null},draws:[],wallets:[],shortRules:epochs('SHORT'),monthlyRules:epochs('MONTHLY')};
 const policy={contracts:{token:{address:c.manifest.token},quote:{address:c.manifest.quote}},template:{config:{ticketPurchase:'100'}}};
 const row=(n,raw)=>({id:id('Pons receipt '+n)+':0',txHash:id('Pons receipt '+n),trader:wallet,quoteRaw:raw,timestamp:head.timestamp,side:'buy',venue:'curve',decision:'purchase'});
 const report={schema:'pons-purchase-accounting-v1',source:'Pons API',status:'current',checkedAt:head.timestamp,error:null,reviewCount:0,profile:{token:c.manifest.token,quote:c.manifest.quote,threshold:'100',decimals:6,venues:['curve'],excludedWallets:[]},activity:[row(1,'400000000')],tradeCount:1};
 const bootstrap=createMigration({policy,report,legacyCredits:[],lifecycle:life,domain:domainFor(c.manifest,c.lifecycle),head:life.head,now:head.timestamp});
 const file=f.directory+'/pons-scheduler.json',state=()=>JSON.parse(readFileSync(file,'utf8'));
 let clock=head.timestamp,crash=false,crashed=false,crashSent=true,sourceDown=false,fundingDown=false,failRawOnce=true,failRngOnce=true,agedCheckpoint=false;
 const options={provider:f.provider,short:f.options.short,monthly:f.options.monthly,executor:HDNodeWallet.fromPhrase('test test test test test test test test test test test junk').connect(f.provider),config:c,rpcUrl:f.options.rpcUrl,statePath:file,bootstrap,funding,deliveryJob:f.options.deliveryJob,getBeacon:beacon,loadReport:async()=>{if(sourceDown)throw Error('Pons offline');return {...report,checkedAt:clock};},now:()=>clock,hook:async(phase,x)=>{
  if(phase==='beforeTransaction'&&['seal','sealMonth'].includes(x.action))await rpc('evm_setNextBlockTimestamp',[target-1801]);
  if(phase==='confirmed'&&crash&&['seal','sealMonth'].includes(x.action)){crash=false;crashed=true;throw Error('simulated process exit after receipt persistence');}
  if(phase==='sent'&&crashSent){crashSent=false;throw Error('simulated process exit after broadcast');}
 }};
 // Neither purchases nor our own publication recovery may scan log ranges.
 const logs=f.provider.getLogs.bind(f.provider),send=f.provider.send.bind(f.provider),windows=[];
 f.provider.getLogs=async()=>{throw Error('Log range scan forbidden');};
 f.provider.send=async(method,args)=>{assert(!method.startsWith('debug_'),'trace forbidden');return send(method,args);};
 const originalFetch=globalThis.fetch,originalNow=Date.now;
 globalThis.fetch=async url=>{assert(String(url).startsWith('https://api.drand.sh/'));return {ok:true,json:async()=>JSON.parse(readFileSync('tests/fixtures/qianqi-pre-freeze-beacon.json','utf8'))};};
 t.after(()=>{globalThis.fetch=originalFetch;Date.now=originalNow;f.provider.destroy();});
 const meter=rpcMeter(hre.network.provider),measurements=[];t.after(()=>meter.restore());
 const runPonsScheduler=createPonsSchedulerService({random:()=>0});
 const budgetOptions={file:resolve(root,'rpc-budget.json'),maxRequests:1000000,windowMs:86400000,intervalMs:0};await rpcBudget.initializeBudget(budgetOptions.file,budgetOptions);
 const pass=async()=>{clock=(await f.provider.getBlock('latest')).timestamp;Date.now=()=>clock*1000;try{const m=await meter.measure(async()=>{
  let result;
  await runPonsRuntime({mode:'rehearsal',lockFile:resolve(root,'host.lock'),healthFile:resolve(root,'health.json'),rpcBudget:budgetOptions,once:true,failFast:true,prepare:async({provider:makeProvider})=>{
   const gated=makeProvider(options.rpcUrl);gated.pollingInterval=10;
   const transport=gated._send.bind(gated);gated._send=async payload=>{
    if(payload.method==='eth_sendRawTransaction'&&failRawOnce){failRawOnce=false;throw Object.assign(Error('simulated RPC budget exhausted'),{code:'RPC_BUDGET_EXHAUSTED'});}
    if(payload.method==='eth_sendRawTransaction'&&sourceDown&&failRngOnce&&Transaction.from(payload.params[0]).to.toLowerCase()===options.deliveryJob.adapter.toLowerCase()){failRngOnce=false;throw Object.assign(Error('RNG RPC budget exhausted'),{code:'RPC_BUDGET_EXHAUSTED'});}
    if(fundingDown&&payload.method==='eth_getCode'&&payload.params[0].toLowerCase()===collector.target.toLowerCase())throw Error('Funding read unavailable');
    return transport(payload);
   };
   const input={...options,provider:gated,executor:HDNodeWallet.fromPhrase('test test test test test test test test test test test junk').connect(gated),short:options.short.connect(gated),monthly:options.monthly.connect(gated)};
   return {projects:[{id:'qianqi',adapter:'qianqi',input,publish:async r=>{result=r;}}]};
  }});return result;
 });assert(m.result);measurements.push({status:m.result.status,action:m.result.action??null,methods:m.methods,total:m.total});
 if(!agedCheckpoint&&m.result.action==='checkpointCutoff'){await rpc('hardhat_mine',['0x12c']);agedCheckpoint=true;}
 return m.result;}finally{Date.now=originalNow;}};
 await assert.rejects(pass(),/simulated RPC budget exhausted/);assert(state().pending.signedTransaction);
 const savedRawHash=state().pending.transactionHash;assert.equal(await f.provider.getTransaction(savedRawHash),null);
 await assert.rejects(pass(),/simulated process exit after broadcast/);assert(state().pending.transactionHash);assert(state().migration.controllerReceipts[savedRawHash]);
 const sentHash=state().pending.transactionHash;
 for(let n=0;n<20;n++){await pass();if(state().jobs.SHORT.length&&state().jobs.MONTHLY.length&&await f.short.activeProposal()!==ZeroHash&&await f.monthly.activeMonth()!==ZeroHash&&Number((await f.short.datasetProposal(state().jobs.SHORT[0].job.proposalId)).status)===2&&Number((await f.monthly.month(state().jobs.MONTHLY[0].job.artifact.request.drawId)).phase)===2)break;}
 assert(state().migration.controllerReceipts[sentHash]);
 assert.equal(await escrow.balanceOfToken(collector.target,f.quote.target),0n);
 assert.equal(await venue.quoteFeeBalance(),0n);
 assert.equal(await f.quote.balanceOf(recipients[1]),60_000000n);assert.equal(await f.quote.balanceOf(recipients[2]),60_000000n);
 assert.equal(await collector.received(1),1200_000000n);assert.equal(await collector.accounted(),0n);
 assert.equal(await f.vault.freeShort(),540_000000n);assert.equal(await f.vault.freeCurrent(),440_000000n);assert.equal(await f.vault.freeNext(),100_000000n);
 assert.equal(Number((await f.short.datasetProposal(state().jobs.SHORT[0].job.proposalId)).status),2);
 assert.equal(Number((await f.monthly.month(state().jobs.MONTHLY[0].job.artifact.request.drawId)).phase),2);
 console.log('PASS Pons journal prepared and published both legacy datasets');
 await rpc('evm_setNextBlockTimestamp',[target-1802]);await rpc('evm_mine');crash=true;
 await assert.rejects(pass(),/simulated process exit/);assert(crashed);assert(state().lastResolved);assert(!state().pending);
 await pass(); // Reconcile freeze from the durable receipt, then allow the other lane.
 for(let n=0;n<4;n++){if(await f.short.pendingDatasetDraw()!==ZeroHash&&await f.monthly.pendingMonth()!==ZeroHash)break;await pass();}
 assert.notEqual(await f.short.pendingDatasetDraw(),ZeroHash);assert.notEqual(await f.monthly.pendingMonth(),ZeroHash);
 const frozen=state().migration.ledger.draws.map(d=>d.snapshotHash);
 report.activity.push(row(2,'100000000'));report.tradeCount=2;await pass();
 assert.deepEqual(state().migration.ledger.draws.map(d=>d.snapshotHash),frozen);
 for(const k of ['SHORT','MONTHLY']){const w=state().migration.ledger.wallets[0][k];assert.equal(w.mintedTotal,'5');assert.equal(w.open,'1');}
 console.log('PASS Receipt crash recovery and late purchase preserve frozen participants');
 sourceDown=true;fundingDown=true;
 await rpc('evm_setNextBlockTimestamp',[target+10]);await rpc('evm_mine');
 for(let n=0;n<25;n++){await pass();if(state().migration.ledger.draws.length===2&&state().migration.ledger.draws.every(d=>d.status==='CONSUMED')&&(state().migration.controllerRewards??[]).every(r=>r.paid))break;}
 const done=state();assert(done.migration.ledger.draws.every(d=>d.status==='CONSUMED'));assert(done.migration.controllerRewards.length>0);assert(done.migration.controllerRewards.every(r=>r.paid));
 assert(agedCheckpoint);assert.equal(failRngOnce,false);
 for(const k of ['SHORT','MONTHLY']){const w=done.migration.ledger.wallets[0][k];assert.equal(w.consumedTotal,'4');assert.equal(w.open,'1');assert.deepEqual(w.frozenByDraw,{});}
 sourceDown=false;fundingDown=false;
 const nonce=await f.provider.getTransactionCount(f.owner);await pass();await pass();assert.equal(await f.provider.getTransactionCount(f.owner),nonce);
 const quiet=measurements.at(-1);
 const projection=await meter.measure(()=>buildPonsPublicSnapshot({provider:f.provider,config:c,migration:state().migration,now:clock*1000}));
 const publicFile=f.directory+'/public.json';savePonsPublic(publicFile,projection.result);
 const reader=createPonsPublicReader({config:c,file:publicFile,now:()=>clock*1000});
 const api=require(base+'scripts/user-status-api.cjs').createServer(c,{reader});
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{api.close(resolve);api.closeAllConnections();}));
 const url='http://127.0.0.1:'+api.address().port;
 const httpRead=await meter.measure(async()=>{
  const overview=await originalFetch(url+'/v1/overview');assert.equal(overview.status,200);assert.equal((await overview.json()).history.total,2);
  const walletResponse=await originalFetch(url+'/v1/wallets/'+wallet);assert.equal(walletResponse.status,200);assert.equal((await walletResponse.json()).balances.SHORT.open,'1');
  assert.equal((await originalFetch(url+'/v1/overview?limit=101')).status,400);
 });assert.equal(httpRead.total,0);
 writeFileSync(publicFile,'{}');assert.equal(reader.read().status,'unavailable');savePonsPublic(publicFile,projection.result);assert.equal(reader.read().status,'observed');
 const served=await meter.measure(()=>{
  for(let n=0;n<100;n++){
   const w=renderPonsPublic(c,projection.result,{wallet,now:clock*1000});
   assert.equal(w.status,'observed');assert.equal(w.balances.SHORT.open,'1');assert.equal(w.balances.MONTHLY.consumedTotal,'4');assert.equal(w.purchases.total,2);assert.deepEqual(w.purchases.items.map(p=>p.entriesMinted),['4','1']);assert(w.rewards.items.every(r=>r.status==='paid'));
   const o=renderPonsPublic(c,projection.result,{now:clock*1000});assert.equal(o.history.total,2);assert.equal(o.reserves.claimable,'0');
  }
 });
 assert.equal(served.total,0);assert(projection.total>0);assert(quiet.total>0);
 assert.equal(renderPonsPublic(c,projection.result,{now:(clock+661)*1000}).status,'stale');
 assert.equal(renderPonsPublic(c,{...projection.result,checkedAt:clock-661},{now:clock*1000}).status,'stale');
 assert.throws(()=>renderPonsPublic(c,projection.result,{wallet:'not-a-wallet'}),/Invalid public query/);
 assert.equal(renderPonsPublic(c,projection.result,{wallet:recipients[1],now:clock*1000}).balances.SHORT.open,'0');
 const rendered=renderPonsPublic(c,projection.result,{wallet,now:clock*1000});rendered.balances.SHORT.open='999';assert.equal(projection.result.wallets[wallet].balances.SHORT.open,'1');
 assert(!JSON.stringify(projection.result).includes('signedTransaction'));
 assert.equal(await f.vault.claimable(f.quote.target),0n);assert.equal(await f.vault.reserved(f.quote.target),0n);
 const supervised=createPonsSchedulerSupervisor(options);
 const firstService=await meter.measure(()=>supervised());assert.equal(firstService.result.service.ran,true);
 const sleepingService=await meter.measure(()=>supervised());assert.equal(sleepingService.result.service.ran,false);assert.equal(sleepingService.total,0);
 const announcement=await sent(f.short.announce(f.rules,f.weights,f.minimumUnit));
 await rpc('evm_setNextBlockTimestamp',[Number(await f.short.lastShortTerminalAt())+21601]);await rpc('evm_mine');
 const activation=await sent(f.short.activate()),afterActivation=await f.provider.getTransactionCount(f.owner);
 assert.equal((await pass()).reason,'controllerReceiptsRequired');assert.equal(await f.provider.getTransactionCount(f.owner),afterActivation);
 await assert.rejects(buildPonsPublicSnapshot({provider:f.provider,config:c,migration:state().migration,now:clock*1000}),/Public controller receipts required/);
 options.receiptHashes=[announcement.hash,activation.hash];const previousJobs=state().jobs.SHORT.length;
 for(let n=0;n<8&&state().jobs.SHORT.length===previousJobs;n++){await pass();await rpc('evm_mine');}
 assert(state().jobs.SHORT.length>previousJobs,'Old-epoch remainder job was not created');
 const migrated=state();assert.equal(migrated.migration.ledger.shortRules.currentEpoch,2);assert.equal(migrated.migration.ledger.shortRules.drainingEpoch,1);
 const next=migrated.jobs.SHORT.at(-1).job.artifact.snapshot;assert.equal(next.rulesEpoch,'1');assert.equal(next.participants[0].firstAttempt,'5');assert.equal(next.participants[0].lastAttempt,'5');
 const reportOut={status:'PASS',scenarios:['both legacy datasets from Pons','broadcast and receipt crash recovery','late purchase outside frozen sets','Short and Monthly RNG, settle and claim','restart does not repay','outside epoch change pauses, explicit receipts resume old-epoch remainder'],publicationLogWindows:windows.length,draws:done.migration.ledger.draws.map(d=>({kind:d.kind,status:d.status,totalAttempts:d.totalAttempts})),wallet:done.migration.ledger.wallets[0],limits:['Local Hardhat only','Modeled Pons purchases; historical signed drand vectors','No production release or live RPC budget measurement']};
 reportOut.scenarios.push('Pons curve sweep and escrow 1200 USDG split 1080/60/60 and vault allocation','site snapshot after payment; 200 reads cause zero RPC; stale source and outside changes rejected');
 reportOut.rpc={scope:'Local node calls during completed scheduler passes, includes secondary reader and Hardhat guards; failed crash passes excluded',passes:measurements,quiet,projection:{methods:projection.methods,total:projection.total},publicReads:{requests:200,rpc:served.total},httpReads:{requests:3,rpc:httpRead.total}};
 reportOut.rpc.supervisor={initial:firstService.total,unchangedSource:sleepingService.total,nextCheckAt:sleepingService.result.service.nextCheckAt};
 writeFileSync(root+'/public-snapshot.json',JSON.stringify(projection.result,null,2));
 writeFileSync(root+'/report.json',JSON.stringify(reportOut,null,2));console.log('PASS Both legacy draws consumed four tickets, paid rewards, retained one ticket; '+root+'/report.json');
});
