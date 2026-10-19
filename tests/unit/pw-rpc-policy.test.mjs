import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {operatorRpc,validateRpcUrl} from '../../server/shared/rpc-policy.mjs';
import {runtimeProvider} from '../../server/short-runtime/rpc-provider.mjs';
import budget from '../../server/shared/rpc-budget.cjs';

test('operator rejects forbidden hosts and missing/corrupt budgets before creating transport',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pw-rpc-')),file=join(dir,'budget.json');
 const config={allowedRpcHosts:['allowed.example','one.quiknode.pro'],rpcBudget:{file,maxRequests:5,windowMs:3600000}};
 try{
  for(const url of ['https://one.quiknode.pro/key','https://unapproved.example/key','http://allowed.example/key','https://user:pass@allowed.example/key'])await assert.rejects(operatorRpc(url,config),/Unapproved/);
  await assert.rejects(operatorRpc('https://allowed.example/key',config),{code:'ENOENT'});
  await writeFile(file,'broken');await assert.rejects(operatorRpc('https://allowed.example/key',config));
  validateRpcUrl('https://allowed.example/key',{mode:'production',allowedRpcHosts:config.allowedRpcHosts});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('bounded transport charges exactly one HTTP attempt for 429/redirect; restart keeps quota',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pw-rpc-')),file=join(dir,'budget.json');let attempts=0,redirected=0,status=429;
 const options={file,maxRequests:2,windowMs:3600000,intervalMs:0};await budget.initializeBudget(file,options);
 const server=createServer((req,res)=>{if(req.url==='/escape')redirected++;else attempts++;res.writeHead(status,{location:'/escape','retry-after':'0'});res.end('unavailable');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 try{
  for(const code of [429,302]){
   status=code;const p=runtimeProvider(url,{gate:budget.persistentRpcGate(options)});
   try{await assert.rejects(p._send({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]}));}finally{p.destroy();}
  }
  const gate=budget.persistentRpcGate(options),p=runtimeProvider(url,{gate});
  try{await assert.rejects(p._send({jsonrpc:'2.0',id:2,method:'eth_blockNumber',params:[]}),{code:'RPC_BUDGET_EXHAUSTED'});}finally{p.destroy();}
  assert.equal(attempts,2);assert.equal(redirected,0);assert.equal(gate.snapshot().used,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
