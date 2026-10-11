// Local-only rehearsal of an existing v2 Short token. Never a public launch command.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {JsonRpcProvider,Contract} from 'ethers';
import {createPool,inProject} from '../server/shared/store.mjs';
import {createRuntimeHandoff} from '../server/owner-launch/handoff.mjs';
import {loadRuntimeProject,validateRuntimeConfig} from '../server/short-runtime/config.mjs';
import {runDrawWorker} from '../server/shared/draw-worker.mjs';
import {publishShortView} from '../server/short-runtime/projection.mjs';
import {projectSite} from '../server/shared/site.mjs';
import {drawContracts as contracts,verifyDrawPolicy as verifyTemplate} from '../src/worker/draw-policy.mjs';
import {amount,previewBasket} from '../src/draws/config.mjs';
import {creditedPurchases,snapshotProductionTickets} from '../src/tickets/draw-ledger.mjs';
import {replayTickets} from '../src/tickets/ledger.mjs';
import {fetchLatest,fetchBeacon,GENESIS,PERIOD} from '../src/randomness/drand.mjs';
import {compute,QIANQI_RULES} from '../src/draws/short-outcome.mjs';
import {digest} from '../src/tickets/digest.mjs';
import {UUID} from '../src/launch/template.mjs';

const [file,projectId,mode]=process.argv.slice(2);assert.ok(UUID.test(projectId)&&['--exercise','--serve'].includes(mode),'Config, project UUID and explicit mode required');
const root=path.resolve('.local/test-results/owner-draw-'+new Date().toISOString().replace(/[:.]/g,'-'));await fs.mkdir(root,{recursive:true});
const report={at:new Date().toISOString(),projectId,mode,sourceHash:digest((await fs.readFile(new URL(import.meta.url),'utf8')).replaceAll('\r\n','\n')),steps:[],limits:['Existing owner token on pinned private fork82000000 only','Modeled finality/latest and clock; published authentic historical BLS round','Direct USDG purchases; not real future entropy or public deployment']};
const persist=()=>fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2));
let base,pools,server,timer,stopping=false;
try{
 const cfg=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(cfg.schema,'owner-rehearsal-v2');assert.equal(cfg.profile.mode,'rehearsal');
 for(const [value,protocol] of [[cfg.rpcUrl,'http:'],...Object.values(cfg.urls).map(u=>[u,'postgresql:'])]){const u=new URL(value);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.protocol,protocol);}
 base=new JsonRpcProvider(cfg.rpcUrl,undefined,{cacheTimeout:-1});base.pollingInterval=30;
 const guard=async()=>{const m=await base.send('hardhat_metadata',[]);assert.equal(m.instanceId,cfg.profile.instanceId);assert.equal(m.chainId,4663);assert.equal(m.forkedNetwork?.forkBlockNumber,82000000);};await guard();
 let clock=(await base.getBlock('latest')).timestamp;
 const provider=new Proxy(base,{get(target,k){if(k==='getBlock')return n=>target.getBlock(n==='finalized'?'latest':n);if(k==='broadcastTransaction')return async raw=>{await guard();await target.send('evm_setNextBlockTimestamp',[clock]);return target.broadcastTransaction(raw);};const v=Reflect.get(target,k);return typeof v==='function'?v.bind(target):v;}});
 pools=Object.fromEntries(Object.entries(cfg.urls).map(([role,url])=>[role,createPool(url)]));
 const runtime={schema:'draw-runtime-config-v2',mode:'rehearsal',instanceId:cfg.profile.instanceId,intervalMs:5000,concurrency:1,rpcFile:path.join(cfg.root,'rpc.txt'),databaseFile:path.join(cfg.root,'db.txt'),healthFile:path.join(cfg.root,'draw-health.json')};
 const handoff=await createRuntimeHandoff({pool:pools.executor,apiPool:pools.api,profile:cfg.profile,runtime,keys:{[projectId]:cfg.keys},baseDomain:'tokens.localhost'})(projectId);assert.equal(handoff.prepared,true);
 const config=validateRuntimeConfig({...handoff.config,projects:handoff.config.projects.map(p=>({...p,enabled:true}))});
 const entry=config.projects[0];let loaded=await loadRuntimeProject({pool:pools.executor,provider,config,entry});
 const readSource=()=>inProject(pools.executor,projectId,async c=>{const {rows:[r]}=await c.query('select policy_text,policy_hash,state_text,state_hash from launchpad.production_senders where project_id=$1 and module_id=$1',[projectId]);const policy=JSON.parse(r.policy_text),state=JSON.parse(r.state_text);assert.equal(digest(policy),r.policy_hash);assert.equal(digest(state),r.state_hash);return {policy,state};});
 const {policy,state:initial}=await readSource();await verifyTemplate(provider,policy);const c=contracts(provider,policy),settings=policy.template.config;
 assert.ok(settings.short.enabled&&!settings.monthly.enabled,'This existing-token exercise supports Short-only; dual-mode has a separate integration suite');
 report.settings=settings;report.creatorTaxBps=policy.template.creatorTaxBps;report.token=policy.contracts.token.address;report.policyHash=digest(policy);report.instanceId=cfg.profile.instanceId;
 const move=async t=>{await guard();assert.ok(t>=clock);clock=t;await base.send('evm_setNextBlockTimestamp',[clock]);await base.send('evm_mine',[]);};
 const transact=async(label,fn)=>{await guard();await base.send('evm_setNextBlockTimestamp',[clock]);const receipt=await(await fn()).wait();assert.equal(receipt.status,1);report.steps.push({label,hash:receipt.hash,block:receipt.blockNumber,gasUsed:String(receipt.gasUsed),costWei:String(receipt.gasUsed*receipt.gasPrice)});await persist();return receipt;};
 let getLatestBeacon=fetchLatest,getBeacon=fetchBeacon;
 const pass=async()=>{await guard();await loaded.guard();const result=await runDrawWorker({...loaded,now:()=>clock,getLatestBeacon,getBeacon});report.lastPass=result;const view=await publishShortView({pool:pools.executor,provider,projectId,moduleId:projectId,...result});assert.ok(!view?.failed,'Public projection failed');await persist();if(result.status==='blocked')throw Error('Worker blocked');return result;};
 const until=async fn=>{for(let n=0;n<120;n++){if(await fn())return;const result=await pass();
   // Fixture funding only, never part of production worker behavior. Record the wait first.
   if(mode==='--exercise'&&result.reason==='native-balance'){
    const {state}=await readSource();const funding=[state.gasFunding,state.runtime?.publisher.gasFunding].find(x=>x?.active);
    assert.ok(funding);report.steps.push({label:'Gas shortage safely waits',funding});await persist();
    const wallet=funding.role==='publisher'?policy.publisher:policy.executor;assert.equal(wallet.toLowerCase(),funding.wallet);
    assert.ok(!report.steps.some(x=>x.label==='Local fixture gas reserve: '+funding.role),'Repeated gas shortage needs inspection');
    const fixture=await base.getSigner(cfg.profile.owner);
    await transact('Local fixture gas reserve: '+funding.role,()=>fixture.sendTransaction({to:wallet,value:20000000000000000n}));
   }
  }assert.ok(await fn(),'Worker did not reach requested state: '+JSON.stringify(report.lastPass));};
 if(mode==='--exercise'){
  const threshold=String(amount(settings.ticketPurchase));
  assert.equal(threshold,'10000000','This purchase fixture uses 10 USDG tickets');
  assert.equal(await c.short.cycle(),0n);assert.equal(initial.runtime,undefined,'Exercise is not a repeatable purchase button; inspect existing runtime first');
  const target=await fetchLatest(),before=await fetchBeacon(target.round-1201),targetTime=GENESIS+(target.round-1)*PERIOD,freezeTime=targetTime-3601;
  assert.ok(freezeTime-120>clock&&freezeTime>Number(await c.short.lastTerminal())+settings.short.intervalSeconds,'Chain is too recent for historical Short rehearsal');
  await fs.writeFile(path.join(root,'beacons.json'),JSON.stringify({target,before},null,2));getLatestBeacon=async()=>before;getBeacon=async round=>{assert.equal(round,target.round);return target;};
  const owner=await base.getSigner(cfg.profile.owner),buyer=await base.getSigner(1),buyerAddress=await buyer.getAddress();
  const quote=new Contract(policy.contracts.quote.address,['function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)'],owner);
  const curve=new Contract(policy.contracts.curve.address,['function buy(uint256,uint256,address) returns(uint256)','function creatorTaxBalance() view returns(uint256)','function quoteFeeBalance() view returns(uint256)','function protocolFeeShareBps() view returns(uint256)'],owner);
  assert.ok(await quote.balanceOf(cfg.profile.owner)>=3140000000n);const teamBefore=await quote.balanceOf(policy.template.team),opsBefore=await quote.balanceOf(policy.template.operations);
  await move(freezeTime-120);
  await transact('fund local second buyer',()=>quote.transfer(buyerAddress,20000000n));
  await transact('approve owner',()=>quote.approve(curve.target,3100000000n));await transact('buy owner 3100 USDG',()=>curve.buy(3100000000n,1,cfg.profile.owner));
  await transact('approve second buyer',()=>quote.connect(buyer).approve(curve.target,20000000n));await transact('buy second buyer 10 USDG',()=>curve.connect(buyer).buy(10000000n,1,buyerAddress));
  const fees=await curve.quoteFeeBalance(),creator=await curve.creatorTaxBalance(),protocolShare=await curve.protocolFeeShareBps(),revenue=creator+fees-fees*protocolShare/10000n,fund=revenue*BigInt(settings.fees.prizesBps)/10000n;
  assert.ok(fund>=amount(settings.short.minimumFund)&&previewBasket(fund,settings.short.basket).ready);
  const team=revenue*BigInt(settings.fees.teamBps)/10000n;report.expected={revenue,fund,team,operations:revenue-fund-team};
  await until(async()=>{const {state}=await readSource();return state.runtime&&creditedPurchases(policy,state.runtime.ledger).length===2&&await c.short.freeFund()===fund&&await c.splitter.credit(1)===0n&&await c.splitter.credit(2)===0n;});
  assert.equal(await quote.balanceOf(policy.template.team)-teamBefore,report.expected.team);assert.equal(await quote.balanceOf(policy.template.operations)-opsBefore,report.expected.operations);
  report.tickets=replayTickets(creditedPurchases(policy,(await readSource()).state.runtime.ledger),threshold);assert.equal(report.tickets[cfg.profile.owner.toLowerCase()].tickets,'310');assert.equal(report.tickets[buyerAddress.toLowerCase()].tickets,'1');report.steps.push({label:'Configured fee split and 311 tickets verified'});await persist();
  await move(freezeTime);await until(async()=>await c.short.pending());const snapshot=(await readSource()).state.runtime.cycles.short['1'];assert.equal(snapshot.budget,String(fund));const request=await c.shortAdapter.requests(await c.short.requestForCycle(1));assert.equal(request.round,BigInt(target.round));
  await transact('late buy second buyer 10 USDG',()=>curve.connect(buyer).buy(10000000n,1,buyerAddress));await until(async()=>creditedPurchases(policy,(await readSource()).state.runtime.ledger).length===3);assert.deepEqual((await readSource()).state.runtime.cycles.short['1'],snapshot);report.steps.push({label:'Late ticket leaves frozen snapshot unchanged'});
  await move(targetTime+30);await until(async()=>(await c.short.draws(1)).settled);await until(async()=>await c.short.liabilities()===0n);
  const draw=await c.short.draws(1),rng=await c.shortAdapter.requests(await c.short.requestForCycle(1)),expected=compute(draw.context,rng.seed,snapshot.participants,QIANQI_RULES,previewBasket(BigInt(snapshot.budget),settings.short.basket).prizes);
  assert.equal(draw.resultHash,expected.resultHash);assert.equal(draw.awarded,expected.amounts.reduce((s,n)=>s+n,0n));const balances=await Promise.all(expected.winners.map(w=>quote.balanceOf(w)));for(let n=0;n<3;n++)await pass();assert.deepEqual(await Promise.all(expected.winners.map(w=>quote.balanceOf(w))),balances);
  const later=await snapshotProductionTickets(policy,(await readSource()).state.runtime.ledger,c.short);
  assert.deepEqual(later.participants,[{wallet:buyerAddress.toLowerCase(),firstAttempt:'2',lastAttempt:'2'}]);
  report.nextEligibleAt=String(await c.short.lastTerminal()+BigInt(settings.short.intervalSeconds));
  report.lateTicket=later.participants;
  await until(async()=>{const s=(await readSource()).state;return !s.pending&&!s.runtime.publisher.pending&&!s.runtime.operation&&await quote.balanceOf(c.collector.target)===0n&&await c.escrow.balanceOfToken(c.collector.target,c.quote.target)===0n&&await curve.quoteFeeBalance()===0n&&await curve.creatorTaxBalance()===0n&&await c.splitter.credit(0)===0n&&await c.splitter.credit(1)===0n&&await c.splitter.credit(2)===0n&&await c.fundingRouter.credit(0)===0n;});
  const beforeRestart=(await readSource()).state,nonceBefore=await base.getTransactionCount(policy.executor),publisherNonceBefore=await base.getTransactionCount(policy.publisher);
  loaded=await loadRuntimeProject({pool:pools.executor,provider,config,entry});
  for(let n=0;n<3;n++)await pass();
  const afterRestart=(await readSource()).state;
  assert.deepEqual(afterRestart.history,beforeRestart.history);assert.deepEqual(afterRestart.runtime.publisher.history,beforeRestart.runtime.publisher.history);
  assert.equal(await base.getTransactionCount(policy.executor),nonceBefore);assert.equal(await base.getTransactionCount(policy.publisher),publisherNonceBefore);
  assert.deepEqual(await Promise.all(expected.winners.map(w=>quote.balanceOf(w))),balances);
  report.restart={freshKeysAndRuntime:true,executorNonce:nonceBefore,publisherNonce:publisherNonceBefore,noRepeatedTransactions:true};
  report.gas={};for(const [role,journal] of [['executor',afterRestart],['publisher',afterRestart.runtime.publisher]]){
   let cost=0n;for(const h of journal.history){const receipt=await base.getTransactionReceipt(h.hash);cost+=receipt.gasUsed*receipt.gasPrice;}
   report.gas[role]={transactions:journal.history.length,actualCostWei:String(cost),remainingWei:String(await base.getBalance(policy[role]))};
  }
  report.outcome={round:target.round,winners:expected.winners,amounts:expected.amounts,resultHash:draw.resultHash,awarded:draw.awarded,liabilities:await c.short.liabilities()};report.status='PASS';await pass();await persist();console.log('PASS existing v2 Short token cycle; '+root);
 }else{
  // Only this local project's hostname is installed; conflict cannot reassign another token.
  const admin=await pools.admin.connect();try{await admin.query('BEGIN');await admin.query('INSERT INTO launchpad.project_domains VALUES($1,$2) ON CONFLICT DO NOTHING',[handoff.site.hostname,projectId]);const {rows:[r]}=await admin.query('SELECT project_id FROM launchpad.project_domains WHERE hostname=$1',[handoff.site.hostname]);assert.equal(r.project_id,projectId);await admin.query('COMMIT');}catch(e){await admin.query('ROLLBACK');throw e;}finally{admin.release();}
  server=createServer(projectSite(pools.api));await new Promise((ok,bad)=>{server.once('error',bad);server.listen(4189,'127.0.0.1',ok);});
  report.url='http://'+handoff.site.hostname+':4189/';report.status='RUNNING';await persist();console.log('Local token site: '+report.url);
  let active=false,closed=false;
  const stop=async()=>{if(closed)return;closed=true;stopping=true;clearTimeout(timer);await new Promise(r=>server.close(r));await Promise.allSettled(Object.values(pools).map(p=>p.end()));base.destroy();};
  const requestStop=()=>{stopping=true;if(!active)void stop();};
  const tick=async()=>{if(stopping)return stop();active=true;try{try{await fs.access(path.join(cfg.root,'draw-runtime.stop'));stopping=true;}catch{}if(!stopping){await move(Math.max(clock,Math.floor(Date.now()/1000)));await pass();}}catch{report.lastPass={status:'blocked',reason:'local-pass-failed'};try{await publishShortView({pool:pools.executor,provider,projectId,moduleId:projectId,status:'blocked'});}catch{}await persist();}finally{active=false;if(stopping)await stop();else timer=setTimeout(tick,5000);}};
  process.once('SIGINT',requestStop);process.once('SIGTERM',requestStop);await tick();
 }
}catch(e){report.status='FAIL';report.error=String(e.shortMessage??e.message).replace(/https?:\/\/[^\s"']+/g,'[URL]');await persist();console.error(report.error);process.exitCode=1;}
finally{if(mode!=='--serve'||report.status==='FAIL'){server?.close();await Promise.allSettled(Object.values(pools??{}).map(p=>p.end()));base?.destroy();}console.log(path.join(root,'report.json'));}
