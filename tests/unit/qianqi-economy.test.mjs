import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createEconomyDelay}=createRequire(import.meta.url)('../../server/adapters/qianqi/runtime/scripts/pons-cadence.cjs');
const idle=()=>({status:'waiting',reason:'poll',steps:[],results:{rng:{status:'complete',requests:[],failures:[]},funding:[{status:'empty'}],scheduler:{status:'waiting',results:{SHORT:{status:'waiting',reason:'prizeFunding'},MONTHLY:{status:'waiting',reason:'schedule'}}}}});
test('three confirmed idle passes reduce polling; activity immediately restores cadence',()=>{
 const delay=createEconomyDelay(15);assert.equal(delay(idle()),15000);assert.equal(delay(idle()),15000);assert.equal(delay(idle()),300000);
 const active=idle();active.steps=[{transactionHash:'x'}];assert.equal(delay(active),15000);assert.equal(delay(idle()),15000);
 assert.equal(delay({status:'waiting',continueImmediately:true}),0);
});
test('RNG, missing data, funding failures and partial scheduler results never count as quiet',()=>{
 for(const mutate of [r=>r.results.rng.requests.push({status:'waiting'}),r=>delete r.results.rng,r=>r.results.funding[0].status='unavailable',r=>delete r.results.scheduler.results.MONTHLY,r=>r.results.claimFailures=['x'],r=>r.results.nativeFunding=['x'],r=>r.results.scheduler.results.SHORT.reason='seed']){
  const delay=createEconomyDelay(15),r=idle();mutate(r);for(let i=0;i<4;i++)assert.equal(delay(r),15000);
 }
 assert.throws(()=>createEconomyDelay(0));const delay=createEconomyDelay(600);for(let i=0;i<4;i++)assert.equal(delay(idle()),600000);
});
