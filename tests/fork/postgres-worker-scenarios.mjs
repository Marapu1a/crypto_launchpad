import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fork } from 'node:child_process';
import { Contract } from 'ethers';
import pg from 'pg';
import { createWorkerConfig } from '../../src/worker/local-worker.mjs';
import { createPool,inProject } from '../../server/shared/store.mjs';
import { registerPostgresWorker,runPostgresWorker,readPostgresWorker } from '../../server/shared/postgres-worker.mjs';
import { ingestNext } from '../../server/shared/chain-read.mjs';
import { advanceFinancialOperation } from '../../server/shared/financial-journal.mjs';
import { digest } from '../../src/tickets/digest.mjs';
import { recognize } from '../../src/tickets/recognition.mjs';
import { bundleHash } from '../../src/tickets/late-recognition.mjs';
import { fetchBeacon,GENESIS,PERIOD } from '../../src/randomness/drand.mjs';

export async function exercisePostgresWorker({provider,signer,profile,collector,program,quote,curve,source,alice,dir,scenario,report,localUrl}){
  const urls=JSON.parse(process.env.SHARED_TEST_DATABASES??'null');assert.ok(urls,'Run through test:shared:worker');
  for(const url of Object.values(urls))assert.equal(new URL(url).hostname,'127.0.0.1');
  const admin=new pg.Client({connectionString:urls.admin});await admin.connect();
  const executorPool=createPool(urls.executor),jobsPool=createPool(urls.jobs),ingestPool=createPool(urls.ingest);
  const p='77777777-7777-4777-8777-777777777777',m='77777777-aaaa-4777-8777-777777777777',sourceId='77777777-cccc-4777-8777-777777777777';
  const bundles=resolve(dir,'db-worker-bundles');mkdirSync(bundles);let child;
  try{
    const config=await createWorkerConfig(provider,{profile,collector:collector.target,executor:signer.address,limits:{maxGasPrice:'100000000000',maxGasLimit:'8000000',nativeFloor:'1000000000000000'}});
    await admin.query("INSERT INTO launchpad.projects VALUES($1,'db-worker','DB worker',31337,$2,'test')",[p,profile.token.toLowerCase()]);
    await admin.query("INSERT INTO launchpad.module_instances VALUES($1,$2,'short','local-ticket-shadow-v1',$3,$4)",[p,m,program.target.toLowerCase(),digest(config)]);
    const genesis=await provider.send('eth_getBlockByNumber',['0x0',false]);
    await admin.query('INSERT INTO launchpad.chain_sources VALUES($1,31337,$2,$3,$4,$3,$4,false)',[sourceId,genesis.hash,profile.anchor.number,profile.anchor.hash]);
    const tip=await provider.getBlockNumber();for(let n=profile.anchor.number;n<tip;n++)await ingestNext(ingestPool,provider,sourceId,tip);
    const args={executorPool,jobsPool,ingestPool,provider,signer,projectId:p,moduleId:m,sourceId,config,bundleDirectory:bundles};
    await registerPostgresWorker(args);
    await registerPostgresWorker(args); // Exact setup can resume after partial registration.
    const pass=options=>runPostgresWorker({...args,...options});
    const stored=()=>readPostgresWorker(executorPool,p,m);
    const operation=async()=>inProject(executorPool,p,async c=>(await c.query("SELECT * FROM launchpad.financial_operations WHERE status='prepared'")).rows[0]);
    const tx=async x=>(await x).wait();
    await scenario('DB worker rejects cross-contract calls and hides orchestration state from jobs',async()=>{
      await assert.rejects(jobsPool.query('SELECT * FROM launchpad.worker_states'),e=>e.code==='42501');
      await assert.rejects(advanceFinancialOperation({pool:executorPool,provider,signer,projectId:p,moduleId:m,operationId:'bad',action:'program.claim',request:{to:quote.target,data:'0x12345678',value:0}}),/not allowed/);
      assert.equal((await executorPool.query('SELECT * FROM launchpad.worker_states')).rowCount,0);
    });
    await scenario('Full DB worker survives real process death after signed prepare with no filesystem locks',async()=>{
      child=fork(resolve('tests/fork/postgres-worker-child.mjs'),[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
      const prepared=new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('DB worker child timeout')),45000);child.once('message',r=>{clearTimeout(timer);r.error?bad(Error(r.error)):ok(r);});child.once('error',bad);});
      child.send({urls,localUrl,testPrivateKey:signer.privateKey,projectId:p,moduleId:m,sourceId,config,bundleDirectory:bundles});
      const ready=await prepared,before=await operation();assert.equal(ready.hash,before.tx_hash);
      assert.equal((await pass()).status,'busy');
      const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;child=null;
      const result=await pass();assert.equal(result.hash,before.tx_hash);assert.equal(result.status,'confirmed');
      assert.equal((await stored()).history.length,1);assert.equal((await stored()).operation,undefined);
    });
    await scenario('Receipt commit before worker-state commit resumes the same operation ID',async()=>{
      await assert.rejects(pass({hook:async phase=>{if(phase==='confirmed')throw Error('receipt committed');}}),/receipt committed/);
      const before=await stored();assert.ok(before.operation);
      const nonce=await provider.getTransactionCount(signer.address,'latest');
      const result=await pass();assert.equal(result.status,'confirmed');assert.equal(await provider.getTransactionCount(signer.address,'latest'),nonce);
      assert.equal((await stored()).operation,undefined);
      const bad={...await stored(),identity:'wrong'},saved=await stored();
      await admin.query('UPDATE launchpad.worker_states SET state_text=$3 WHERE project_id=$1 AND module_id=$2',[p,m,JSON.stringify(bad)]);
      await assert.rejects(pass(),/checksum/);
      await admin.query('UPDATE launchpad.worker_states SET state_text=$3 WHERE project_id=$1 AND module_id=$2',[p,m,JSON.stringify(saved)]);
    });
    const a=await alice.getAddress();await tx(quote.approve(curve.target,3119000000n));const buy=await tx(curve.buy(3119000000n,1,a));
    const raw=await provider.send('eth_getTransactionByHash',[buy.hash]),receipt=await provider.send('eth_getTransactionReceipt',[buy.hash]);
    const candidate=recognize(profile,raw,receipt)[0];assert.equal(candidate.status,'ELIGIBLE');
    const bundle={schema:'launchpad-local-recognition-v1',profileHash:digest(profile),candidates:[candidate.candidateId]},key=bundleHash(bundle);
    writeFileSync(resolve(bundles,key+'.json'),JSON.stringify(bundle));await tx(source.confirm(key,1));
    await provider.send('evm_setNextBlockTimestamp',[Math.floor(Date.now()/1000)]);await provider.send('evm_mine',[]);
    await scenario('Shared ledger and DB worker collect fees and preserve a snapshot across the save gap',async()=>{
      let interrupted=false;
      for(let n=0;n<25&&!interrupted;n++){
        try{await pass({hook:async phase=>{if(phase==='snapshot-saved')throw Error('snapshot gap');}});}
        catch(error){assert.match(error.message,/snapshot gap/);interrupted=true;}
      }
      assert.ok(interrupted);const before=await stored();assert.ok(before.snapshotIntent);assert.equal(before.cycles['1'],undefined);
      // Advance chain after the saved cutoff: recovery must not choose a new snapshot.
      await provider.send('evm_mine',[]);const result=await pass();assert.equal(result.action,'program.freeze');
      const state=await stored();assert.equal(state.cycles['1'].cutoff,before.snapshotIntent.cutoff);
      assert.equal(state.cycles['1'].participants[0].lastAttempt,'312');assert.equal(state.snapshotIntent,undefined);
      assert.equal(await program.cycle(),1n);assert.equal(await program.pending(),true);
    });
    const adapter=new Contract(await program.randomness(),['function requests(uint256) view returns(address consumer,bytes32 context,uint64 round,bool proven,bool delivered,bytes32 seed)'],provider);
    await scenario('RNG request is durably pinned before proof and survives its own save interruption',async()=>{
      await assert.rejects(pass({hook:async phase=>{if(phase==='rng-saved')throw Error('rng gap');}}),/rng gap/);
      const before=(await stored()).rng['1'];assert.ok(before.id&&before.round&&before.context);
      await pass({getBeacon:async()=>{throw Error('offline');}});assert.deepEqual((await stored()).rng['1'],before);
    });
    const request=await adapter.requests(await program.requestForCycle(1));
    console.log('DB worker waiting for fixed live drand round '+request.round);
    let beacon;const deadline=Date.now()+100000;
    for(;;){try{beacon=await fetchBeacon(Number(request.round));break;}catch(e){if(Date.now()>deadline)throw e;await new Promise(r=>setTimeout(r,2000));}}
    await provider.send('evm_setNextBlockTimestamp',[Math.max(GENESIS+(Number(request.round)-1)*PERIOD,(await provider.getBlock('latest')).timestamp+1)]);await provider.send('evm_mine',[]);
    await scenario('Proof, RNG delivery and settlement resume their signed DB operations after interruptions',async()=>{
      for(const action of ['adapter.prove','adapter.deliver','program.settle']){
        await assert.rejects(pass({getBeacon:async()=>beacon,hook:async(phase,intent)=>{if(phase==='broadcast'&&intent.action===action)throw Error('step gap');}}),/step gap/);
        const pending=await operation();assert.ok(pending);
        const restartPool=createPool(urls.executor);
        try{assert.equal((await pass({executorPool:restartPool,getBeacon:async()=>beacon})).hash,pending.tx_hash);}finally{await restartPool.end();}
      }
      assert.equal((await program.draws(1)).settled,true);assert.equal(await program.consumedThrough(a),312n);
      assert.equal((await stored()).rng['1'].round,String(request.round));
    });
    await scenario('Claim is paid once; completed passes and reorg cannot start a replacement draw',async()=>{
      const awarded=(await program.draws(1)).awarded,before=await quote.balanceOf(a);
      if(awarded>0n){
        await assert.rejects(pass({hook:async(phase,intent)=>{if(phase==='broadcast'&&intent.action==='program.claim')throw Error('claim gap');}}),/claim gap/);
        await pass();assert.equal(await quote.balanceOf(a)-before,awarded);
      }
      for(let n=0;n<5;n++)await pass();assert.equal(await program.liabilities(),0n);assert.equal(await program.cycle(),1n);
      const state=await stored();assert.equal(state.operation,undefined);
      const evm=await provider.send('evm_snapshot',[]);await tx(quote.approve(curve.target,1000000));await tx(curve.buy(1000000,1,a));
      assert.equal((await pass()).action,'collector.sweepCurve');const saved=await stored();await provider.send('evm_revert',[evm]);
      await assert.rejects(pass(),/reorg/);assert.deepEqual(await stored(),saved);
      report.postgresWorker={projects:[p],module:m,sourceId,history:state.history,cycle:state.cycles['1'],rng:state.rng['1'],awarded:String(awarded),scope:'Isolated fork82000000, live drand, shared PostgreSQL ledger and financial executor; no production cutover'};
    });
  }finally{
    if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
    await Promise.all([executorPool.end(),jobsPool.end(),ingestPool.end(),admin.end()]);
  }
}
