import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {BrowserProvider,Contract,keccak256} from 'ethers';
import {createDrawOwnerCoordinator} from '../../server/owner-launch/draw-coordinator.mjs';
import {createOwnerCoordinator} from '../../server/owner-launch/coordinator.mjs';
import {createTestPostgres} from '../contracts/production-postgres.mjs';
import {createPool} from '../../server/shared/store.mjs';
import {NETWORK,FACTORY} from '../../src/pons/client.mjs';
import {initialDraft} from '../../src/pons/plan.mjs';
import {USDG,ESCROW} from '../../server/studio/template.mjs';
import {qianqiPreset} from '../../src/draws/config.mjs';
import {upgradeProgramDraft} from '../../src/draws/program-config.mjs';
process.env.HARDHAT_CONFIG=path.resolve('tests/fork/production-hardhat.config.cjs');
const {default:hre}=await import('hardhat');const base=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});base.pollingInterval=10;
let finalized;
const provider=new Proxy(base,{get(t,k){if(k==='getBlock')return n=>t.getBlock(n==='finalized'?(finalized??'latest'):n);const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
const root='.local/test-results/draw-owner-'+new Date().toISOString().replace(/[:.]/g,'-');await fs.mkdir(root,{recursive:true});
const report={scenarios:[],limits:['Private historical fork4663; public RPC reads only','Finality modeled; fixture owner wallet','V2 ends deployed and disabled; no worker registration/UI integration']};
const scenario=async(name,fn)=>{await fn();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);};let db,adminPool;
try{
 const meta=await provider.send('hardhat_metadata',[]);report.fork=meta.forkedNetwork;assert.equal(meta.forkedNetwork.chainId,4663);
 await provider.send('evm_mine',[]);const addresses=await Promise.all(Array.from({length:10},async(_,i)=>(await provider.getSigner(i)).getAddress()));
 const owner=addresses[0],signer=await provider.getSigner(0),anchor=await provider.getBlock('latest');
 const factory=new Contract(NETWORK.factory,FACTORY,provider),externals={};
 for(const [role,address] of Object.entries({factory:NETWORK.factory,router:NETWORK.router,quote:USDG,escrow:ESCROW,hook:await factory.memeHook()}))externals[role]={address,codeHash:keccak256(await provider.getCode(address))};
 db=await createTestPostgres(root+'/postgres');adminPool=createPool(db.url('postgres'));
 const profiles=[];
 for(const [index,bps] of [10000,0,3700].entries())await scenario('Saved launch and recovery: '+['Short','Monthly','both'][index],async()=>{
  const profile={mode:'rehearsal',instanceId:meta.instanceId,owner,executor:addresses[1+index*2],publisher:addresses[2+index*2],anchor:{number:anchor.number,hash:anchor.hash},timing:{lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30},limits:{maxGasPrice:'100000000000',maxGasLimit:'15000000',nativeFloor:'100000'},funding:{executor:'1000000000000000',publisher:'1000000000000000'},totalNativeLimit:'2000000000000000000',externals};profiles.push(profile);
  const args={pool:db.pools.executor,adminPool,provider,profile};let co=createDrawOwnerCoordinator(args);
  const raw=qianqiPreset();raw.short.enabled=bps>0;raw.monthly.enabled=bps<10000;
  const input={id:randomUUID(),slug:'v2-'+randomUUID().slice(0,8),draft:{...initialDraft(),name:'Draw '+index,symbol:'DRAW',logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee',pair:USDG,creatorFee:'2',openingBuy:'0'},draws:upgradeProgramDraft(raw,bps),team:addresses[8],operations:addresses[9]};
  let state=await co.run(input.id,'create',{input});await assert.rejects(co.run(input.id,'create',{input:{...input,slug:'changed'}}),/immutable/);
  const v1=createOwnerCoordinator(args);await assert.rejects(v1.run(input.id,'next'),/profile\/input changed/);
  let steps=0;
  while(state.stage!=='deployed'){
   assert.ok(++steps<15);const candidate=state.candidate;assert.ok(candidate);
   state=await co.run(input.id,'arm',{requestId:candidate.id,revision:state.revision});
   const request={...state.pending.request};delete request.from;if(request.to===null)delete request.to;
   const sent=await signer.sendTransaction(request);await sent.wait();
   co=createDrawOwnerCoordinator(args);state=await co.run(input.id,'next');assert.equal(state.pending.id,candidate.id);
   await assert.rejects(co.run(input.id,'retry',{requestId:candidate.id}),/Nonce already used/);
   if(steps===1){finalized=anchor.number;state=await co.run(input.id,'attach',{requestId:candidate.id,hash:sent.hash});assert.ok(state.pending);assert.equal(state.history.length,0);finalized=undefined;state=await co.run(input.id,'next');}
   else state=await co.run(input.id,'attach',{requestId:candidate.id,hash:sent.hash});
  }
  assert.equal(state.executionEnabled,false);assert.equal(state.policy.schema,'draw-production-policy-v2');assert.equal(!!state.contracts.short,bps>0);assert.equal(!!state.contracts.monthly,bps<10000);
  const before=await provider.getTransactionCount(owner);const resumed=await createDrawOwnerCoordinator(args).run(input.id,'next');assert.equal(resumed.stage,'deployed');assert.equal(await provider.getTransactionCount(owner),before);assert.deepEqual(resumed.history,state.history);
  assert.equal(new Set(state.history.map(x=>x.nonce)).size,state.history.length);
  const row=(await db.admin.query('SELECT completed,state_text FROM launchpad.owner_launches WHERE project_id=$1',[input.id])).rows[0];assert.equal(row.completed,true);
  assert.equal((await db.admin.query('SELECT count(*) FROM launchpad.production_senders')).rows[0].count,'0');
  report[index]={id:input.id,token:state.launch.token,steps:state.history.map(x=>x.kind)};
 });
 await scenario('Public mode and changed profile cannot enable or resume sends',async()=>{
  assert.throws(()=>createDrawOwnerCoordinator({pool:db.pools.executor,adminPool,provider,profile:{...profiles[0],mode:'production'}}),/Rehearsal/);
  const changed=createDrawOwnerCoordinator({pool:db.pools.executor,adminPool,provider,profile:{...profiles[0],totalNativeLimit:'3000000000000000000'}});await assert.rejects(changed.run(report[0].id,'next'),/profile\/input changed/);
 });
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.shortMessage||e.message;console.error(e);process.exitCode=1;}
finally{await fs.writeFile(root+'/report.json',JSON.stringify(report,null,2));console.log(root+'/report.json');await adminPool?.end();await db?.close();base.destroy();}
