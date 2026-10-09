import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import solc from 'solc';
import { Contract, ContractFactory, id, Wallet } from 'ethers';
import { exerciseWorker } from './worker-scenarios.mjs';
import { exercisePostgresWorker } from './postgres-worker-scenarios.mjs';
import { providerFor, stringify, NETWORK } from '../../src/pons/client.mjs';
import { initialDraft, preparePlan, simulatePlan } from '../../src/pons/plan.mjs';
import { assertLocalFork, executeLocalLaunch, sendLocal } from '../../src/pons/local-execution.mjs';
import { createProfile, scanTickets, freezeTicketSnapshot, verifyTicketSettlement } from '../../src/tickets/scanner.mjs';
import { digest, snapshotTickets } from '../../src/tickets/ledger.mjs';
import { bundleHash } from '../../src/tickets/late-recognition.mjs';
import { validateConfig, amount } from '../../src/draws/config.mjs';
import { compute, QIANQI_RULES } from '../../src/draws/short-outcome.mjs';
import { GENESIS, PERIOD, fetchInfo, fetchLatest, fetchBeacon, deliverRequest } from '../../src/randomness/drand.mjs';

const config=JSON.parse(readFileSync('config/rehearsals/first-token.json','utf8'));
const postgresMode=process.argv.includes('--postgres-worker');
const workerMode=process.argv.includes('--worker')||postgresMode;
validateConfig(config.draws);
const report={startedAt:new Date().toISOString(),config,workerMode,scenarios:[],limits:[
  'Isolated local fork 31337, historical Pons block 82000000; synthetic buyer balances.',
  workerMode?'Live fixed-round draw with worker fault injection; no manual seed.':'Live draw uses one fixed future drand round. Separate no-winner fixture uses a manual test seed.',
  'Deferred direct buys only; no unknown router adapter or production finality/keeper.',
]};
const dir='.local/test-results/first-token-'+report.startedAt.replace(/[:.]/g,'-');mkdirSync(dir,{recursive:true});
const save=()=>writeFileSync(dir+'/report.json',stringify(report));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const tx=async promise=>(await promise).wait();
const scenario=async(name,fn)=>{await fn();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);save();};
let child,provider;
try {
  // Pick a fresh loopback port; never reset the user's running fork.
  const server=createServer();await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
  const port=server.address().port;await new Promise(r=>server.close(r));
  const log=openSync(dir+'/hardhat.log','a');
  child=spawn(process.execPath,['node_modules/hardhat/internal/cli/cli.js','node','--hostname','127.0.0.1','--port',String(port)],{
    env:{...process.env,PONS_FORK_BLOCK:'82000000',HARDHAT_CONFIG:resolve('hardhat.config.cjs')},stdio:['ignore',log,log],windowsHide:true,
  });closeSync(log);
  const localUrl='http://127.0.0.1:'+port;
  let ready=false;
  for(let i=0;i<60;i++){
    if(child.exitCode!==null)throw Error('Isolated fork failed to start; inspect ignored local log');
    try{const response=await fetch(localUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'hardhat_metadata',params:[]}),signal:AbortSignal.timeout(1000)});
      const {result:meta}=await response.json();assert.equal(meta.forkedNetwork.forkBlockNumber,82000000);ready=true;break;}catch{await sleep(500);}
  }
  assert.ok(ready,'Fork startup timeout');provider=providerFor(localUrl);provider.pollingInterval=50;await provider.send('evm_mine',[]);
  report.fork=await assertLocalFork(provider);
  const files=['LocalDrandShortProgram','LocalPonsFeeCollector','LocalFeeSplitter','LocalPurchaseRecognition'].map(n=>'contracts/draws/'+n+'.sol');
  const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:Object.fromEntries(files.map(file=>[file,{content:readFileSync(file,'utf8')}])),
    settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),
    {import:p=>{try{return {contents:readFileSync(p.startsWith('@')?resolve('node_modules',p):resolve(p),'utf8')};}catch{return {error:p};}}}));
  assert.deepEqual((output.errors??[]).filter(e=>e.severity==='error'),[]);
  const alice=await provider.getSigner(0),bob=await provider.getSigner(1),team=await provider.getSigner(2),ops=await provider.getSigner(3);
  const a=await alice.getAddress(),b=await bob.getAddress(),teamAddress=await team.getAddress(),opsAddress=await ops.getAddress();
  const deploy=async(name,args)=>{const file='contracts/draws/'+name+'.sol',art=output.contracts[file][name];const c=await new ContractFactory(art.abi,art.evm.bytecode.object,alice).deploy(...args);await c.waitForDeployment();return c;};
  const quote=new Contract('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',[
    'function balanceOf(address) view returns(uint256)','function approve(address,uint256) returns(bool)','function transfer(address,uint256) returns(bool)',
  ],alice);
  const escrow='0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e';
  assert.ok(await quote.balanceOf(escrow)>=4030000000n,'Historical fixture has insufficient USDG');
  await provider.send('hardhat_impersonateAccount',[escrow]);await provider.send('hardhat_setBalance',[escrow,'0x56bc75e2d63100000']);
  try{for(const [recipient,value] of [[a,4000000000n],[b,30000000n]]){
    const hash=await provider.send('eth_sendTransaction',[{from:escrow,to:quote.target,data:quote.interface.encodeFunctionData('transfer',[recipient,value])}]);await provider.waitForTransaction(hash);
  }}finally{await provider.send('hardhat_stopImpersonatingAccount',[escrow]);}
  const timing={lead:60,clockLag:5,clockAhead:5,finalizedLag:5,beaconLag:10};
  const short=config.draws.short,fees=config.draws.fees;
  const operator=workerMode?Wallet.createRandom().connect(provider):alice;
  if(workerMode)await provider.send('hardhat_setBalance',[operator.address,'0x56bc75e2d63100000']);
  const program=(await deploy('LocalDrandShortProgram',[quote.target,await operator.getAddress(),short.intervalSeconds,amount(short.minimumFund),amount(short.basket.minimumUnit),short.basket.weights,timing])).connect(operator);
  const activation=Number(await program.lastTerminal());
  assert.ok(activation+86400<Math.floor(Date.now()/1000),'Historical fixture must precede first deadline');
  const splitter=await deploy('LocalFeeSplitter',[quote.target,program.target,teamAddress,opsAddress,[fees.prizesBps,fees.teamBps,fees.operationsBps]]);
  const collector=await deploy('LocalPonsFeeCollector',[quote.target,escrow,splitter.target,NETWORK.factory]);
  const source=await deploy('LocalPurchaseRecognition',[id('first-token-'+program.target),a]);
  const adapter=new Contract(await program.randomness(),output.contracts['contracts/draws/LocalDrandAdapter.sol'].LocalDrandAdapter.abi,alice);
  let launched,curve,profile,state,snapshot,budget;
  const path=dir+'/tickets.json',head=async()=>Number(BigInt(await provider.send('eth_blockNumber',[])));
  const persist=async journal=>writeFileSync(dir+'/launch-journal.json',stringify(journal));
  const sweep=async()=>{
    const before=await quote.balanceOf(collector.target);
    await tx(collector.sweepCurve());await tx(collector.collect());
    const received=await quote.balanceOf(collector.target)-before;
    assert.ok(received>0n);await tx(collector.forward());
    for(let lane=0;lane<3;lane++)if(await splitter.credit(lane)>0n)await tx(splitter.deliver(lane));
    return received;
  };
  await scenario('Pons launch binds USDG, creator 2%, collector and program',async()=>{
    const draft={...initialDraft(),name:config.name,symbol:config.symbol,logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee',pair:quote.target,creatorFee:config.creatorFee,feeWallet:collector.target,openingBuy:config.openingBuy};
    let plan=await preparePlan(provider,draft,a);const journal=[];
    for(const step of plan.steps)await sendLocal(provider,a,step,journal,persist,step.kind);
    plan=await simulatePlan(provider,await preparePlan(provider,draft,a));
    launched=await executeLocalLaunch(provider,plan,journal,persist);
    curve=new Contract(launched.curve,['function buy(uint256,uint256,address) returns(uint256)','function sweepFees(uint256)',
      'function creatorTaxBps() view returns(uint256)','function feeBps() view returns(uint256)',
      'function protocolFeeShareBps() view returns(uint256)','function quoteFeeBalance() view returns(uint256)','function creatorTaxBalance() view returns(uint256)',
      'function deployer() view returns(address)'],alice);
    assert.equal(await curve.creatorTaxBps(),200n);assert.equal(await curve.feeBps(),100n);
    assert.equal((await curve.deployer()).toLowerCase(),collector.target.toLowerCase());
    await assert.rejects(collector.sweepCurve(),/unbound/);
    await assert.rejects(collector.connect(bob).bind(launched.token),/binding authority/);
    await assert.rejects(collector.bind(quote.target),/launch binding/);
    await tx(collector.bind(launched.token));
    await assert.rejects(collector.bind(launched.token),/binding authority/);
    await assert.rejects(curve.sweepFees(0));
    profile=await createProfile(provider,{token:launched.token,program:program.target,launchBlock:launched.block,thresholdRaw:String(amount(config.draws.ticketPurchase)),instance:'first-token',recognition:{
      adapter:'local-verified-curve-v1',source:source.target,publisher:a,instanceId:await source.instanceId(),deferDirectBuys:true,
    }});
    writeFileSync(dir+'/profile.json',stringify(profile));
    report.deployment={...launched,program:program.target,splitter:splitter.target,collector:collector.target,recognition:source.target,adapter:adapter.target,activation};
    report.terms={baseBps:await curve.feeBps(),creatorBps:await curve.creatorTaxBps(),protocolShareBps:await curve.protocolFeeShareBps()};
  });
  if(workerMode){
    await (postgresMode?exercisePostgresWorker:exerciseWorker)({provider,signer:operator,config,profile,collector,program,quote,curve,source,alice,bob,dir,scenario,report,localUrl});
  }else{
  await scenario('Initial cooldown and fund below 50 prevent draw without resetting timer',async()=>{
    const people=[{wallet:a,firstAttempt:1,lastAttempt:1}];
    await assert.rejects(program.freeze.staticCall(people),/schedule/);
    await sweep();assert.ok(await program.freeFund()<50000000n);
    await provider.send('evm_setNextBlockTimestamp',[activation+86400]);await provider.send('evm_mine',[]);
    await assert.rejects(program.freeze.staticCall(people),/not ready/);
    assert.equal(await program.lastTerminal(),BigInt(activation));
  });
  await scenario('Real trading fees reach collector and split 80/15/5 exactly',async()=>{
    await tx(quote.approve(curve.target,3119000000n));await tx(curve.buy(3119000000n,1,a));
    await tx(quote.connect(bob).approve(curve.target,10000000n));await tx(curve.connect(bob).buy(10000000n,1,b));
    const base=await curve.quoteFeeBalance(),tax=await curve.creatorTaxBalance(),share=await curve.protocolFeeShareBps();
    const expected=tax+base-base*share/10000n;
    assert.equal(await sweep(),expected);
    const revenue=await splitter.totalReceived();budget=await program.freeFund();
    assert.equal(budget,revenue*8000n/10000n);assert.ok(budget>=50000000n);
    assert.equal(await quote.balanceOf(teamAddress),revenue*1500n/10000n);
    assert.equal(await quote.balanceOf(opsAddress),revenue*500n/10000n);
    assert.equal(budget+await quote.balanceOf(teamAddress)+await quote.balanceOf(opsAddress)+await splitter.roundingReserve(),revenue);
    assert.equal(await quote.balanceOf(collector.target),0n);
    report.fees={revenue,prizes:budget,team:await quote.balanceOf(teamAddress),operations:await quote.balanceOf(opsAddress),rounding:await splitter.roundingReserve()};
  });
  const bundles=dir+'/bundles';mkdirSync(bundles);
  const confirm=async candidate=>{
    const bundle={schema:'launchpad-local-recognition-v1',profileHash:digest(profile),candidates:[candidate.candidateId]};
    const key=bundleHash(bundle);writeFileSync(bundles+'/'+key+'.json',stringify(bundle));await tx(source.confirm(key,1));
    state=await scanTickets(provider,profile,path,await head(),{bundleDirectory:bundles});
  };
  await scenario('Verified delayed purchases produce tickets; frozen snapshot excludes waiting buyer',async()=>{
    state=await scanTickets(provider,profile,path,await head());
    assert.equal(state.wallets[a.toLowerCase()].tickets,'0');
    await confirm(state.blocks.flatMap(block=>block.events).find(e=>e.status==='WAITING_RECOGNITION'&&e.recipient===a.toLowerCase()));
    assert.equal(state.wallets[a.toLowerCase()].tickets,'312');assert.equal(state.wallets[a.toLowerCase()].remainder,'5000000');
    assert.equal(state.wallets[b.toLowerCase()],undefined);
    snapshot=await freezeTicketSnapshot(provider,profile,path,'daily-1',await head());
    assert.equal(snapshot.participants.length,1);
    assert.equal(snapshot.participants[0].lastAttempt,'312');
  });
  let requestId,request,beacon,seed,result;
  await scenario('Freeze commits to one future drand round and immutable budget/participants',async()=>{
    report.drandInfo=await fetchInfo();const before=await fetchLatest();
    const now=Math.floor(Date.now()/1000);assert.ok(Math.abs(now-(GENESIS+(before.round-1)*PERIOD))<20);
    await provider.send('evm_setNextBlockTimestamp',[now]);await tx(program.freeze(snapshot.participants));
    requestId=await program.requestForCycle(1);request=await adapter.requests(requestId);
    assert.ok(Number(request.round)>before.round);assert.ok(GENESIS+(Number(request.round)-1)*PERIOD>Date.now()/1000);
    assert.equal(await program.reserved(),budget);
    await assert.rejects(program.settle(snapshot.participants,id('manual')));
    report.randomness={requestId,round:request.round,freezeTime:now,wallAtFreeze:new Date().toISOString()};
  });
  await scenario('Confirmation after freeze only grants tickets to the next available snapshot',async()=>{
    await confirm(state.blocks.flatMap(block=>block.events).find(e=>e.status==='WAITING_RECOGNITION'&&e.recipient===b.toLowerCase()));
    assert.equal(state.wallets[b.toLowerCase()].tickets,'1');
    assert.deepEqual(await freezeTicketSnapshot(provider,profile,path,'daily-1',snapshot.cutoff),snapshot);
    assert.deepEqual(snapshotTickets(state,snapshot.cutoff).participants,snapshot.participants);
    assert.equal(await program.reserved(),budget);
  });
  console.log('Waiting for fixed future drand round '+request.round);save();
  const deadline=Date.now()+100000;
  for(;;){try{beacon=await fetchBeacon(Number(request.round));break;}catch(error){if(Date.now()>deadline)throw error;await sleep(2000);}}
  const due=GENESIS+(Number(request.round)-1)*PERIOD;
  await provider.send('evm_setNextBlockTimestamp',[Math.max(due,(await provider.getBlock('latest')).timestamp+1)]);await provider.send('evm_mine',[]);
  await scenario('BLS-authenticated draw settles and any sole winner receives the full fund',async()=>{
    seed=await deliverRequest(adapter,requestId,beacon);const draw=await program.draws(1);
    result=compute(draw.context,seed,snapshot.participants,QIANQI_RULES,[budget]);
    assert.ok(result.winners.length<=1);
    const receipt=await tx(program.settle(snapshot.participants,seed));
    await verifyTicketSettlement(provider,snapshot);
    assert.equal((await program.draws(1)).resultHash,result.resultHash);
    for(let i=0;i<result.winners.length;i++){
      const wallet=result.winners[i],before=await quote.balanceOf(wallet);
      assert.equal(result.amounts[i],budget);await tx(program.claim(1,wallet));
      assert.equal(await quote.balanceOf(wallet)-before,budget);
      await assert.rejects(program.claim(1,wallet));
    }
    assert.equal(await program.freeFund(),result.winners.length?0n:budget);
    assert.equal(await program.liabilities(),0n);assert.equal(await program.reserved(),0n);
    assert.equal(await program.consumedThrough(a),312n);assert.equal(await program.consumedThrough(b),0n);
    report.result={winners:result.winners,amounts:result.amounts,seed,beacon,resultHash:result.resultHash,settledAt:(await provider.getBlock(receipt.blockNumber)).timestamp};
  });
  await scenario('Next day starts from settlement; late buyer survives consumption of previous tickets',async()=>{
    state=await scanTickets(provider,profile,path,await head());
    const next=await freezeTicketSnapshot(provider,profile,path,'daily-2',await head());
    assert.deepEqual(next.participants,[{wallet:b.toLowerCase(),firstAttempt:'1',lastAttempt:'1'}]);
    assert.equal(await program.lastTerminal(),BigInt(report.result.settledAt));
    await assert.rejects(program.freeze.staticCall(next.participants),/schedule/);
    await provider.send('evm_setNextBlockTimestamp',[report.result.settledAt+86400-1]);await provider.send('evm_mine',[]);
    await assert.rejects(program.freeze.staticCall(next.participants),/schedule/);
    await provider.send('evm_setNextBlockTimestamp',[report.result.settledAt+86400]);await provider.send('evm_mine',[]);
    if(result.winners.length)await assert.rejects(program.freeze.staticCall(next.participants),/not ready/);
    else await program.freeze.staticCall(next.participants);
    assert.equal(await program.lastTerminal(),BigInt(report.result.settledAt));
  });
  await scenario('Separate deterministic no-winner fixture rolls fund and restarts 24-hour timer',async()=>{
    const fixture=await deploy('LocalShortProgram',[quote.target,a,86400,50000000,50000000,[1]]);
    await tx(quote.approve(fixture.target,50000000));await tx(fixture.fund(50000000));
    const people=[{wallet:b.toLowerCase(),firstAttempt:'1',lastAttempt:'1'}],start=Number(await fixture.lastTerminal());
    await provider.send('evm_setNextBlockTimestamp',[start+86400]);await tx(fixture.freeze(people));
    const draw=await fixture.draws(1);let chosen;
    for(let i=0;i<100;i++){const candidate=id('explicit-no-winner-test-'+i);if(!compute(draw.context,candidate,people,QIANQI_RULES,[50000000n]).winners.length){chosen=candidate;break;}}
    assert.ok(chosen);const settled=await tx(fixture.settle(people,chosen));
    const time=(await provider.getBlock(settled.blockNumber)).timestamp;
    assert.equal(await fixture.freeFund(),50000000n);assert.equal(await fixture.liabilities(),0n);
    assert.equal(await fixture.consumedThrough(b),1n);assert.equal(await fixture.lastTerminal(),BigInt(time));
    const next=[{wallet:b.toLowerCase(),firstAttempt:'2',lastAttempt:'2'}];
    await provider.send('evm_setNextBlockTimestamp',[time+86399]);await provider.send('evm_mine',[]);
    await assert.rejects(fixture.freeze.staticCall(next),/schedule/);
    await provider.send('evm_setNextBlockTimestamp',[time+86400]);await tx(fixture.freeze(next));
    assert.equal(await fixture.reserved(),50000000n);
    report.noWinnerFixture={program:fixture.target,seed:chosen,settledAt:time,manualTestSeed:true};
  });
  }
  report.status='PASS';
} catch(error){
  report.status='FAIL';report.error=String(error.shortMessage||error.message).replace(/https?:\/\/\S+/g,'[endpoint]');console.log('FAIL '+report.error);process.exitCode=1;
} finally {
  report.finishedAt=new Date().toISOString();save();console.log(dir+'/report.json');
  provider?.destroy();
  if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(3000)]);}
}
