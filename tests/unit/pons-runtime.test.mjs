import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runPonsRuntime} from '../../server/shared/pons-runtime.mjs';
import budget from '../../server/shared/rpc-budget.cjs';
import {createServer} from 'node:http';
import {Wallet} from 'ethers';
async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),'pons-runtime-'));
 const config={mode:'rehearsal',lockFile:join(dir,'host.lock'),healthFile:join(dir,'health.json'),rpcBudget:{file:join(dir,'budget.json'),maxRequests:2,windowMs:3600000,intervalMs:0}};
 await budget.initializeBudget(config.rpcBudget.file,config.rpcBudget);
 try{await fn(config);}finally{await rm(dir,{recursive:true,force:true});}
}
test('host acquires lock before preparation, refuses second owner and releases on failure',()=>fixture(async c=>{
 let release,entered;const ready=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 const first=runPonsRuntime({...c,prepare:async()=>{entered();await hold;throw Error('setup failure');}});
 await ready;await assert.rejects(runPonsRuntime({...c,prepare:()=>{throw Error('must not prepare');}}),{code:'EEXIST'});
 release();await assert.rejects(first,/setup failure/);
 await assert.rejects(readFile(c.lockFile),{code:'ENOENT'});
 let restarted=false;await assert.rejects(runPonsRuntime({...c,prepare:()=>{restarted=true;throw Error('restarted');}}),/restarted/);assert.ok(restarted);
}));
test('rehearsal host rejects public endpoints and production mode before execution',()=>fixture(async c=>{
 await assert.rejects(runPonsRuntime({...c,mode:'production',prepare:()=>{throw Error('unexpected');}}),/Invalid Pons/);
 await assert.rejects(runPonsRuntime({...c,prepare:({provider})=>provider('https://example.com')}),/loopback/);
}));
test('production activation cannot select QuickNode or an unapproved host',()=>fixture(async c=>{
 for(const url of ['https://one.quiknode.pro/key','https://unapproved.example/key','http://approved.example/key']){
  await assert.rejects(runPonsRuntime({...c,mode:'production',allowPublicTransactions:true,allowedRpcHosts:['approved.example','one.quiknode.pro'],prepare:({provider})=>provider(url)}),/Unapproved RPC host/);
 }
}));
test('budget exhaustion across host restart preserves saved work and rejects before network',()=>fixture(async c=>{
 const journal=join(c.lockFile,'..','pending.json');await writeFile(journal,'{"pending":"signed-intent"}');
 await budget.persistentRpcGate(c.rpcBudget)([{},{}]);
 const prepare=async({provider})=>{await provider('http://127.0.0.1:1').send('eth_chainId',[]);throw Error('unreachable');};
 for(let i=0;i<2;i++)await assert.rejects(runPonsRuntime({...c,prepare}),{code:'RPC_BUDGET_EXHAUSTED'});
 assert.equal(JSON.parse(await readFile(c.rpcBudget.file)).used,2);
 assert.equal(await readFile(journal,'utf8'),'{"pending":"signed-intent"}');
}));
test('gated loopback bootstrap validates adapter and graceful stop closes resources',()=>fixture(async c=>{
 const stop=new AbortController();let closed=0;
 const server=createServer(async(req,res)=>{let body='';for await(const x of req)body+=x;const q=JSON.parse(body);
  const result=q.method==='eth_chainId'?'0x1237':{clientVersion:'Hardhat',chainId:4663,instanceId:'0x'+'1'.repeat(64)};
  res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
  if(q.method==='hardhat_metadata')stop.abort();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  await runPonsRuntime({...c,signal:stop.signal,prepare:async({provider})=>{
   const p=provider('http://127.0.0.1:'+server.address().port);
   return {close:async()=>{closed++;},projects:[{id:'qianqi',adapter:'qianqi',publish:async()=>{},input:{provider:p,executor:Wallet.createRandom().connect(p),loadReport:async()=>({})}}]};
  }});
  assert.equal(closed,1);await assert.rejects(readFile(c.lockFile),{code:'ENOENT'});
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}));
