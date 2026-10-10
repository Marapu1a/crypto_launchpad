import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {sharedScanProvider} from '../../server/short-runtime/reader.mjs';
import {runtimePass,runRuntimeLoop,healthProblems} from '../../server/short-runtime/runtime.mjs';
import {validateRuntimeConfig,runtimeEnvironment} from '../../server/short-runtime/config.mjs';
import {replaceHealthFile} from '../../server/short-runtime/health-file.mjs';

test('Shared scan coalesces historical calls, copies evidence, keeps guards and latest fresh',async()=>{
 let calls=0,reads=0;const base={send:async()=>{calls++;return {transactions:[],value:1};},getBlock:async()=>{reads++;return {hash:String(reads)};}};
 const s=sharedScanProvider(base),p=s.provider;
 const [a,b]=await Promise.all([p.send('eth_getBlockByNumber',['0x1',true]),p.send('eth_getBlockByNumber',['0x1',true])]);
 assert.equal(calls,1);a.transactions.push('mutated');assert.deepEqual(b.transactions,[]);
 await p.getBlock(1);await p.getBlock(1);assert.equal(reads,2);
 await p.send('eth_getBlockByNumber',['latest',true]);await p.send('eth_getBlockByNumber',['latest',true]);assert.equal(calls,3);
 await sharedScanProvider(base).provider.send('eth_getBlockByNumber',['0x1',true]);assert.equal(calls,4);
});
test('Missing/error receipts are not cached; cache bounds survive in-flight eviction',async()=>{
 let n=0;const hash='0x'+'1'.repeat(64),s=sharedScanProvider({send:async()=>{if(++n===1)throw Error('RPC secret');return n===2?null:{data:'x'.repeat(500)};}},{maxEntries:1,maxBytes:20});
 await assert.rejects(s.provider.send('eth_getTransactionReceipt',[hash]));assert.equal(await s.provider.send('eth_getTransactionReceipt',[hash]),null);
 await Promise.all([s.provider.send('eth_getBlockByNumber',['0x1',true]),s.provider.send('eth_getBlockByNumber',['0x2',true])]);assert.ok(s.stats().bytes<=20);assert.equal(s.stats().entries,0);
});
test('Projects fail independently, disabled projects cannot execute, secrets stay out of health',async()=>{
 const signer={getAddress:async()=> 'owner'},provider={getBalance:async()=>0n};let calls=0;
 const projects=[{projectId:'broken',enabled:true,signer,publisher:signer},{projectId:'ok',enabled:true,signer,publisher:signer,nativeFloor:'1'},{projectId:'paused',enabled:false}];
 const report=await runtimePass({provider,projects,runWorker:async p=>{calls++;if(p.projectId==='broken')throw Error('https://secret');return {status:'waiting',reason:'conditions',raw:'privatekey'};}});
 assert.equal(calls,2);assert.deepEqual(report.projects.map(p=>p.status),['blocked','waiting','paused']);assert.ok(!JSON.stringify(report).includes('secret'));assert.ok(!JSON.stringify(report).includes('privatekey'));
 assert.deepEqual(healthProblems(report),['broken:project-pass-failed','ok:executor-native-low','ok:publisher-native-low']);
 assert.deepEqual(healthProblems(report,{now:Date.parse(report.completedAt)+120001}),['stale-health']);
 assert.deepEqual(healthProblems({...report,projects:[{projectId:'clock',status:'waiting',reason:'chain-clock'}]}),['clock:chain-clock']);
 assert.deepEqual(healthProblems({...report,projects:[{projectId:'bad'}]}),['invalid-health']);
});
test('Graceful stop drains active pass, publishes once and starts no further work',async()=>{
 const controller=new AbortController();let complete,published=0,passes=0;
 const loop=runRuntimeLoop({signal:controller.signal,intervalMs:100,pass:()=>{passes++;return new Promise(r=>complete=r);},publish:async()=>{published++;}});
 controller.abort();await Promise.resolve();assert.equal(published,0);complete({});await loop;assert.equal(passes,1);assert.equal(published,1);
});
test('Windows health replacement retries transient file locks with a fixed bound',async()=>{
 let calls=0;const args={platform:'win32',pause:async()=>{},replace:async()=>{if(++calls<3)throw Object.assign(Error('locked'),{code:'EPERM'});}};
 await replaceHealthFile('tmp','health',args);assert.equal(calls,3);
 calls=0;await assert.rejects(replaceHealthFile('tmp','health',{...args,replace:async()=>{calls++;throw Object.assign(Error('locked'),{code:'EBUSY'});}}));assert.equal(calls,6);
 calls=0;await assert.rejects(replaceHealthFile('tmp','health',{...args,platform:'linux'}));assert.equal(calls,1);
});
test('Explicit activation, pinned policy, unique projects and correct rehearsal instance required',async()=>{
 const file=resolve('fixture'),p={projectId:'a5897d1a-def5-4c9f-a7bb-a76f2b16519e',moduleId:'a5897d1a-def5-4c9f-a7bb-a76f2b16519e',policyHash:'a'.repeat(64),enabled:true,executor:{keyFile:file,passwordFile:file},publisher:{keyFile:file,passwordFile:file}};
 const c={schema:'short-runtime-config-v1',mode:'production',intervalMs:1000,concurrency:2,rpcFile:file,databaseFile:file,healthFile:file,projects:[p]};
 assert.throws(()=>validateRuntimeConfig(c),/activation/);assert.equal(validateRuntimeConfig({...c,allowPublicTransactions:true}).projects.length,1);
 assert.throws(()=>validateRuntimeConfig({...c,allowPublicTransactions:true,projects:[p,p]}),/duplicate/);
 await assert.rejects(runtimeEnvironment({getNetwork:async()=>({chainId:4663n}),send:async()=>({instanceId:'different',chainId:4663})},{mode:'rehearsal',instanceId:'expected'}),/instance/);
});
