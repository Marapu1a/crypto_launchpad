import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import service from '../../server/shared/service-cadence.cjs';
import {economyCadence} from '../../server/short-runtime/economy.mjs';
import {schedulerObservation} from '../../server/adapters/qianqi/pons-service.mjs';
const {createEconomyDelay}=createRequire(import.meta.url)('../../server/adapters/qianqi/runtime/scripts/pons-cadence.cjs');
const legacyIdle=()=>({status:'waiting',reason:'poll',steps:[],results:{rng:{status:'complete',requests:[],failures:[]},funding:[{status:'empty'}],scheduler:{status:'waiting',results:{SHORT:{status:'waiting',reason:'empty'},MONTHLY:{status:'waiting',reason:'schedule'}}}}});
const ponsIdle=()=>({status:'waiting',sourceStatus:'current',steps:[],funding:[{status:'empty'}],results:[{kind:'SHORT',reason:'empty'},{kind:'MONTHLY',reason:'schedule'}]});
test('equivalent states use one policy through all three adapters',()=>{
 const v2=economyCadence({random:()=>0}),legacy=createEconomyDelay(15,{random:()=>0}),pons=service.createServiceCadence({random:()=>0});
 for(const state of ['idle','idle','idle','unknown','unavailable','unavailable','idle','idle','idle']){
  const a=v2({projects:[{status:state==='unavailable'?'blocked':'waiting',reason:state==='idle'?'conditions':'receipt-finality'}]}).delayMs;
  const b=legacy(state==='idle'?legacyIdle():{status:state==='unavailable'?'blocked':'waiting'});
  const c=pons(schedulerObservation(state==='idle'?ponsIdle():{status:state==='unavailable'?'blocked':'waiting'})).delayMs;
  assert.equal(a,b,state);assert.equal(a,c,state);
 }
});
test('one project cannot inherit another project idle or failure counters',()=>{
 const a=service.createServiceCadence({random:()=>0}),b=service.createServiceCadence({random:()=>0});
 for(let n=0;n<3;n++)a({status:'idle'});
 assert.equal(a({status:'idle'}).mode,'quiet');assert.equal(b({status:'idle'}).mode,'active');
 for(let n=0;n<4;n++)a({status:'unavailable'});
 assert.equal(b({status:'unavailable'}).delayMs,60000);
 assert.equal(a({status:'active',continueImmediately:true}).delayMs,0);
 assert.equal(a({status:'unavailable'}).delayMs,60000);
});
test('Pons adapter never infers idle from missing funding, source or unresolved draw',()=>{
 for(const change of [r=>delete r.funding,r=>r.funding[0].status='unavailable',r=>r.sourceStatus='unavailable',r=>r.results.pop(),r=>r.results[0].reason='seed',r=>r.steps.push({action:'pay'})]){
  const r=ponsIdle();change(r);assert.notEqual(schedulerObservation(r).status,'idle');
 }
 const next=service.createServiceCadence({random:()=>0});for(let n=0;n<5;n++)assert.equal(next({status:'unknown',continueImmediately:true}).delayMs,15000);
 assert.throws(()=>service.createServiceCadence({quietMs:NaN}));
});
