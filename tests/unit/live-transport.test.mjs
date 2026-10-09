import test from 'node:test';
import assert from 'node:assert/strict';
import {liveReads} from '../../src/qianqi/live-transport.mjs';
const env={PONS_ARCHIVE_RPC:'https://archive.example/secret-a',PONS_LOGS_RPC:'https://logs.example/secret-b'};
test('separate logs source is chain checked once and secrets never enter captures',async()=>{
 const calls=[],captures=[];
 const reads=liveReads((kind,row)=>captures.push({kind,row}),{env,fetchImpl:async(url,options)=>{
  const request=JSON.parse(options.body);calls.push({url,method:request.method});
  return {ok:true,json:async()=>({result:request.method==='eth_chainId'?'0x1237':[]})};
 }});
 await reads.rpc('eth_chainId',[]);await reads.rpc('eth_getLogs',[{}]);await reads.rpc('eth_getLogs',[{}]);
 assert.deepEqual(calls.map(c=>c.url),[env.PONS_ARCHIVE_RPC,env.PONS_LOGS_RPC,env.PONS_LOGS_RPC,env.PONS_LOGS_RPC]);
 assert.equal(calls.filter(c=>c.url===env.PONS_LOGS_RPC&&c.method==='eth_chainId').length,1);
 assert.ok(!JSON.stringify(captures).includes('secret'));
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
