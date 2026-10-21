import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import budget from '../../server/shared/rpc-budget.cjs';
import {runtimeProvider} from '../../server/short-runtime/rpc-provider.mjs';

test('PW reservations cannot consume the protected balance, survive restart and charge atomically',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rpc-economy-')),file=join(dir,'budget.json');
 try{
  const policy={file,maxRequests:10,windowMs:3600000,intervalMs:0};await budget.initializeBudget(file,policy);
  const pw=budget.persistentRpcGate({...policy,reserveRequests:5}),live=budget.persistentRpcGate(policy);
  const results=await Promise.allSettled([pw.reserve(4),pw.reserve(4)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'RPC_BUDGET_EXHAUSTED');
  const credit=results.find(r=>r.status==='fulfilled').value;
  await credit([{},{}]);await credit([{},{}]);await assert.rejects(credit({}),{code:'RPC_OPERATION_TOO_LARGE'});
  assert.equal(JSON.parse(await readFile(file)).used,4);
  await assert.rejects(budget.persistentRpcGate({...policy,reserveRequests:5}).reserve(6),{code:'RPC_OPERATION_TOO_LARGE'});
  await live(Array(6).fill({}));assert.equal(JSON.parse(await readFile(file)).used,10);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('network detection is coalesced briefly; explicit checks stay fresh and chain changes reject',async()=>{
 let chain='0x1237',at=1000;const counts={};
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const q=JSON.parse(body);counts[q.method]=(counts[q.method]??0)+1;
  res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result:q.method==='eth_chainId'?chain:'0x10'}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const p=runtimeProvider('http://127.0.0.1:'+server.address().port,{gate:async()=>{},now:()=>at});
 try{
  await p.getNetwork();const baseline=counts.eth_chainId;
  await Promise.all(Array.from({length:20},()=>p.getNetwork()));assert.equal(counts.eth_chainId,baseline);
  chain='0x1';assert.equal(await p.send('eth_chainId',[]),'0x1');
  at+=1001;await assert.rejects(p.getNetwork(),/network changed/);
 }finally{p.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('a whole-operation reservation refuses an oversized scan before any HTTP',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rpc-scan-')),file=join(dir,'budget.json');let requests=0;
 const server=createServer((req,res)=>{requests++;res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const policy={file,maxRequests:20,windowMs:3600000,intervalMs:0};await budget.initializeBudget(file,policy);
 const p=runtimeProvider('http://127.0.0.1:'+server.address().port,{gate:budget.persistentRpcGate({...policy,reserveRequests:10})});
 try{
  let ran=false;await assert.rejects(p.withRpcReservation(11,async()=>{ran=true;await p.send('eth_chainId',[]);}),{code:'RPC_OPERATION_TOO_LARGE'});
  assert.equal(ran,false);assert.equal(requests,0);assert.equal(JSON.parse(await readFile(file)).used,0);
 }finally{p.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

test('reserved requests are not charged twice and cannot cross the budget window',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rpc-credit-')),file=join(dir,'budget.json');let at=1000,requests=0;
 const server=createServer(async(req,res)=>{let body='';for await(const x of req)body+=x;requests++;const q=JSON.parse(body);res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result:q.method==='eth_chainId'?'0x1237':'0x10'}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const policy={file,maxRequests:20,windowMs:1000,intervalMs:0,now:()=>at};await budget.initializeBudget(file,policy);
 const gate=budget.persistentRpcGate(policy),p=runtimeProvider('http://127.0.0.1:'+server.address().port,{gate,now:()=>at});
 try{
  await p.withRpcReservation(8,async()=>{await p.send('eth_chainId',[]);await p.send('eth_blockNumber',[]);});
  assert.equal(JSON.parse(await readFile(file)).used,8);assert.ok(requests>=2&&requests<=3);
  const reserved=await gate.reserve(2);at=2000;await assert.rejects(reserved({}),{code:'RPC_BUDGET_EXHAUSTED'});
  await gate({});assert.equal(JSON.parse(await readFile(file)).used,1);
 }finally{p.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
