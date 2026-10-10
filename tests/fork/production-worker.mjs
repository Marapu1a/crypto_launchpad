import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {BrowserProvider,Contract,ContractFactory,HDNodeWallet,AbiCoder,id,keccak256} from 'ethers';
import {compileProduction} from '../../src/worker/production-build.mjs';
import {NETWORK,FACTORY,receiptLaunch,stringify} from '../../src/pons/client.mjs';
import {initialDraft,preparePlan,simulatePlan} from '../../src/pons/plan.mjs';
import {createTestPostgres} from '../contracts/production-postgres.mjs';
import {registerProductionSender} from '../../server/shared/production-sender.mjs';
import {runProductionWorker} from '../../server/shared/production-worker.mjs';
import {verifyTemplate} from '../../src/worker/production-template.mjs';
import {creditedPurchases,snapshotProductionTickets} from '../../src/tickets/production-ledger.mjs';
import {replayTickets} from '../../src/tickets/ledger.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {fetchLatest,fetchBeacon,GENESIS,PERIOD} from '../../src/randomness/drand.mjs';
import {compute,QIANQI_RULES} from '../../src/draws/short-outcome.mjs';
import batch from '../../src/qianqi/routes/pons-batch-buy.cjs';
import pins from '../../src/qianqi/routes/genesis-fields.json' with {type:'json'};

process.env.HARDHAT_CONFIG=resolve('tests/fork/production-hardhat.config.cjs');
const {default:hre}=await import('hardhat');
const base=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});base.pollingInterval=20;
let clock,finality;
const provider=new Proxy(base,{get(target,name){
  if(name==='getBlock')return n=>target.getBlock(n==='finalized'?(finality??'latest'):n);
  const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;
}});
// Keep the historical rehearsal clock deterministic for all locally mined transactions.
const originalRequest=hre.network.provider.request.bind(hre.network.provider);
hre.network.provider.request=async args=>{
  if(clock!==undefined && ['eth_sendTransaction','eth_sendRawTransaction'].includes(args.method))await originalRequest({method:'evm_setNextBlockTimestamp',params:[clock]});
  return originalRequest(args);
};
const report={startedAt:new Date().toISOString(),scenarios:[],limits:[
  'Historical Pons fork block82000000, chain4663; no public transactions',
  'Synthetic USDG funding from impersonated escrow on isolated fork only',
  'Modeled finality/clock, historical BLS rounds; not a live future-entropy test',
  'Direct, opening and exact USDG self-batch only; native-funded/aggregator/pool routes remain separate',
]};
report.sourceHashes=Object.fromEntries([
  'tests/fork/production-worker.mjs','tests/fork/production-hardhat.config.cjs',
  'server/shared/production-worker.mjs','server/shared/production-sender.mjs',
  'src/worker/production-template.mjs','src/worker/production-journal.mjs',
  'src/tickets/production-ledger.mjs','src/tickets/production-recognition.mjs',
  'src/tickets/recognition.mjs','src/tickets/direct-curve.cjs',
  'src/qianqi/routes/ordinary-batch.cjs','src/qianqi/routes/pons-batch-buy.cjs',
].map(file=>[file,keccak256(Buffer.from(readFileSync(file,'utf8').replaceAll('\r\n','\n')))]));
const root='.local/test-results/production-pons-fork-'+report.startedAt.replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});
const persist=()=>writeFileSync(root+'/report.json',stringify(report));
const scenario=async(name,fn)=>{await fn();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);persist();};
const tx=async p=>(await p).wait();
let db;
try{
  const meta=await provider.send('hardhat_metadata',[]);
  assert.equal(meta.chainId,4663);assert.equal(meta.forkedNetwork.chainId,4663);assert.equal(meta.forkedNetwork.forkBlockNumber,82000000);
  report.fork=meta.forkedNetwork;
  assert.equal(keccak256(await provider.getCode(NETWORK.factory)),NETWORK.factoryHash);
  const forkHead=await provider.getBlock('latest');clock=forkHead.timestamp+1;
  await provider.send('evm_setNextBlockTimestamp',[clock]);await provider.send('evm_mine',[]);
  const target=await fetchLatest(),before=await fetchBeacon(target.round-1201);
  const targetTime=GENESIS+(target.round-1)*PERIOD,freezeTime=targetTime-3601;
  assert.ok(freezeTime>clock+86400,'Historical fork too recent for daily rehearsal');
  writeFileSync(root+'/beacons.json',stringify({before,target}));
  const build=compileProduction();report.buildHash=build.manifest.buildHash;
  assert.equal(report.buildHash,'0x24fe240da110404159ec3b3695b4b4c1dd6a312f4dabf60e261f7880207c9ad1');
  const alice=await provider.getSigner(0),bob=await provider.getSigner(1),a=await alice.getAddress(),b=await bob.getAddress();
  const wallet=n=>HDNodeWallet.fromPhrase('test test test test test test test test test test test junk',undefined,"m/44'/60'/0'/0/"+n).connect(provider);
  const buyer=wallet(2),executor=wallet(3),publisher=wallet(4),team=wallet(5).address,operations=wallet(6).address;
  const quote=new Contract('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',[
    'function balanceOf(address) view returns(uint256)','function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)',
  ],alice);
  const escrow='0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e',batchExecutor=pins.pins.batchExecutor[0];
  await scenario('Pinned actual Pons/USDG runtimes and synthetic balances on private fork',async()=>{
    assert.ok(await quote.balanceOf(escrow)>=4100000000n);
    assert.equal(keccak256(await provider.getCode(batchExecutor)),pins.pins.batchExecutor[1]);
    await provider.send('hardhat_impersonateAccount',[escrow]);await provider.send('hardhat_setBalance',[escrow,'0x56bc75e2d63100000']);
    try{for(const [recipient,value] of [[a,4000000000n],[b,30000000n],[buyer.address,30000000n]]){
      const hash=await provider.send('eth_sendTransaction',[{from:escrow,to:quote.target,data:quote.interface.encodeFunctionData('transfer',[recipient,value])}]);
      assert.equal((await provider.getTransactionReceipt(hash)).status,1);
    }}
    finally{await provider.send('hardhat_stopImpersonatingAccount',[escrow]);}
  });
  const deploy=async(name,args)=>{const art=build.artifacts[name],c=await new ContractFactory(art.abi,art.evm.bytecode.object,alice).deploy(...args);await c.waitForDeployment();return c;};
  const timing={lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30};
  const projectId='c5897d1a-def5-4c9f-a7bb-a76f2b16519e',instanceId=id('actual-pons-production-rehearsal');
  const program=await deploy('ShortProgram',[{asset:quote.target,operator:executor.address,instance:instanceId,interval:86400,minimumFund:50000000,minimumUnit:50000000},[1],timing]);
  const adapter=new Contract(await program.randomness(),build.artifacts.ShortDrandAdapter.abi,alice);
  const splitter=await deploy('FeeSplitter',[quote.target,program.target,team,operations,[8000,1500,500]]);
  const collector=await deploy('PonsFeeCollector',[quote.target,escrow,splitter.target,NETWORK.factory]);
  const recognition=await deploy('PurchaseRecognition',[instanceId,publisher.address]);
  let launch,anchor,curve,policy,args;
  const move=async timestamp=>{clock=timestamp;await provider.send('evm_setNextBlockTimestamp',[clock]);await provider.send('evm_mine',[]);};
  await scenario('Own launch plan creates TOKEN/USDG with opening buy and production collector',async()=>{
    const draft={...initialDraft(),name:'Production rehearsal',symbol:'RHR',logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee',pair:quote.target,creatorFee:'2',feeWallet:collector.target,openingBuy:'5'};
    let plan=await preparePlan(provider,draft,a);
    for(const step of plan.steps)await tx(alice.sendTransaction(step));
    plan=await simulatePlan(provider,await preparePlan(provider,draft,a));
    anchor=await provider.getBlock('latest');
    const receipt=await tx(alice.sendTransaction(plan.tx));launch={...receiptLaunch(receipt,a),block:receipt.blockNumber,hash:receipt.hash};
    assert.equal(launch.token,plan.token);assert.equal(launch.curve,plan.curve);await tx(collector.bind(launch.token));
    curve=new Contract(launch.curve,['function buy(uint256,uint256,address) returns(uint256)','function creatorTaxBps() view returns(uint256)',
      'function feeBps() view returns(uint256)','function protocolFeeShareBps() view returns(uint256)','function quoteFeeBalance() view returns(uint256)','function creatorTaxBalance() view returns(uint256)'],alice);
    assert.equal(await curve.creatorTaxBps(),200n);assert.equal(await curve.feeBps(),100n);
    const hook=(await new Contract(NETWORK.factory,FACTORY,provider).memeHook());
    policy={schema:'short-production-policy-v1',chainId:4663,projectId,executor:executor.address,publisher:publisher.address,buildHash:report.buildHash,
      anchor:{number:anchor.number,hash:anchor.hash},contracts:{},limits:{maxGasPrice:'100000000000',maxGasLimit:'15000000',nativeFloor:'100000'},timing,
      template:{schema:'short-template-v1',instanceId,thresholdRaw:'10000000',interval:'86400',minimumFund:'50000000',minimumUnit:'50000000',weights:[1],bps:[8000,1500,500],creatorTaxBps:200,team,operations}};
    for(const [kind,address] of Object.entries({program:program.target,adapter:adapter.target,splitter:splitter.target,collector:collector.target,recognition:recognition.target,
      token:launch.token,curve:launch.curve,quote:quote.target,escrow,factory:NETWORK.factory,router:NETWORK.router,hook,batchExecutor}))policy.contracts[kind]={address,codeHash:keccak256(await provider.getCode(address))};
    await verifyTemplate(provider,policy);
    report.deployment={...launch,program:program.target,collector:collector.target,splitter:splitter.target};
    report.terms={baseBps:await curve.feeBps(),creatorBps:await curve.creatorTaxBps(),protocolShareBps:await curve.protocolFeeShareBps()};
    writeFileSync(root+'/policy.json',stringify(policy));
    db=await createTestPostgres(root+'/postgres');
    await db.admin.query("INSERT INTO launchpad.projects VALUES($1,'pons-rehearsal','Pons rehearsal',4663,$2,'test')",[projectId,launch.token.toLowerCase()]);
    await db.admin.query("INSERT INTO launchpad.module_instances VALUES($1,$1,'short','production-candidate-v1',$2,$3)",[projectId,program.target.toLowerCase(),digest(policy)]);
    await registerProductionSender({pool:db.pools.executor,provider,projectId,moduleId:projectId,policy});
    args={pool:db.pools.executor,provider,signer:executor,publisher,projectId,moduleId:projectId,now:()=>clock,getLatestBeacon:async()=>before,
      getBeacon:async round=>{assert.equal(round,target.round);return target;}};
  });
  const state=async()=>JSON.parse((await db.admin.query('SELECT state_text FROM launchpad.production_senders WHERE project_id=$1',[projectId])).rows[0].state_text);
  const pass=()=>runProductionWorker(args);
  const until=async(predicate,max=30)=>{for(let i=0;i<max;i++){if(await predicate())return;const result=await pass();report.lastPass=result;if(result.status==='blocked')throw Error('Worker blocked');}assert.ok(await predicate(),'Worker condition timeout');};
  let expectedRevenue;
  await scenario('Direct curve buys and real EIP-7702 approve+buy with new and existing delegation',async()=>{
    await move(freezeTime-120); // Mature the notice and leave historical snipe period.
    await tx(quote.approve(curve.target,3119000000n));await tx(curve.buy(3119000000n,1,a));
    await tx(quote.connect(bob).approve(curve.target,10000000n));await tx(curve.connect(bob).buy(10000000n,1,b));
    const calls=[[quote.target,0,batch.APPROVE.encodeFunctionData('approve',[curve.target,10000000])],[curve.target,0,curve.interface.encodeFunctionData('buy',[10000000,1,buyer.address])]];
    const data=batch.EXEC.encodeFunctionData('execute',[batch.MODE,AbiCoder.defaultAbiCoder().encode(batch.TYPES,[calls])]);
    const nonce=await provider.getTransactionCount(buyer.address);
    const authorization=await buyer.authorize({address:batchExecutor,chainId:4663,nonce:nonce+1});
    const first=await tx(buyer.sendTransaction({to:buyer.address,data,value:0,type:4,authorizationList:[authorization],gasLimit:1000000}));
    const second=await tx(buyer.sendTransaction({to:buyer.address,data,value:0,type:2,gasLimit:1000000}));
    report.batchBuys=[first.hash,second.hash];
    const baseFees=await curve.quoteFeeBalance(),creatorFees=await curve.creatorTaxBalance(),share=await curve.protocolFeeShareBps();
    expectedRevenue=creatorFees+baseFees-baseFees*share/10000n;
    report.expectedFees={baseFees,creatorFees,protocolShareBps:share,collectorRevenue:expectedRevenue};
    assert.ok(expectedRevenue*8000n/10000n>=50000000n);
  });
  await scenario('Actual escrow accounting reaches 80/15/5 and all four buy routes receive tickets',async()=>{
    await until(async()=>{const s=await state();return s.runtime && creditedPurchases(policy,s.runtime.ledger).length===5 && await program.freeFund()===expectedRevenue*8000n/10000n && await splitter.credit(1)===0n && await splitter.credit(2)===0n;});
    const s=await state(),events=creditedPurchases(policy,s.runtime.ledger),wallets=replayTickets(events,'10000000');
    assert.equal(events.filter(e=>e.reason==='OPENING_BUY').length,1);assert.equal(events.filter(e=>e.reason==='SUPPORTED_SELF_BATCH_BUY').length,2);
    assert.equal(wallets[a.toLowerCase()].tickets,'312');assert.equal(wallets[a.toLowerCase()].remainder,'4000000');
    assert.equal(wallets[b.toLowerCase()].tickets,'1');assert.equal(wallets[buyer.address.toLowerCase()].tickets,'2');
    assert.equal(await splitter.totalReceived(),expectedRevenue);assert.equal(await quote.balanceOf(team),expectedRevenue*1500n/10000n);
    assert.equal(await quote.balanceOf(operations),expectedRevenue*500n/10000n);assert.equal(await quote.balanceOf(collector.target),0n);
    report.tickets=wallets;report.revenue=expectedRevenue;
  });
  let snapshot;
  await scenario('Exact production artifacts freeze authenticated future round and preserve late tickets',async()=>{
    await move(freezeTime);await until(async()=>await program.pending());
    snapshot=(await state()).runtime.cycles['1'];const request=await adapter.requests(await program.requestForCycle(1));
    report.snapshot=snapshot;
    assert.equal(request.round,BigInt(target.round));assert.ok(GENESIS+(Number(request.round)-1)*PERIOD>clock);
    assert.equal(snapshot.budget,String(expectedRevenue*8000n/10000n));
    await tx(quote.connect(bob).approve(curve.target,10000000n));await tx(curve.connect(bob).buy(10000000n,1,b));
    await until(async()=>creditedPurchases(policy,(await state()).runtime.ledger).length===6);
    assert.deepEqual((await state()).runtime.cycles['1'],snapshot);
  });
  await scenario('BLS proof, independent outcome, settlement and idempotent claim through PostgreSQL',async()=>{
    await move(targetTime+30);await until(async()=>(await program.draws(1)).settled);
    const draw=await program.draws(1),rng=await adapter.requests(await program.requestForCycle(1));
    const expected=compute(draw.context,rng.seed,snapshot.participants,QIANQI_RULES,[BigInt(snapshot.budget)]);
    assert.equal(draw.resultHash,expected.resultHash);assert.equal(draw.awarded,expected.amounts.reduce((x,y)=>x+y,0n));
    await until(async()=>await program.liabilities()===0n);
    const balances=await Promise.all(expected.winners.map(w=>quote.balanceOf(w)));
    for(let i=0;i<3;i++)await pass();
    assert.deepEqual(await Promise.all(expected.winners.map(w=>quote.balanceOf(w))),balances);
    assert.equal(await program.cycle(),1n);
    const next=await snapshotProductionTickets(policy,(await state()).runtime.ledger,program);
    assert.deepEqual(next.participants,[{wallet:b.toLowerCase(),firstAttempt:'2',lastAttempt:'2'}]);
    report.outcome={round:target.round,resultHash:draw.resultHash,winners:expected.winners,amounts:expected.amounts,awarded:draw.awarded,liabilities:await program.liabilities(),next:next.participants};
  });
  report.status='PASS';
}catch(e){report.status='FAIL';const clean=v=>String(v).replace(/https?:\/\/[^\s"')]+/g,'[RPC URL redacted]');report.error=clean(e.shortMessage||e.message);report.detail=clean(e.stack+'\n'+JSON.stringify(e.info??{}));console.error(report.error);process.exitCode=1;}
finally{persist();console.log(root+'/report.json');await db?.close();base.destroy();}
