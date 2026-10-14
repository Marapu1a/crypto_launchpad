import test from 'node:test';
import assert from 'node:assert/strict';
import {withReadProvider} from '../../server/short-runtime/read-provider.mjs';
import {withTraceProvider} from '../../server/short-runtime/trace-provider.mjs';
test('read split preserves signing, nonce, receipt, gas and broadcast endpoint',async()=>{
 const calls=[];const p={getNetwork:async()=>{throw Error('primary offline');},send:async m=>calls.push('primary:'+m),broadcastTransaction:async()=>calls.push('primary:broadcast'),getTransactionCount:async()=>calls.push('primary:nonce'),getTransactionReceipt:async()=>calls.push('primary:receipt'),estimateGas:async()=>calls.push('primary:gas')};
 const r={getNetwork:async()=>({chainId:4663n}),send:async m=>calls.push('read:'+m),getBlock:async()=>calls.push('read:block'),getTransactionReceipt:async()=>calls.push('read:receipt')};
 const v=await withReadProvider(p,r);await v.getBlock('finalized');await v.send('eth_getLogs',[]);await v.send('eth_sendRawTransaction',[]);await v.broadcastTransaction('raw');await v.getTransactionCount('address');await v.getTransactionReceipt('hash');await v.estimateGas({});
 assert.deepEqual(calls,['read:block','read:eth_getLogs','primary:eth_sendRawTransaction','primary:broadcast','primary:nonce','primary:receipt','primary:gas']);
 await v.getReadTransactionReceipt('hash');assert.equal(calls.at(-1),'read:receipt');await v.send('eth_getTransactionReceipt',['hash']);assert.equal(calls.at(-1),'read:eth_getTransactionReceipt');
 const t=await withTraceProvider(v,{getNetwork:async()=>{throw Error('trace offline');}});await t.getBlock('finalized');await assert.rejects(t.send('debug_traceTransaction',[]),/trace offline/);
 await assert.rejects(withReadProvider(p,{getNetwork:async()=>({chainId:1n})}),/Wrong read chain/);
});
import {scanDrawHistory} from '../../src/tickets/draw-scan.mjs';
test('free-tier bounded discovery scans every block in ten-block pages and resumes cursor',async()=>{
 const ranges=[],block=n=>({number:n,hash:'0x'+String(n).padStart(64,'0'),timestamp:n});
 const provider={discoveryLimits:{logBlockRange:10,scanBlockLimit:25},getBlock:async n=>block(n),getLogs:async f=>{ranges.push([f.fromBlock,f.toBlock]);return []}};
 const policy={contracts:Object.fromEntries(['curve','token','recognition'].map((k,i)=>[k,{address:'0x'+String(i+1).repeat(40)}]))},ledger={head:block(100)};
 assert.equal(await scanDrawHistory(provider,policy,ledger,{number:133}),false);assert.equal(ledger.head.number,125);
 assert.equal(await scanDrawHistory(provider,policy,ledger,{number:133}),true);
 assert.deepEqual(ranges,[[101,110],[111,120],[121,125],[126,133]]);
});
