import test from 'node:test';
import assert from 'node:assert/strict';
import {liveReads} from '../../src/qianqi/live-transport.mjs';
const env={PONS_ARCHIVE_RPC:'https://archive.example/secret-a',PONS_LOGS_RPC:'https://logs.example/secret-b'};
const filter={fromBlock:'0x1',toBlock:'0x2'};
test('separate logs source is chain checked once and secrets never enter captures',async()=>{
 const calls=[],captures=[];
 const reads=liveReads((kind,row)=>captures.push({kind,row}),{env,fetchImpl:async(url,options)=>{
  const request=JSON.parse(options.body);calls.push({url,method:request.method});
  return {ok:true,json:async()=>({result:request.method==='eth_chainId'?'0x1237':[]})};
 }});
 await reads.rpc('eth_chainId',[]);await reads.rpc('eth_getLogs',[filter]);await reads.rpc('eth_getLogs',[filter]);
 assert.deepEqual(calls.map(c=>c.url),[env.PONS_ARCHIVE_RPC,env.PONS_LOGS_RPC,env.PONS_LOGS_RPC,env.PONS_LOGS_RPC]);
 assert.equal(calls.filter(c=>c.url===env.PONS_LOGS_RPC&&c.method==='eth_chainId').length,1);
 assert.ok(!JSON.stringify(captures).includes('secret'));
});
test('bounded inclusive pages preserve filters, order and logical capture; partial failure has no aggregate',async()=>{
 const calls=[],captures=[];
 const reads=liveReads((k,r)=>captures.push(r),{env:{...env,PONS_LOGS_MAX_BLOCKS:'10'},fetchImpl:async(url,opts)=>{
  const r=JSON.parse(opts.body);calls.push(r);
  return {ok:true,json:async()=>({result:r.method==='eth_chainId'?'0x1237':[{blockNumber:r.params[0].fromBlock}]})};
 }});
 const f={fromBlock:'0x5',toBlock:'0x1d',address:'0x123',topics:['0x456']};
 const result=await reads.rpc('eth_getLogs',[f]);
 assert.deepEqual(calls.slice(1).map(r=>r.params[0]),[
  {...f,fromBlock:'0x5',toBlock:'0xe'},{...f,fromBlock:'0xf',toBlock:'0x18'},{...f,fromBlock:'0x19',toBlock:'0x1d'}]);
 assert.deepEqual(result.map(r=>r.blockNumber),['0x5','0xf','0x19']);assert.deepEqual(captures.at(-1),{method:'eth_getLogs',params:[f],result});
 let n=0;const failed=[];
 const bad=liveReads((k,r)=>failed.push(r),{env:{...env,PONS_LOGS_MAX_BLOCKS:'10'},fetchImpl:async()=>({ok:++n<3,status:413,json:async()=>({result:n===1?'0x1237':[]})})});
 await assert.rejects(bad.rpc('eth_getLogs',[f]),/413/);assert.equal(failed.length,2);
 assert.throws(()=>liveReads(()=>{},{env:{...env,PONS_LOGS_MAX_BLOCKS:'0'}}),/block limit/);
});
test('wrong logs chain, financial method and invalid endpoint fail closed',async()=>{
 let count=0;
 const reads=liveReads(()=>{},{env,fetchImpl:async()=>{count++;return {ok:true,json:async()=>({result:'0x1'})};}});
 await assert.rejects(reads.rpc('eth_getLogs',[{}]),/Wrong log RPC chain/);assert.equal(count,1);
 await assert.rejects(reads.rpc('eth_sendRawTransaction',['secret']),/Read-only/);assert.equal(count,1);
 assert.throws(()=>liveReads(()=>{},{env:{...env,PONS_LOGS_RPC:'file:///secret'}}),/^Error: Invalid PONS_LOGS_RPC configuration$/);
});
test('HTTP denial reports only status and never attempts another endpoint',async()=>{
 const calls=[];
 const reads=liveReads(()=>{},{env,fetchImpl:async url=>{calls.push(url);return {ok:false,status:403};}});
 await assert.rejects(reads.rpc('eth_getLogs',[{}]),/^Error: RPC HTTP 403$/);assert.deepEqual(calls,[env.PONS_LOGS_RPC]);
});
