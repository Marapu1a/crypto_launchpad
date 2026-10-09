import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
import {createRequire} from 'node:module';
import {Wallet,keccak256} from 'ethers';
import {sharedApi} from '../../server/shared/api.mjs';
import {inspectSavedState} from '../../server/adapters/qianqi/adoption.mjs';
const require=createRequire(import.meta.url);
const {hash}=require('../../server/adapters/qianqi/runtime/scripts/direct-buy.cjs');
const {createHandler}=require('../../server/adapters/qianqi/runtime/scripts/user-status-api.cjs');
const {createBoundary}=require('../../server/adapters/qianqi/runtime/scripts/pons-transaction-journal.cjs');
const {withFence}=require('../../server/adapters/qianqi/fence.cjs');

test('shared API selects native project handler by trusted Host; rejects cross-project query and writes',async t=>{
 const seen=[];
 const reader={read:async q=>{seen.push(q);return {schema:'promo-overview-v1',status:'observed',project:'qianqi'};},close(){}};
 const adapter=createHandler(null,{reader});
 const pool={query:async(sql,[host])=>({rows:[{id:host==='q.localhost'?'q':host==='other.localhost'?'other':null}]})};
 const server=createServer(sharedApi(pool,{projectAdapters:new Map([['q',adapter]])}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{adapter.close();server.close(r);server.closeAllConnections();}));
 const get=(url,host='q.localhost',extra={})=>new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:url,headers:{Host:host,'X-Forwarded-Host':'q.localhost'},...extra},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});req.on('error',reject);req.end();});
 assert.equal((await get('/v1/overview')).status,200);
 assert.equal((await get('/v1/overview','other.localhost')).status,404);
 assert.equal((await get('/v1/overview','unknown.localhost')).status,421);
 assert.equal((await get('/v1/overview?project_id=other')).status,400);
 assert.equal((await get('/v1/overview?limit=25&limit=30')).status,400);
 assert.equal((await get('/v1/overview','q.localhost',{method:'POST'})).status,405);
 assert.equal(seen.length,1);
});

test('adoption preserves exact signed intent; rejects wrong identity, corrupt bytes and unsigned intent',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qianqi-adopt-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'state.json'),wallet=Wallet.createRandom(),to=Wallet.createRandom().address;
 const raw=await wallet.signTransaction({chainId:4663,nonce:7,to,value:0,data:'0x',gasLimit:21000,gasPrice:1});
 const state={schema:'local-scheduler-state-v1',configHash:hash({project:'q'}),jobs:{SHORT:[{draw:'frozen'}],MONTHLY:[{draw:'pendingMonth'}]},pending:{nonce:7,target:to,data:'0x',value:'0',transactionHash:keccak256(raw),signedTransaction:raw}};
 const save=()=>fs.writeFileSync(file,JSON.stringify({...state,checksum:hash(state)}));save();
 const before=fs.readFileSync(file),r=inspectSavedState(file,state.configHash,{sender:wallet.address});
 assert.equal(r.pending,true);assert.equal(r.monthlyJobs,1);assert.deepEqual(fs.readFileSync(file),before);
 assert.throws(()=>inspectSavedState(file,hash({project:'other'})),/identity/);
 assert.throws(()=>inspectSavedState(file,state.configHash,{sender:to}),/signed intent/);
 delete state.pending.transactionHash;save();assert.throws(()=>inspectSavedState(file,state.configHash),/unsigned intent/);
 fs.writeFileSync(file,JSON.stringify({...state,checksum:'wrong'}));assert.throws(()=>inspectSavedState(file,state.configHash),/checksum/);
});

test('lease failure after signing leaves durable same-hash intent and prevents broadcast',async()=>{
 const wallet=Wallet.createRandom(),target=Wallet.createRandom().address;
 const request={to:target,data:'0x',value:0,chainId:4663,nonce:3,gasLimit:21000,gasPrice:1};
 const state={pending:{target,data:'0x',value:'0'}},saved=[];let broadcasts=0;
 const signer={populateTransaction:async x=>x,signTransaction:x=>wallet.signTransaction(x)};
 const boundary=createBoundary({state,save:s=>saved.push(structuredClone(s)),provider:{broadcastTransaction:async()=>{broadcasts++;}},sender:wallet.address,signer});
 let checks=0;
 await assert.rejects(withFence(async()=>{if(++checks===2)throw Error('lease lost');},()=>boundary.broadcast(request)),/lease lost/);
 assert.equal(broadcasts,0);assert.equal(saved.length,1);assert.equal(keccak256(saved[0].pending.signedTransaction),saved[0].pending.transactionHash);
});

test('missing public fence rejects direct journal entry before signing or saving',async()=>{
 const network=require('../../server/adapters/qianqi/runtime/scripts/runtime-network.cjs'),original=network.current;
 let effects=0;
 network.current=()=>({mode:'robinhood-public'});
 try{
  const boundary=createBoundary({state:{pending:{}},save:()=>effects++,provider:{broadcastTransaction:()=>effects++},signer:{populateTransaction:()=>effects++,signTransaction:()=>effects++}});
  await assert.rejects(boundary.broadcast({}),/fence missing/);
  assert.equal(effects,0);
 }finally{network.current=original;}
});

test('lost lease before signing creates no signed intent',async()=>{
 let effects=0;
 const state={pending:{target:'unchanged'}};
 const boundary=createBoundary({state,save:()=>effects++,provider:{broadcastTransaction:()=>effects++},signer:{populateTransaction:()=>effects++,signTransaction:()=>effects++}});
 await assert.rejects(withFence(async()=>{throw Error('lease lost');},()=>boundary.broadcast({})),/lease lost/);
 assert.equal(effects,0);assert.deepEqual(state,{pending:{target:'unchanged'}});
});

test('direct public CLI refuses before parsing arguments or loading custody',async()=>{
 await assert.rejects(require('../../server/adapters/qianqi/runtime/scripts/run-pons-public.cjs').main(),/fence missing/);
});
