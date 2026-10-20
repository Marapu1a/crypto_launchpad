import test from 'node:test';
import assert from 'node:assert/strict';
import {runPonsServices} from '../../server/shared/pons-service-loop.mjs';
test('service sleep only publishes local heartbeat; failures do not stop the other token',async()=>{
 const stop=new AbortController();let ticks=0,beats=0,failedTicks=0,at=1000;
 await runPonsServices({signal:stop.signal,now:()=>at,services:[{id:'qianqi',tick:async()=>{failedTicks++;throw Object.assign(Error('secret URL'),{code:'RPC_BUDGET_EXHAUSTED'});}},{id:'igw',tick:async()=>{ticks++;return {status:'waiting',reason:'service-sleep',service:{ran:false}};}}],heartbeat:async report=>{
  beats++;assert.equal(report.services[0].result.reason,'rpc-budget-exhausted');assert.equal(report.services[1].result.service.ran,false);assert.ok(!JSON.stringify(report).includes('secret'));
 },wait:async ms=>{assert.equal(ms,15000);at+=ms;if(ticks===2)stop.abort();}});
 assert.equal(beats,2);assert.equal(failedTicks,1);
});
test('aborted loop performs no work; duplicate IDs are refused',async()=>{
 const stop=new AbortController();stop.abort();const s={id:'one',tick:()=>{throw Error('must not run');}};
 await runPonsServices({signal:stop.signal,services:[s]});
 await assert.rejects(runPonsServices({services:[s,s]}),/Invalid Pons services/);
});

test('receipt finality waits a minute while other tokens keep their cadence',async()=>{
 const stop=new AbortController();let at=0,slow=0,fast=0;
 await runPonsServices({signal:stop.signal,now:()=>at,services:[
  {id:'qianqi',tick:async()=>{slow++;return {status:'waiting',reason:'receiptFinality',retryAt:at+60000};}},
  {id:'igw',tick:async()=>{fast++;return {status:'waiting'};}}
 ],wait:async ms=>{at+=ms;if(at>3600000)stop.abort();}});
 assert.equal(slow,61);assert.equal(fast,241);
});

test('exhausted budget waits until its persisted window ends without retrying every backoff interval',async()=>{
 const stop=new AbortController();let at=0,attempts=0;
 await runPonsServices({signal:stop.signal,now:()=>at,services:[{id:'one',tick:async()=>{
  attempts++;throw Object.assign(Error('cap'),{code:'RPC_BUDGET_EXHAUSTED',retryAt:3600000});
 }}],wait:async ms=>{assert.equal(ms,3600000);at+=ms;stop.abort();}});
 assert.equal(attempts,1);
});


test('budget ownership and filesystem permissions are visible without leaking raw errors',async()=>{
 for(const [code,reason]of [['RPC_BUDGET_OWNER','rpc-budget-owner'],['RPC_BUDGET_LOCKED','rpc-budget-locked'],['EACCES','service-permission-denied'],['EPERM','service-permission-denied']]){
  await runPonsServices({once:true,services:[{id:'one',tick:async()=>{throw Object.assign(Error('private URL'),{code});}}],heartbeat:async r=>{assert.equal(r.services[0].result.reason,reason);assert.ok(!JSON.stringify(r).includes('private'));}});
 }
});
