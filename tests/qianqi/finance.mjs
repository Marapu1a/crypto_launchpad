import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {inspectFinance,abi,rngAbi} from '../../src/qianqi/finance-shadow.mjs';
import {canonical} from '../../src/qianqi/ticket-shadow.mjs';
const dir=resolve(process.argv[2]),history=JSON.parse(readFileSync('.local/test-results/qianqi-history-2026-10-09T13-19-20-045Z/report.json'));
const records=readdirSync(dir).filter(f=>/^\d+-rpc.json$/.test(f)).map(f=>JSON.parse(readFileSync(resolve(dir,f))));
const map=new Map(records.map(r=>[canonical([r.method,r.params]),r.result]));
async function run(edit=()=>{}){return inspectFinance({head:history.provenance.head,history,rpc:async(method,params)=>{const original=map.get(canonical([method,params]));assert.notEqual(original,undefined,'Missing captured read');const r={method,params,result:structuredClone(original)};edit(r);return r.result;}});}
const alter=(iface,name,fn)=>r=>{if(r.method==='eth_call'&&r.params[0].data.startsWith(iface.getFunction(name).selector)){const values=Array.from(iface.decodeFunctionResult(name,r.result));fn(values);r.result=iface.encodeFunctionResult(name,values);}};
test('historical RNG and liabilities match recorded transfers and storage',async()=>{const result=await run();assert.equal(result.status,'FINANCE_RNG_MATCH');assert.equal(result.draws.length,2);assert.equal(result.reserves.claimable,'0');assert.equal(result.reserves.balance,'219644743');assert.equal(result.draws.reduce((s,d)=>s+BigInt(d.paid),0n),60079580n);writeFileSync(resolve(dir,'offline-verified.json'),JSON.stringify(result,null,2));});
test('seed substitution fails',async()=>{await assert.rejects(run(alter(rngAbi,'requests',v=>{if(v.length===6)v[5]='0x'+'12'.repeat(32)})));});
test('failed BLS proof is rejected',async()=>{await assert.rejects(run(alter(rngAbi,'verify',v=>v[0]=false)),/BLS/);});
test('altered reserved liability rejected',async()=>{await assert.rejects(run(alter(abi,'reserved',v=>v[0]=1n)),/liabilities/);});
test('underfunded vault rejected',async()=>{await assert.rejects(run(alter(abi,'balanceOf',v=>v[0]=0n)),/deficit/);});
test('phantom remaining reward rejected',async()=>{await assert.rejects(run(alter(abi,'reward',v=>v[0]=1n)),/Remaining/);});
test('missing payment event rejected',async()=>{await assert.rejects(run(r=>{if(r.method==='eth_getLogs'&&r.params[0].topics[0]===abi.getEvent('RewardPaid').topicHash)r.result=[];}));});
test('pending draw blocks continuity readiness',async()=>{await assert.rejects(run(alter(abi,'pendingDatasetDraw',v=>v[0]='0x'+'11'.repeat(32))),/Pending/);});
