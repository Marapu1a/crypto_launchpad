import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BrowserProvider, Contract, ContractFactory, HDNodeWallet, id, keccak256 } from 'ethers';
import { compileProduction } from '../../src/worker/production-build.mjs';
import { GENESIS, PERIOD } from '../../src/randomness/drand.mjs';
import { createTestPostgres } from './production-postgres.mjs';
import { registerProductionSender } from '../../server/shared/production-sender.mjs';
import { runProductionWorker, runProductionProjects } from '../../server/shared/production-worker.mjs';
import { creditedPurchases, snapshotProductionTickets } from '../../src/tickets/production-ledger.mjs';
import { replayTickets } from '../../src/tickets/ledger.mjs';
import { digest } from '../../src/tickets/digest.mjs';
import { verifyTemplate } from '../../src/worker/production-template.mjs';
import { inProject } from '../../server/shared/store.mjs';

const vector = JSON.parse(readFileSync('vendor/qianqi/research/drand-feasibility/vector.json'));
const preceding = JSON.parse(readFileSync('tests/fixtures/production-pre-freeze-beacon.json'));
const roundTime = GENESIS+(vector.beacon.round-1)*PERIOD;
const timing = {lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30};
process.env.PRODUCTION_TEST_START = new Date((roundTime-100000)*1000).toISOString();
process.env.HARDHAT_CONFIG = resolve('tests/contracts/production-worker-hardhat.config.cjs');
const {default:hre} = await import('hardhat');
const base = new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});
base.pollingInterval = 20;
let clock, finality;
const provider = new Proxy(base,{ get(target,name) {
  if(name==='getBlock') return n => target.getBlock(n==='finalized' ? (finality ?? 'latest') : n);
  if(name==='broadcastTransaction') return async raw => { await hre.network.provider.send('evm_setNextBlockTimestamp',[clock]); return target.broadcastTransaction(raw); };
  const v=Reflect.get(target,name);return typeof v==='function'?v.bind(target):v;
} });
const report={startedAt:new Date().toISOString(),scenarios:[],limits:['Isolated modeled chain 4663/finality; no public sends','Pons fixture, direct buys only; fork rehearsal remains','Test-only timing; historical authenticated drand vectors']};
report.sourceHashes = Object.fromEntries([
  'server/shared/production-worker.mjs','server/shared/production-sender.mjs','src/worker/production-journal.mjs',
  'src/worker/production-template.mjs','src/worker/production-policy.mjs','src/worker/production-timing.mjs',
  'src/tickets/production-ledger.mjs','src/tickets/recognition.mjs','src/tickets/direct-curve.cjs',
  'db/migrations/012_production_wallets.sql','tests/contracts/production-worker-cycle.mjs',
  'tests/contracts/WorkerFixtures.sol','tests/fixtures/production-pre-freeze-beacon.json',
].map(file => [file,keccak256(Buffer.from(readFileSync(file,'utf8').replaceAll('\r\n','\n')))]));
const root='.local/test-results/production-worker-'+report.startedAt.replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});
const persist=()=>writeFileSync(root+'/report.json',JSON.stringify(report,null,2));
const scenario=async(name,fn)=>{await fn();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);persist();};
const tx=async p=>(await p).wait();
let db;
try {
  const build=compileProduction(),fixtures=compileProduction({'tests/contracts/WorkerFixtures.sol':{content:readFileSync('tests/contracts/WorkerFixtures.sol','utf8')}});
  report.buildHash=build.manifest.buildHash;
  const deployer=await base.getSigner(0);
  const deployArtifact=async(a,args=[])=>{const c=await new ContractFactory(a.abi,a.evm.bytecode.object,deployer).deploy(...args);await c.waitForDeployment();return c;};
  const deploy=(name,args)=>deployArtifact(build.artifacts[name],args);
  const fixture=(name,args=[],file='WorkerFixtures')=>deployArtifact(fixtures.contracts['tests/contracts/'+file+'.sol'][name],args);
  const quote=await fixture('TestUSDG',[],'Fixtures'),hook=await fixture('WorkerHook'),factory=await fixture('WorkerFactory',[hook.target]),router=await fixture('WorkerRouter',[factory.target]),escrow=await fixture('WorkerEscrow',[quote.target]);
  db=await createTestPostgres(root+'/postgres');
  const wallet=i=>HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/"+i).connect(provider);
  const projects=[];
  for(let i=0;i<2;i++) {
    const signer=wallet(1+i*2),publisher=wallet(2+i*2),team=wallet(17+i),operations=wallet(19-i);
    const projectId=(i?'b':'a')+'5897d1a-def5-4c9f-a7bb-a76f2b16519e';
    const instanceId=id('runtime-'+i),program=await deploy('ShortProgram',[{asset:quote.target,operator:signer.address,instance:instanceId,interval:86400,minimumFund:50000000,minimumUnit:50000000},[1],timing]);
    const adapter=new Contract(await program.randomness(),build.artifacts.ShortDrandAdapter.abi,deployer);
    const splitter=await deploy('FeeSplitter',[quote.target,program.target,team.address,operations.address,[8000,1500,500]]);
    const collector=await deploy('PonsFeeCollector',[quote.target,escrow.target,splitter.target,factory.target]);
    const token=await fixture('TestUSDG',[],'Fixtures'),curve=await fixture('WorkerCurve',[token.target,factory.target,quote.target,collector.target,escrow.target]);
    const recognition=await deploy('PurchaseRecognition',[instanceId,publisher.address]);
    await tx(factory.setLaunch([token.target,curve.target,await deployer.getAddress(),collector.target,quote.target,4200000,3000,60,200,false,0,0,0,0,true]));
    await tx(collector.bind(token.target));await tx(token.mint(curve.target,1000000000000n));
    const anchor=await provider.getBlock('latest');
    const policy={schema:'short-production-policy-v1',chainId:4663,projectId,executor:signer.address,publisher:publisher.address,buildHash:build.manifest.buildHash,
      anchor:{number:anchor.number,hash:anchor.hash},contracts:{},limits:{maxGasPrice:'100000000000',maxGasLimit:'15000000',nativeFloor:'100000'},timing,
      template:{schema:'short-template-v1',instanceId,thresholdRaw:'10000000',interval:'86400',minimumFund:'50000000',minimumUnit:'50000000',weights:[1],bps:[8000,1500,500],creatorTaxBps:200,team:team.address,operations:operations.address}};
    for(const [kind,c] of Object.entries({quote,hook,factory,router,escrow,program,adapter,splitter,collector,token,curve,recognition})) policy.contracts[kind]={address:c.target,codeHash:keccak256(await provider.getCode(c.target))};
    await db.admin.query('INSERT INTO launchpad.projects VALUES($1,$2,$2,4663,$3,\'test\')',[projectId,'runtime-'+i,token.target.toLowerCase()]);
    await db.admin.query("INSERT INTO launchpad.module_instances VALUES($1,$1,'short','production-candidate-v1',$2,$3)",[projectId,program.target.toLowerCase(),digest(policy)]);
    await registerProductionSender({pool:db.pools.executor,provider,projectId,moduleId:projectId,policy});
    projects.push({pool:db.pools.executor,provider,signer,publisher,projectId,moduleId:projectId,policy,program,adapter,curve,splitter,collector,recognition,team,operations,
      now:()=>clock,getLatestBeacon:async()=>preceding,getBeacon:async round=>{assert.equal(round,vector.beacon.round);return vector.beacon;}});
  }
  const [a,b]=projects;
  const state=async p=>JSON.parse((await db.admin.query('SELECT state_text FROM launchpad.production_senders WHERE project_id=$1',[p.projectId])).rows[0].state_text);
  const move=async time=>{clock=time;await hre.network.provider.send('evm_setNextBlockTimestamp',[time]);await hre.network.provider.send('evm_mine');};
  const pass=p=>runProductionWorker(p);
  const until=async(p,predicate,max=25)=>{for(let n=0;n<max;n++){if(await predicate())return;const r=await pass(p);if(r.status==='blocked')throw Error(JSON.stringify(r));}assert.ok(await predicate(),'Worker did not reach condition');};
  const buy=async(p,index,amount)=>{const buyer=await base.getSigner(index);await tx(quote.mint(await buyer.getAddress(),amount));await tx(quote.connect(buyer).approve(p.curve.target,amount));return tx(p.curve.connect(buyer).buy(amount,0,await buyer.getAddress()));};
  await scenario('Independent complete template bindings and cross-role wallet reservations',async()=>{
    // Exercise upgrade from an already populated 011, not only a fresh empty database.
    await db.admin.query('BEGIN');
    await db.admin.query('DROP TRIGGER reserve_wallets ON launchpad.production_senders; DROP FUNCTION launchpad.reserve_production_wallets(); DROP TABLE launchpad.production_wallets');
    await db.admin.query(readFileSync('db/migrations/012_production_wallets.sql','utf8'));
    await db.admin.query('COMMIT');
    for(const p of projects)await verifyTemplate(provider,p.policy);
    const changed=structuredClone(a.policy);changed.template.bps=[9000,500,500];await assert.rejects(verifyTemplate(provider,changed),/Split mismatch/);
    assert.equal((await db.admin.query('SELECT * FROM launchpad.production_wallets')).rowCount,4);
    await assert.rejects(inProject(db.pools.executor,b.projectId,c=>c.query("INSERT INTO launchpad.production_wallets VALUES(4663,$1,$2,$2,'executor')",[a.publisher.address.toLowerCase(),b.projectId]),{readOnly:false}),e=>e.constraint==='production_wallets_pkey');
    assert.equal((await inProject(db.pools.executor,a.projectId,c=>c.query('SELECT * FROM launchpad.production_wallets'))).rowCount,2);
    for(const pool of [db.pools.api,db.pools.jobs])await assert.rejects(inProject(pool,a.projectId,c=>c.query('SELECT * FROM launchpad.production_wallets')),/permission denied/);
  });
  await scenario('Actual direct buys produce isolated 80/15/5 funding and finalized recognized tickets',async()=>{
    for(let j=5;j<9;j++)await buy(a,j,1000000000n);
    for(let j=9;j<13;j++)await buy(b,j,1500000000n);
    await move(roundTime-timing.lead-61); // Beacon ahead: recognition and funding continue, freeze waits.
    for(const [p,budget] of [[a,64000000n],[b,96000000n]]) {
      await until(p,async()=>{const s=await state(p);return await p.program.freeFund()===budget && s.runtime && creditedPurchases(p.policy,s.runtime.ledger).length===4 && await p.splitter.credit(1)===0n && await p.splitter.credit(2)===0n;});
      assert.equal(await p.program.cycle(),0n);
      const s=await state(p),wallets=replayTickets(creditedPurchases(p.policy,s.runtime.ledger),p.policy.template.thresholdRaw);
      assert.equal(Object.keys(wallets).length,4);assert.equal(Object.values(wallets)[0].tickets,p===a?'100':'150');
    }
    assert.equal(await quote.balanceOf(a.team.address),12000000n); // a.team is not b.operations.
    assert.equal(await quote.balanceOf(a.operations.address),4000000n);
  });
  let preparedHash,frozenHash;
  await scenario('Process/DB-session loss before freeze broadcast; second project still progresses',async()=>{
    await move(roundTime-timing.lead-1);
    let killed=false;
    await assert.rejects(pass({...a,hook:async phase=>{
      if(phase!=='prepared')return;
      assert.equal((await pass(a)).status,'busy');
      const {rows:[backend]}=await db.admin.query("SELECT pid FROM pg_stat_activity WHERE usename='lp_executor' AND pid IN (SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted)");
      assert.ok(backend);await db.admin.query('SELECT pg_terminate_backend($1)',[backend.pid]);killed=true;
    }}));
    assert.ok(killed);const s=await state(a);preparedHash=s.pending.hash;frozenHash=digest(s.runtime.cycles['1']);
    assert.equal(await provider.getTransactionReceipt(preparedHash),null);
    assert.equal(await a.program.cycle(),0n);
    const result=await runProductionProjects([{...a,publisher:b.publisher},b]);
    assert.equal(result[0].status,'blocked');assert.equal(result[1].status,'confirmed');assert.equal(await b.program.cycle(),1n);
    finality=(await base.getBlock('latest')).number;
    const resumed=await pass(a);assert.equal(resumed.reason,'receipt-finality');assert.equal(resumed.hash,preparedHash);
    assert.equal((await pass(a)).reason,'receipt-finality');
    finality=undefined;assert.equal((await pass(a)).status,'confirmed');
    assert.equal(digest((await state(a)).runtime.cycles['1']),frozenHash);
    for(const p of projects)assert.equal((await p.adapter.requests(await p.program.requestForCycle(1))).round,BigInt(vector.beacon.round));
  });
  await scenario('Late purchase confirmation waits for finality and never rewrites the frozen dataset',async()=>{
    const previous=await a.program.draws(1);
    await buy(a,5,10000000n);clock=(await base.getBlock('latest')).timestamp;
    let held=false;
    await until({...a,hook:async phase=>{
      if(phase==='prepared' && (await state(a)).runtime.operation.method==='confirm') {
        finality=(await base.getBlock('latest')).number;held=true;
      }
    }},async()=>held && Boolean((await state(a)).runtime.publisher.pending));
    const s=await state(a);
    // Mined confirmation is deliberately not finalized and has not credited a ticket.
    assert.equal(creditedPurchases(a.policy,s.runtime.ledger).length,4);
    assert.equal((await pass(a)).reason,'receipt-finality');assert.equal(creditedPurchases(a.policy,(await state(a)).runtime.ledger).length,4);
    finality=undefined;assert.equal((await pass(a)).status,'confirmed');
    await until(a,async()=>creditedPurchases(a.policy,(await state(a)).runtime.ledger).length===5);
    assert.equal(creditedPurchases(a.policy,(await state(a)).runtime.ledger).length,5);
    assert.equal(digest((await state(a)).runtime.cycles['1']),frozenHash);assert.deepEqual(await a.program.draws(1),previous);
    assert.equal(creditedPurchases(b.policy,(await state(b)).runtime.ledger).length,4);
  });
  await scenario('Both projects prove original BLS round, settle and claim without a repeated payout',async()=>{
    await move(roundTime+30);
    for(const p of projects){
      await until(p,async()=> (await p.program.draws(1)).settled);
      await until(p,async()=>await p.program.liabilities()===0n);
      const d=await p.program.draws(1);assert.ok(d.awarded>0n); // Fixed deterministic fixture, not guaranteed product outcome.
      const balances=[];for(const person of (await state(p)).runtime.cycles['1'].participants)balances.push(String(await quote.balanceOf(person.wallet)));
      for(let i=0;i<3;i++)await pass(p);
      const after=[];for(const person of (await state(p)).runtime.cycles['1'].participants)after.push(String(await quote.balanceOf(person.wallet)));
      assert.deepEqual(after,balances);assert.equal(await p.program.cycle(),1n);
      assert.equal((await p.adapter.requests(await p.program.requestForCycle(1))).round,BigInt(vector.beacon.round));
    }
    const s=await state(a),next=await snapshotProductionTickets(a.policy,s.runtime.ledger,a.program);
    assert.deepEqual(next.participants,[{wallet:wallet(5).address.toLowerCase(),firstAttempt:'101',lastAttempt:'101'}]);
    assert.deepEqual((await snapshotProductionTickets(b.policy,(await state(b)).runtime.ledger,b.program)).participants,[]);
    report.results=[];for(const p of projects)report.results.push({projectId:p.projectId,cycle:String(await p.program.cycle()),awarded:String((await p.program.draws(1)).awarded),liabilities:String(await p.program.liabilities()),operations:(await state(p)).history.length});
  });
  await scenario('Corrupt evidence/branch and wrong publisher stop before signing',async()=>{
    const saved=await state(a),before=await provider.getTransactionCount(a.signer.address);
    finality=saved.history.at(-1).blockNumber-1;
    assert.equal((await pass(a)).reason,'finality-regression');finality=undefined;
    const damaged=structuredClone(saved);damaged.runtime.ledger.head.hash=id('bad-branch');
    await db.admin.query('UPDATE launchpad.production_senders SET state_text=$2,state_hash=$3 WHERE project_id=$1',[a.projectId,JSON.stringify(damaged),digest(damaged)]);
    await assert.rejects(pass(a),/branch changed/);
    assert.equal(await provider.getTransactionCount(a.signer.address),before);
    await db.admin.query('UPDATE launchpad.production_senders SET state_text=$2,state_hash=$3 WHERE project_id=$1',[a.projectId,JSON.stringify(saved),digest(saved)]);
    const bad=structuredClone(saved);bad.runtime.ledger.events[0].netQuoteDebitRaw='99999999999';
    assert.throws(()=>creditedPurchases(a.policy,bad.runtime.ledger),/Unverified purchase/);
    await assert.rejects(pass({...a,publisher:b.publisher}),/Wrong recognition publisher/);
  });
  report.status='PASS';
} catch(e){report.status='FAIL';report.error=e.shortMessage||e.message;console.error(e);process.exitCode=1;}
finally{persist();console.log(root+'/report.json');await db?.close();base.destroy();}
