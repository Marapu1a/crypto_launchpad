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
