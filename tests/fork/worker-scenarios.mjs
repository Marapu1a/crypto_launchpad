import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { createWorkerConfig,runLocalWorker,recoverLocalWorkerLocks } from '../../src/worker/local-worker.mjs';
import { digest } from '../../src/tickets/digest.mjs';
import { bundleHash } from '../../src/tickets/late-recognition.mjs';
import { recognize } from '../../src/tickets/recognition.mjs';
import { fetchBeacon,GENESIS,PERIOD } from '../../src/randomness/drand.mjs';
const tx=async p=>(await p).wait();
const child=promisify(execFile);
export async function exerciseWorker({provider,signer,profile,collector,program,quote,curve,source,alice,bob,dir,scenario,report,localUrl}) {
  const root=resolve(dir,'worker'),bundles=resolve(dir,'worker-bundles');mkdirSync(bundles);
  const config=await createWorkerConfig(provider,{profile,collector:collector.target,executor:signer.address,
    limits:{maxGasPrice:'100000000000',maxGasLimit:'8000000',nativeFloor:'1000000000000000'}});
  const configPath=resolve(dir,'worker-config.json'),keyPath=resolve(dir,'ephemeral-local-key.txt');
  writeFileSync(configPath,JSON.stringify(config));writeFileSync(keyPath,signer.privateKey,{mode:0o600});
  const statePath=resolve(root,program.target.toLowerCase()+'.worker.json');
  const pass=options=>runLocalWorker({provider,signer,config,root,bundleDirectory:bundles,...options});
  const cli=mode=>child(process.execPath,['scripts/run-local-worker.mjs',configPath,root,keyPath,localUrl,mode,bundles],{windowsHide:true});
  const stored=()=>JSON.parse(readFileSync(statePath,'utf8'));
  let count=0;
  await scenario('Worker persists signed intent before broadcast; dead process recovery repeats identical hash',async()=>{
    await assert.rejects(child(process.execPath,['tests/fork/worker-child.mjs',configPath,root,keyPath,localUrl,bundles,'prepared'],{windowsHide:true}),e=>e.code===73);
    const intent=stored().pending;assert.ok(intent.raw);assert.equal(await provider.getTransactionReceipt(intent.hash),null);
    await assert.rejects(pass(),/EEXIST/);
    await cli('--recover-locks');
    const result=JSON.parse((await cli('--once')).stdout);assert.equal(result.hash,intent.hash);assert.equal(result.status,'confirmed');
    assert.equal(stored().history.length,1);assert.equal(stored().pending,undefined);count++;
  });
  await scenario('Mined transaction with lost process response is reconciled without a second send',async()=>{
    await assert.rejects(child(process.execPath,['tests/fork/worker-child.mjs',configPath,root,keyPath,localUrl,bundles,'broadcast'],{windowsHide:true}),e=>e.code===73);
    const intent=stored().pending,nonce=await provider.getTransactionCount(signer.address,'latest');
    assert.equal((await provider.getTransactionReceipt(intent.hash)).status,1);
    await recoverLocalWorkerLocks(provider,config,root);
    assert.equal((await pass()).hash,intent.hash);assert.equal(await provider.getTransactionCount(signer.address,'latest'),nonce);count++;
  });
  await scenario('Receipt-stage failure and unavailable RPC preserve the recoverable intent',async()=>{
    await assert.rejects(pass({hook:async phase=>{if(phase==='receipt')throw Error('Injected receipt interruption');}}),/Injected/);
    const before=readFileSync(statePath,'utf8'),hash=stored().pending.hash;
    const original=provider.getTransactionReceipt.bind(provider);provider.getTransactionReceipt=async()=>{throw Object.assign(Error('Injected RPC timeout'),{code:'TIMEOUT'});};
    try{await assert.rejects(pass(),/timeout/);}finally{provider.getTransactionReceipt=original;}
    assert.equal(readFileSync(statePath,'utf8'),before);assert.equal((await pass()).hash,hash);count++;
  });
  await scenario('Exclusive locks reject live competitor and unsafe recovery; checksum rejects corruption',async()=>{
    await assert.rejects(pass({hook:async phase=>{if(phase==='prepared'){
      await assert.rejects(pass(),/EEXIST/);await assert.rejects(recoverLocalWorkerLocks(provider,config,root),/still alive/);
      throw Error('Lock test interruption');
    }}}),/Lock test/);
    const saved=readFileSync(statePath,'utf8'),bad=JSON.parse(saved);bad.identity='wrong';writeFileSync(statePath,JSON.stringify(bad));
    await assert.rejects(pass(),/checksum/);writeFileSync(statePath,saved);await pass();count++;
  });
  // Trade volume reaches the configured 50 USDG floor. Confirmation remains a separate publisher action.
  const a=await alice.getAddress();await tx(quote.approve(curve.target,3119000000n));
  const bought=await tx(curve.buy(3119000000n,1,a));
  const rawTx=await provider.send('eth_getTransactionByHash',[bought.hash]),receipt=await provider.send('eth_getTransactionReceipt',[bought.hash]);
  const candidate=recognize(profile,rawTx,receipt)[0];assert.equal(candidate.status,'ELIGIBLE');
  const bundle={schema:'launchpad-local-recognition-v1',profileHash:digest(profile),candidates:[candidate.candidateId]},key=bundleHash(bundle);
  writeFileSync(resolve(bundles,key+'.json'),JSON.stringify(bundle));await tx(source.confirm(key,1));
  await provider.send('evm_setNextBlockTimestamp',[Math.floor(Date.now()/1000)]);await provider.send('evm_mine',[]);
  await scenario('Worker autonomously collects/splits fees and freezes one indexed draw',async()=>{
    for(let i=0;i<20&&!await program.pending();i++){const step=await pass();assert.notEqual(step.status,'blocked');}
    assert.equal(await program.pending(),true);assert.equal(await program.cycle(),1n);
    const snapshot=stored().cycles['1'];assert.equal(snapshot.participants.length,1);assert.equal(snapshot.participants[0].lastAttempt,'312');
    report.workerRequest={id:String(await program.requestForCycle(1)),snapshotHash:snapshot.snapshotHash};
  });
  const adapter=new (await import('ethers')).Contract(await program.randomness(),[
    'function requests(uint256) view returns(address consumer,bytes32 context,uint64 round,bool proven,bool delivered,bytes32 seed)',
  ],provider);
  const request=await adapter.requests(1);report.workerRequest.round=String(request.round);
  assert.ok(GENESIS+(Number(request.round)-1)*PERIOD>Date.now()/1000,'Round must still be unpublished');
  console.log('Worker waiting for fixed future round '+request.round);
  let beacon;const deadline=Date.now()+100000;
  for(;;){try{beacon=await fetchBeacon(Number(request.round));break;}catch(error){if(Date.now()>deadline)throw error;await new Promise(r=>setTimeout(r,2000));}}
  await provider.send('evm_setNextBlockTimestamp',[Math.max(GENESIS+(Number(request.round)-1)*PERIOD,(await provider.getBlock('latest')).timestamp+1)]);await provider.send('evm_mine',[]);
  await scenario('Unavailable beacon does not select another round; proof/delivery/settlement resume independently',async()=>{
    const round=(await adapter.requests(1)).round;
    const unavailable=await pass({getBeacon:async()=>{throw Error('offline');}});assert.notEqual(unavailable.action,'adapter.prove');
    assert.equal((await adapter.requests(1)).round,round);
    for(const action of ['adapter.prove','adapter.deliver','program.settle']){
      await assert.rejects(pass({getBeacon:async()=>beacon,hook:async(phase,intent)=>{if(phase==='broadcast'&&intent.action===action)throw Error('Injected '+action);}}),/Injected/);
      const intent=stored().pending;assert.equal(intent.action,action);
      const result=JSON.parse((await cli('--once')).stdout);assert.equal(result.hash,intent.hash);
    }
    assert.equal((await program.draws(1)).settled,true);assert.equal(await program.consumedThrough(a),312n);
  });
  await scenario('Payout and subsequent passes are idempotent; confirmed history reorg halts',async()=>{
    const awarded=(await program.draws(1)).awarded,before=await quote.balanceOf(a);
    if(awarded>0n){
      await assert.rejects(pass({hook:async(phase,intent)=>{if(phase==='broadcast'&&intent.action==='program.claim')throw Error('Injected payout');}}),/Injected payout/);
      await pass();assert.equal(await quote.balanceOf(a)-before,awarded);
    }
    for(let i=0;i<5;i++)await pass();assert.equal(await program.liabilities(),0n);assert.equal(await program.cycle(),1n);
    report.worker={history:stored().history,recoveredFaults:count,awarded:String(awarded),manualLockRecovery:true};
    const evm=await provider.send('evm_snapshot',[]);
    await tx(quote.approve(curve.target,1000000));await tx(curve.buy(1000000,1,a));
    const sweep=await pass();assert.equal(sweep.action,'collector.sweepCurve');
    const saved=readFileSync(statePath,'utf8');await provider.send('evm_revert',[evm]);
    await assert.rejects(pass(),/reorg/);assert.equal(readFileSync(statePath,'utf8'),saved);
  });
}
