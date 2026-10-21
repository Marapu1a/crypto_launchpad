const {test}=require('node:test'),assert=require('node:assert/strict');
const {evaluate}=require('../../ops/qianqi/monitor.cjs');
const services=Object.fromEntries(['qianqi-public-automation.service','qianqi-public-indexer.service','crypto-launchpad-api.service'].map(u=>[u,'active']));
const base={services,now:100000,backupRunning:false,api:{status:'observed'},backup:{phase:'success',lastSuccess:{at:99999}}};
test('healthy idle is not an incident',()=>assert.deepEqual(evaluate(base),{planned:false,alarms:[]}));
test('failed backup and stopped writers are actionable',()=>{
 const result=evaluate({...base,services:{},backup:{...base.backup,phase:'failed',stopRequested:true}});
 assert(result.alarms.some(x=>x.includes('manual reconciliation')));assert.equal(result.alarms.length,4);
});
test('planned backup stop is bounded and kill is immediately detected',()=>{
 const sample={...base,backupRunning:true,services:{'crypto-launchpad-api.service':'active'},api:null,backup:{phase:'helper',stopRequested:true,startedAt:99990,lastSuccess:{at:99900}}};
 assert.deepEqual(evaluate(sample),{planned:true,alarms:[]});
 assert(evaluate({...sample,backupRunning:false}).alarms.some(x=>x.includes('interrupted')));
 assert(evaluate({...sample,now:100900}).alarms.some(x=>x.includes('overdue')));
});
test('missing/stale success and stale/unavailable API are errors',()=>{
 assert(evaluate({...base,backup:null}).alarms.includes('backup status unavailable'));
 const result=evaluate({...base,now:300000,api:{status:'stale'}});
 assert.equal(result.alarms.length,2);
});
test('preflight failure does not suppress real service/API failure',()=>{
 const result=evaluate({...base,backupRunning:true,backup:{phase:'failed',stopRequested:false},api:null});
 assert.equal(result.planned,false);assert.equal(result.alarms.length,3);
});
const {deliver,summarize}=require('../../ops/qianqi/notify.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('existing channel deduplicates incident, reminds, recovers and retries delivery errors',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qianqi-notify-')),file=path.join(dir,'state.json');
 try{
  const sent=[],send=async message=>sent.push(message),summary='backup failed; writers require manual reconciliation';
  await deliver({file,summary,send,now:100000});assert.equal(sent.length,1);
  await deliver({file,summary,send,now:160000});assert.equal(sent.length,1);
  await deliver({file,summary,send,now:100000+6*3600000});assert.equal(sent.length,2);
  await deliver({file,summary:'ok',send,now:22000000});assert.equal(sent.length,3);assert.match(sent[2],/восстановились/);
  const saved=fs.readFileSync(file,'utf8');
  await assert.rejects(deliver({file,summary,send:async()=>{throw Error('network');},now:23000000}));
  assert.equal(fs.readFileSync(file,'utf8'),saved);
  await deliver({file,summary,send,now:23060000});assert.equal(sent.length,4);
  assert.equal(summarize({state:'waiting',reasons:[{code:'prizeFunding'}]},{ready:true}),'ok');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

const {evaluatePons}=require('../../ops/qianqi/monitor.cjs');

test('PW budget stop is actionable while waiting; expected project IDs cover PW without hiding missing tokens',()=>{
 const now=2000000,ids=['qianqi','igw','pw'];
 const input={now,expectedProjectIds:ids,health:{checkedAt:new Date(now).toISOString(),projects:ids.map(id=>({id,status:'waiting',reason:'service-sleep'}))},services:Object.fromEntries(['pons-runtime.service','pons-collector.service','crypto-launchpad-api.service','crypto-launchpad-draw-api.service'].map(u=>[u,'active'])),api:{status:'observed'},drawApi:{modules:[{stale:false}]},backupAt:now,backupRunning:false};
 assert.equal(evaluatePons(input).alarms.length,0);
 input.health.projects[2].gasBudget={blocked:true};
 assert.deepEqual(evaluatePons(input).alarms,['PW: service gas budget exhausted; new transactions paused']);
 input.health.projects.pop();assert.ok(evaluatePons(input).alarms.includes('Pons runtime health stale or unavailable'));
});
test('Pons monitor accepts sleeping services but catches stale source and failed worker',()=>{
 const now=2000000,base={now,health:{checkedAt:new Date(now).toISOString(),projects:[{status:'waiting'},{status:'waiting'}]},services:Object.fromEntries(['pons-runtime.service','pons-collector.service','crypto-launchpad-api.service','crypto-launchpad-draw-api.service'].map(u=>[u,'active'])),api:{status:'observed'},drawApi:{modules:[{stale:false,service:{projectionFailed:false}}]},backupAt:now-1000,backupRunning:false};
 assert.deepEqual(evaluatePons(base),{planned:false,alarms:[]});
 assert(evaluatePons({...base,drawApi:{modules:[{stale:true}]}}).alarms.length);
 assert(evaluatePons({...base,health:{...base.health,projects:[{status:'error'},{status:'waiting'}]}}).alarms.length);
 assert(evaluatePons({...base,now:now+900001,backupRunning:true}).alarms.some(a=>a.includes('overdue')));
 assert.equal(evaluatePons({...base,backupRunning:true,services:{...base.services,'pons-runtime.service':'inactive'}}).alarms.length,0);
});
