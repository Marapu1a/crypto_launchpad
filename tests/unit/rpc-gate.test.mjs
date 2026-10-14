import test from 'node:test';
import assert from 'node:assert/strict';
import rpcGate from '../../server/shared/rpc-gate.cjs';
import {runtimeProvider} from '../../server/short-runtime/rpc-provider.mjs';
import {createServer} from 'node:http';

test('concurrent callers and batches share one quota; rejection does not poison queue',async()=>{
 let at=1000;const gate=rpcGate.createRpcGate({intervalMs:10,maxRequests:3,windowMs:100,now:()=>at,sleep:async ms=>{at+=ms;}});
 const r=await Promise.allSettled([gate([{},{}]),gate({}),gate({})]);
 assert.deepEqual(r.map(x=>x.status),['fulfilled','fulfilled','rejected']);
 assert.equal(r[2].reason.code,'RPC_BUDGET_EXHAUSTED');assert.equal(gate.snapshot().used,3);
 at=1100;await gate();assert.equal(gate.snapshot().used,1);
 at=900;await gate();assert.equal(gate.snapshot().used,2); // Clock rollback cannot reset budget.
});

test('failed network RPC consumes quota; exhausted shared transport never reaches HTTP',async()=>{
 let received=0;
 const server=createServer(async(req,res)=>{received++;let text='';for await(const c of req)text+=c;const q=JSON.parse(text);res.setHeader('content-type','application/json');res.end(JSON.stringify({id:q.id,jsonrpc:'2.0',...(q.method==='eth_chainId'?{result:'0x1237'}:{error:{code:-32000,message:'failure'}})}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const gate=rpcGate.createRpcGate({intervalMs:0,maxRequests:4});
 const url='http://127.0.0.1:'+server.address().port;
 const a=runtimeProvider(url,{gate}),b=runtimeProvider(url,{gate});
 try{
  await a.getNetwork();await b.getNetwork();
  await assert.rejects(a.send('eth_getBalance',[]));await assert.rejects(b.send('eth_getBalance',[]));
  const before=received;await assert.rejects(a.send('eth_blockNumber',[]),{code:'RPC_BUDGET_EXHAUSTED'});
  assert.equal(received,before);assert.equal(gate.snapshot().used,4);
 }finally{a.destroy();b.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('invalid limits fail closed',()=>{
 for(const options of [{maxRequests:0},{maxRequests:1.5},{windowMs:0},{intervalMs:-1}])assert.throws(()=>rpcGate.createRpcGate(options));
});
