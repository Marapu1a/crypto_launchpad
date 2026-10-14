import test from 'node:test';
import assert from 'node:assert/strict';
import {createPonsService} from '../../server/shared/pons-service.mjs';
import {drawServiceObservation} from '../../server/shared/pons-draw-service.mjs';
function fixture(){
 let clock=1000000,runs=0,published=0,result={status:'idle'};
 const report={schema:'pons-purchase-accounting-v1',source:'Pons API',status:'current',checkedAt:1000,tradeCount:0,activity:[],profile:{token:'one'}};
 const options={now:()=>clock,loadReport:async()=>report,run:async()=>{runs++;return result;},observe:r=>r,publish:async()=>{published++;}};
 return {report,options,get runs(){return runs;},get published(){return published;},clock(t){clock=t;report.checkedAt=Math.floor(t/1000);},result(r){result=r;}};
}
test('source heartbeat does not trigger RPC or refresh contract snapshot; changes and timer do',async()=>{
 const f=fixture(),tick=createPonsService(f.options);
 assert.equal((await tick()).service.reason,'initial-or-pending');
 for(let n=1;n<6;n++){f.clock(1000000+n*300000);assert.equal((await tick()).service.ran,false);}
 assert.equal(f.runs,1);assert.equal(f.published,1);
 f.clock(2800000);assert.equal((await tick()).service.reason,'scheduled-check');assert.equal(f.runs,2);
 f.report.activity.push({id:'new-buy'});f.report.tradeCount=1;assert.equal((await tick()).service.reason,'pons-changed');assert.equal(f.runs,3);
});
test('pending work, due draw, stale source and corrupt report cannot sleep',async()=>{
 const f=fixture(),tick=createPonsService(f.options);
 f.result({status:'unknown'});await tick();await tick();assert.equal(f.runs,2);
 f.result({status:'idle',nextCheckAt:1001000});await tick();f.clock(1001000);await tick();assert.equal(f.runs,4);
 f.result({status:'idle'});await tick();f.report.checkedAt=0;await tick();assert.equal(f.runs,6);
 f.report.checkedAt=1001;f.report.tradeCount=99;await tick();assert.equal(f.runs,7);
});
test('failures and process restart invalidate sleep; tokens are independent',async()=>{
 const f=fixture(),g=fixture(),a=createPonsService(f.options),b=createPonsService(g.options);
 await a();await b();f.report.profile.token='changed';await a();assert.equal(g.runs,1);
 await createPonsService(f.options)();assert.equal(f.runs,3);
 const h=fixture();let fail=true;const tick=createPonsService({...h.options,publish:async()=>{if(fail)throw Error('disk full');}});
 await assert.rejects(tick(),/disk full/);fail=false;await tick();assert.equal(h.runs,2);
});
test('overlapping passes cannot execute a second worker',async()=>{
 const f=fixture();let release;const tick=createPonsService({...f.options,run:()=>new Promise(r=>{release=r;})});
 const first=tick();await new Promise(r=>setImmediate(r));assert.equal((await tick()).reason,'service-pass-running');release({status:'idle'});await first;
});
test('v2 requires explicit all-lanes idle evidence, never a last-lane reason alone',()=>{
 for(const serviceIdle of [undefined,false])assert.equal(drawServiceObservation({status:'waiting',reason:'participants',serviceIdle}).status,'unknown');
 assert.equal(drawServiceObservation({status:'waiting',reason:'participants',serviceIdle:true}).status,'idle');
 assert.equal(drawServiceObservation({status:'waiting',reason:'beacon-time-finality',serviceIdle:true}).status,'unknown');
});
