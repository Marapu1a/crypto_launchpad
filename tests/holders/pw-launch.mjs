import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {BrowserProvider,HDNodeWallet,keccak256,Contract} from 'ethers';
import {createTestPostgres} from '../contracts/production-postgres.mjs';
import {createPwOwnerCoordinator} from '../../server/owner-launch/pw-coordinator.mjs';
import {registerPwHolderHandoff,preparePwHolderHandoff} from '../../server/owner-launch/pw-handoff.mjs';
import {registerPwServiceHandoff} from '../../server/owner-launch/pw-service-handoff.mjs';
import {createPool} from '../../server/shared/store.mjs';
import {initialDraft} from '../../src/pons/plan.mjs';
import {FACTORY,NETWORK} from '../../src/pons/client.mjs';
import {compilePwLaunch} from '../../src/launch/pw-build.mjs';
const root='.local/test-results/pw-launch-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});
const report={status:'FAIL',checks:[],remoteReads:0,limits:['Local fork only; no public sends','Temporary funded Hardhat wallets; not production identities','Service registered locally, disabled; no production signing switch']};
const endpoint=readFileSync('.local/config/pons-rpc.txt','utf8').trim();assert.ok(new URL(endpoint).hostname.endsWith('.alchemy.com'));
const allowed=new Set(['eth_getTransactionReceipt','eth_getTransactionByHash','eth_chainId','eth_blockNumber','net_version','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getStorageAt','eth_getTransactionCount','eth_getBalance','eth_call']);
const cache=new Map();
async function remote(method,params){assert.ok(allowed.has(method),'Forbidden remote method');const key=JSON.stringify([method,params]);if(cache.has(key))return cache.get(key);
 assert.ok(++report.remoteReads<=300,'Remote read budget exhausted');
 const body=await (await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)})).json();
 if(body.error)throw Error('Remote read failed: '+body.error.code);cache.set(key,body.result);return body.result;
}
const bridge=createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;const q=JSON.parse(body);const call=async x=>{try{return {jsonrpc:'2.0',id:x.id,result:await remote(x.method,x.params)}}catch(e){return {jsonrpc:'2.0',id:x.id,error:{code:-32000,message:e.message}}}};res.setHeader('content-type','application/json');res.end(JSON.stringify(Array.isArray(q)?await Promise.all(q.map(call)):await call(q)));}catch{res.statusCode=500;res.end();}});
let db,provider;
try{
 await new Promise(r=>bridge.listen(0,'127.0.0.1',r));
 const anchor=await remote('eth_getBlockByNumber',['latest',false]);report.fork={number:parseInt(anchor.number,16),hash:anchor.hash};
 process.env.HARDHAT_CONFIG=resolve('tests/contracts/production-worker-hardhat.config.cjs');
 const {default:hre}=await import('hardhat');
 await hre.network.provider.send('hardhat_reset',[{forking:{jsonRpcUrl:'http://127.0.0.1:'+bridge.address().port,blockNumber:report.fork.number}}]);
 provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 await provider.send('evm_mine',[]);
 const signing=HDNodeWallet.fromPhrase('test test test test test test test test test test test junk'),owner=signing.address;
 const roles=await Promise.all([1,2,3].map(async i=>(await provider.getSigner(i)).getAddress()));
 const pins=JSON.parse(readFileSync('config/pons-production-pins.json','utf8')).pins;
 const profile={mode:'pw-fork-rehearsal',executionEnabled:false,instanceId:(await provider.send('hardhat_metadata',[])).instanceId,owner,executor:roles[0],publisher:roles[1],project:roles[2],maxGasLimit:'15000000',maxFeePerGas:'3000000000',totalNativeLimit:'1000000000000000000',timing:{lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30},externals:{...Object.fromEntries(['factory','router','escrow','hook'].map(k=>[k,pins[k]])),launchDeployer:{address:'0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42',codeHash:'0xeade22566c766377f6adfb99534f2772251efad9568642c0704a7051418e624c'}}};
 const preparation=JSON.parse(readFileSync('tokens/PatternWatcher/preparation.json','utf8'));
 db=await createTestPostgres(root+'/postgres');
 const make=()=>createPwOwnerCoordinator({pool:db.pools.executor,provider,profile,preparation});let coordinator=make();
 const input={id:'99999999-9999-4999-8999-999999999999',slug:'pw-fork',draft:{...initialDraft(),name:'Pattern Watcher rehearsal',symbol:'PWTEST',logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee'}};
 let state=await coordinator.prepare(input);assert.equal(state.steps.length,9);
 const quote=await coordinator.quote(input.id);assert.equal(quote.kind,'vault');assert.equal(quote.request.nonce,state.steps[0].request.nonce);assert.equal(quote.authorizationToSend,false);report.quote=quote;
 assert.deepEqual((await coordinator.prepare(input)).steps,state.steps);
 await assert.rejects(coordinator.prepare({...input,slug:'different'}),/input changed/);
 const sign=async(step,extra={})=>signing.signTransaction({...step.request,type:2,gasLimit:15000000,maxFeePerGas:3000000000,maxPriorityFeePerGas:1000000000,...extra});
 await assert.rejects(coordinator.record(input.id,await sign(state.steps[0],{value:1})),/mismatch/);
 for(let i=0;i<9;i++){
  const step=state.steps[i],raw=await sign(step);await coordinator.record(input.id,raw);
  coordinator=make();state=await coordinator.read(input.id);assert.equal(state.pending.raw,raw);
  assert.equal((await coordinator.resolve(input.id)).history.length,i);
  await assert.rejects(coordinator.record(input.id,await sign(step,{maxPriorityFeePerGas:0})),/pending/);
  // Long interruption before token creation must not start the monthly clock early.
  if(i===4){await provider.send('evm_increaseTime',[40*86400]);await provider.send('evm_mine',[]);}
  const sent=await coordinator.broadcast(input.id);assert.equal(sent.hash,state.pending.hash);assert.equal((await coordinator.broadcast(input.id)).replayed,true);
  if(i===4){
   const localBridge=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const q=JSON.parse(body);try{res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result:await provider.send(q.method,q.params)}));}catch(e){res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:e.message}}));}});
   await new Promise(r=>localBridge.listen(0,'127.0.0.1',r));
   try{const job=resolve(root,'restart.json');writeFileSync(job,JSON.stringify({rpc:'http://127.0.0.1:'+localBridge.address().port,id:input.id,profile,preparation}));
    const {stdout}=await promisify(execFile)(process.execPath,['tests/holders/restart-launch-worker.mjs',job],{windowsHide:true,env:{...process.env,PW_TEST_DB:db.url('lp_executor')},timeout:60000});
    const result=JSON.parse(stdout.trim());assert.equal(result.before,4);assert.equal(result.after,5);report.checks.push('Fresh keyless process resolves the real Pons launch receipt from PostgreSQL after lost broadcast response');
   }finally{await new Promise(r=>localBridge.close(r));}
  }
  coordinator=make();state=await coordinator.resolve(input.id);assert.equal(state.history.length,i+1);
  assert.equal((await coordinator.resolve(input.id)).history.length,i+1);
 }
 assert.equal(state.stage,'deployed');assert.equal(state.pending,null);assert.equal(state.finality.ready,true);
 const artifact=compilePwLaunch().artifacts.PwNativeShortProgram,draw=new Contract(state.addresses.draw,artifact.abi,await provider.getSigner(1));
 assert.equal(Number(await draw.lastTerminal()),state.launchAt);
 await assert.rejects(draw.bindLaunch());
 await assert.rejects(draw.freeze([],{number:1,blockHash:'0x'+'1'.repeat(64),timestamp:state.launchAt,ledgerHash:'0x'+'1'.repeat(64)}),/schedule/);
 const record=await new Contract(NETWORK.factory,FACTORY,provider).getLaunchedToken(state.scope.token);
 assert.equal(record.creatorFeeRecipient.toLowerCase(),state.addresses.collector.toLowerCase());assert.equal(record.creatorTaxBps,300n);
 assert.equal((await db.admin.query('SELECT completed FROM launchpad.owner_launches WHERE project_id=$1',[input.id])).rows[0].completed,true);
 const changed={...profile,instanceId:'wrong'};await assert.rejects(createPwOwnerCoordinator({pool:db.pools.executor,provider,profile:changed,preparation}).read(input.id),/journal\/profile/);
 await assert.rejects(createPwOwnerCoordinator({pool:db.pools.api,provider,profile,preparation}).read(input.id),/role|permission/i);
 const snapshot=await provider.send('evm_snapshot',[]);await provider.send('hardhat_setCode',[state.addresses.collector,'0x6000']);await assert.rejects(coordinator.read(input.id),/runtime changed/);await provider.send('evm_revert',[snapshot]);
 const settings={tokenCodeHash:state.contracts.token.codeHash,exclusions:[state.curve,profile.project,profile.owner,profile.executor,profile.publisher],maxHolders:100,maxRpcCalls:108,maxAgeSeconds:1800,maxGasLimit:'4000000',maxFeePerGas:'3000000000'};
 const handoffOptions={coordinator,projectId:input.id,provider,profile,preparation,settings,jobsPool:db.pools.jobs,executorPool:db.pools.executor,adminPool:db.pools.handoffAdmin??=createPool(db.url('postgres'))};
 await assert.rejects(preparePwHolderHandoff({...handoffOptions,settings:{...settings,exclusions:[]}}),/exclusions/);
 await assert.rejects(preparePwHolderHandoff({...handoffOptions,profile:{...profile,project:profile.owner}}),/differs/);
 const serviceOptions={...handoffOptions,pool:db.pools.executor,limits:{maxGasPrice:'3000000000',maxGasLimit:'15000000',nativeFloor:'100000'}};
 await assert.rejects(registerPwServiceHandoff(serviceOptions),/holder\/project handoff first/);
 const handoff=await registerPwHolderHandoff(handoffOptions);assert.equal(handoff.holderRegistered,true);assert.equal(handoff.program.launchAt,state.launchAt);assert.equal(handoff.program.schedulePolicy,'first-accepted-carry-v1');
 assert.deepEqual(await registerPwHolderHandoff(handoffOptions),handoff);report.handoff=handoff;
 const service=await registerPwServiceHandoff(serviceOptions);assert.equal(service.enabled,false);
 assert.deepEqual(await registerPwServiceHandoff(serviceOptions),service);
 await assert.rejects(registerPwServiceHandoff({...serviceOptions,limits:{...serviceOptions.limits,maxGasLimit:'14000000'}}),/conflict/);
 report.service={policyHash:service.policyHash,enabled:service.enabled};report.checks.push('PW draw/fee service policy verified against real fork graph; idempotent disabled registration; changed gas policy rejected');
 report.checks.push('Gas quote, reserved-byte broadcasting and duplicate send recovery; finalized graph hands off to holder preparation/execution idempotently, rejecting changed settings/profile');
 report.checks.push('Nine real-Pons graph steps with durable signed bytes, restart before/after each send, exact replay and unknown-operation exclusion','Independent owner/executor/publisher and RLS; wrong payload/profile/runtime rejected','40-day prelaunch interruption: first draw waits 30 days from actual token launch, not draw deployment','Full graph verified and finalized; project record marked complete without worker activation');
 report.gas={source:'local fork receipts; gas price and funding are fixture values',steps:[]};
 for(const entry of state.history){
  const receipt=await provider.getTransactionReceipt(entry.hash),tx=await provider.getTransaction(entry.hash);
  assert.equal(receipt.status,1);
  report.gas.steps.push({kind:entry.kind,gasUsed:receipt.gasUsed.toString(),valueWei:tx.value.toString()});
 }
 report.gas.totalGas=report.gas.steps.reduce((n,s)=>n+BigInt(s.gasUsed),0n).toString();
 report.gas.totalValueWei=report.gas.steps.reduce((n,s)=>n+BigInt(s.valueWei),0n).toString();
 report.graph={scope:state.scope,addresses:state.addresses,launchAt:state.launchAt,history:state.history,contracts:state.contracts};report.status='PASS';
}finally{writeFileSync(root+'/report.json',JSON.stringify(report,null,2));await db?.close();provider?.destroy();await new Promise(r=>bridge.close(r));console.log(root+'/report.json',report.status,'remote reads',report.remoteReads);}
