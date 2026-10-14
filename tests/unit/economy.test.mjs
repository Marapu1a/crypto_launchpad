import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {economyCadence,rpcMeter} from '../../server/short-runtime/economy.mjs';
import {healthProblems} from '../../server/short-runtime/runtime.mjs';
const {retryDelay}=createRequire(import.meta.url)('../../server/adapters/qianqi/runtime/scripts/indexer-cadence.cjs');
const report=(status='waiting',reason='conditions')=>({schema:'short-runtime-health-v1',completedAt:new Date(1000000).toISOString(),projects:[{projectId:'igw',status,reason}]});
test('quiet needs three condition-only passes; pending/unknown and mixed projects stay fast',()=>{
 const next=economyCadence({random:()=>0});assert.equal(next(report()).delayMs,15000);next(report());assert.equal(next(report()).delayMs,300000);
 for(const reason of ['receipt-finality','beacon-time-finality','index-catchup','unknown'])assert.equal(next(report('waiting',reason)).delayMs,15000);
 assert.equal(next({projects:[...report().projects,...report('blocked','project-pass-failed').projects]}).delayMs,15000);
 assert.equal(next({projects:[{...report().projects[0],alerts:['low']}]}).delayMs,15000);
});
test('failure pacing capped, recovery resets, scheduled wait does not hide blocked state',()=>{
 const next=economyCadence({random:()=>0});const r=report('blocked','project-pass-failed');
 assert.deepEqual(Array.from({length:5},()=>next(r).delayMs),[60000,120000,300000,600000,600000]);
 next(report());assert.equal(next(r).delayMs,60000);
 r.schedule={delayMs:600000};assert.deepEqual(healthProblems(r,{now:1600000}),['igw:project-pass-failed']);assert.deepEqual(healthProblems(r,{now:1720001}),['stale-health']);
 assert.deepEqual([1,2,3,4,20].map(n=>retryDelay(60000,n,()=>0)),[60000,120000,300000,600000,600000]);
});
test('meter contains method counts only and snapshots cannot mutate counters',()=>{
 const m=rpcMeter();m.record('eth_call',true);m.record('eth_call',false);m.record('https://secret',false);const s=m.snapshot();s.eth_call.requests=999;
 assert.deepEqual(m.snapshot().eth_call,{requests:2,errors:1});assert.ok(!JSON.stringify(m.snapshot()).includes('secret'));
});
import {createServer} from 'node:http';
import {runtimeProvider} from '../../server/short-runtime/rpc-provider.mjs';
test('provider measures actual successful and failed HTTP RPC without parameters',async()=>{
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const q=JSON.parse(body);res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,...(q.method==='eth_chainId'?{result:'0x1237'}:q.method==='eth_blockNumber'?{result:'0x123'}:{error:{code:-32000,message:'test failure'}})}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const meter=rpcMeter(),provider=runtimeProvider('http://127.0.0.1:'+server.address().port,{meter,gate:async()=>{}});
 try{assert.equal(await provider.send('eth_blockNumber',[]),'0x123');await assert.rejects(provider.send('eth_getBalance',['0x'+'1'.repeat(40),'latest']));const m=meter.snapshot();assert.equal(m.eth_blockNumber.requests,1);assert.equal(m.eth_getBalance.errors,1);assert.ok(!JSON.stringify(m).includes('111111'));}finally{provider.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
