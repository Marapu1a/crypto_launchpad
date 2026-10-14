import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import budget from '../../server/shared/rpc-budget.cjs';
import {createRequire} from 'node:module';
const {paceProvider}=createRequire(import.meta.url)('../../server/adapters/qianqi/runtime/scripts/pace-public-rpc.cjs');
const exec=promisify(execFile);
test('QIANQI transport charges actual batch requests against persistent shared quota',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rpc-budget-')),file=join(dir,'budget.json');let sends=0;
 try{
  const options={file,maxRequests:2,windowMs:1000,intervalMs:0};await budget.initializeBudget(file,options);
  const provider=paceProvider({_send:async()=>{sends++;throw Error('network failure');}},{gate:budget.persistentRpcGate(options)});
  await assert.rejects(provider._send([{method:'eth_call'},{method:'eth_chainId'}]),/network failure/);
  await assert.rejects(provider._send({method:'eth_call'}),{code:'RPC_BUDGET_EXHAUSTED'});
  assert.equal(sends,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('independent processes cannot overspend; restart retains reservations',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rpc-budget-')),file=join(dir,'budget.json');
 try{
  await budget.initializeBudget(file,{maxRequests:7,windowMs:3600000});
  const script=`const {persistentRpcGate}=require(process.argv[1]);const g=persistentRpcGate({file:process.argv[2],maxRequests:7,windowMs:3600000,intervalMs:0});(async()=>{let n=0;for(let i=0;i<5;i++){try{await g();n++;}catch(e){if(e.code!=='RPC_BUDGET_EXHAUSTED')throw e;}}console.log(n);})();`;
  const results=await Promise.all(Array.from({length:3},()=>exec(process.execPath,['-e',script,resolve('server/shared/rpc-budget.cjs'),file])));
  assert.equal(results.reduce((n,r)=>n+Number(r.stdout),0),7);
  await assert.rejects(budget.persistentRpcGate({file,maxRequests:7,windowMs:3600000})(),{code:'RPC_BUDGET_EXHAUSTED'});
  assert.equal(JSON.parse(await readFile(file)).used,7);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('missing/corrupt/mismatched state and abandoned lock fail closed; window expiry restores quota',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rpc-budget-')),file=join(dir,'budget.json');let at=1000;
 const options={file,maxRequests:2,windowMs:1000,intervalMs:0,now:()=>at,lockAttempts:1};
 try{
  await assert.rejects(budget.persistentRpcGate(options)());
  await budget.initializeBudget(file,options);
  await assert.rejects(budget.initializeBudget(file,options),{code:'EEXIST'});
  const gate=budget.persistentRpcGate(options);await gate([{},{}]);await assert.rejects(gate(),{code:'RPC_BUDGET_EXHAUSTED'});
  at=900;await assert.rejects(gate(),{code:'RPC_BUDGET_EXHAUSTED'});
  at=2000;await gate();assert.equal(gate.snapshot().used,1);
  await assert.rejects(budget.persistentRpcGate({...options,maxRequests:3})(),/policy mismatch/);
  await writeFile(file+'.lock','');await assert.rejects(gate(),{code:'RPC_BUDGET_LOCKED'});await rm(file+'.lock');
  await writeFile(file,'broken');await assert.rejects(gate());
 }finally{await rm(dir,{recursive:true,force:true});}
});
