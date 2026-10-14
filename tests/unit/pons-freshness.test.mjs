import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ponsFreshness} from '../../server/shared/pons-freshness.mjs';
import {savePonsPublic} from '../../server/adapters/qianqi/pons-public-store.mjs';
import {refreshQianqiHeartbeat} from '../../server/shared/pons-heartbeat.mjs';
test('fresh Pons cannot conceal stale contracts; contract timestamp never becomes source time',async()=>{
 const observedAt=new Date(1000000).toISOString();
 assert.equal(ponsFreshness({observedAt,sourceCheckedAt:2000,now:2000000}).stale,false);
 assert.equal(ponsFreshness({observedAt,sourceCheckedAt:3000,now:3000000}).stale,true);
 assert.equal(ponsFreshness({observedAt,sourceCheckedAt:1000,now:2000000}).stale,true);
 assert.equal(ponsFreshness({observedAt,sourceCheckedAt:2100,now:2000000}).stale,true);
 const dir=await mkdtemp(join(tmpdir(),'pons-freshness-')),file=join(dir,'public.json');
 try{
  savePonsPublic(file,{observedAt,serviceObservation:{sourceFingerprint:'a',sourceCheckedAt:1000},fund:'123'});
  await refreshQianqiHeartbeat(file,{sourceFingerprint:'a',sourceCheckedAt:2000});
  const snapshot=JSON.parse(await readFile(file,'utf8')).snapshot;assert.equal(snapshot.observedAt,observedAt);assert.equal(snapshot.fund,'123');assert.equal(snapshot.serviceObservation.sourceCheckedAt,2000);
  const before=await stat(file),bytes=await readFile(file,'utf8');
  for(let i=0;i<20;i++)await refreshQianqiHeartbeat(file,{sourceFingerprint:'a',sourceCheckedAt:2000});
  assert.equal((await stat(file)).mtimeMs,before.mtimeMs);assert.equal(await readFile(file,'utf8'),bytes);
  await assert.rejects(refreshQianqiHeartbeat(file,{sourceFingerprint:'b',sourceCheckedAt:2100}),/identity changed/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

import {readShortView} from '../../server/shared/short-view.mjs';
test('Pons service freshness follows five-minute source polling while legacy keeps two minutes',async()=>{
 const now=2000000,row={id:'m',program_address:'p',observed_at:new Date(now-300000),service_at:new Date(now-300000),service_status:'waiting',snapshot:{serviceObservation:{sourceCheckedAt:(now-300000)/1000}}};
 const pool={connect:async()=>({query:async sql=>({rows:sql.startsWith('SELECT m.id')?[row]:[]}),release(){}})};
 const read=()=>readShortView(pool,'534ed9bc-35b5-4884-8044-d047537bd52f',{now});
 assert.equal((await read()).modules[0].service.stale,false);
 row.service_at=new Date(now-661000);assert.equal((await read()).modules[0].service.stale,true);
 row.service_at=new Date(now-300000);row.snapshot={};assert.equal((await read()).modules[0].service.stale,true);
});

test('explicit event idle keeps source health current without pretending contracts were reverified',()=>{
 const observedAt=new Date(1000000).toISOString(),now=1000000+86400000;
 const input={observedAt,sourceCheckedAt:now/1000,now,eventIdle:true,nextCheckAt:null};
 const idle=ponsFreshness(input);
 assert.equal(idle.stale,false);assert.equal(idle.contractStale,true);assert.equal(idle.awaitingActivity,true);
 assert.equal(idle.contractVerifiedAt,observedAt);
 assert.equal(ponsFreshness({...input,eventIdle:false}).stale,true);
 assert.equal(ponsFreshness({...input,nextCheckAt:now}).stale,true);
 assert.equal(ponsFreshness({...input,sourceCheckedAt:(now-661000)/1000}).stale,true);
 assert.equal(ponsFreshness({...input,observedAt:null}).stale,true);
});

import {renderPonsPublic} from '../../server/adapters/qianqi/pons-projection.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {createRequire} from 'node:module';
const {hash}=createRequire(import.meta.url)('../../server/adapters/qianqi/runtime/scripts/direct-buy.cjs');
test('QIANQI public renderer preserves old contract time during event idle and expires missing heartbeat',()=>{
 const config={manifest:{chainId:4663},lifecycle:{}},observedAt=new Date(1000000).toISOString(),now=1000000+86400000;
 const snapshot={schema:'qianqi-pons-public-v1',manifestHash:hash(config.manifest),configHash:digest(config),observedAt,checkedAt:1000,serviceObservation:{eventIdle:true,nextCheckAt:null,sourceCheckedAt:now/1000},publicView:{asset:{},reserves:{freeShort:'0',freeCurrent:'0',freeNext:'0',nextStartTarget:'100'},timing:{SHORT:{earliestAt:'0',minimumRaw:'100'},MONTHLY:{earliestAt:'0',minimumRaw:'100'}},pending:{},history:[]}};
 const current=renderPonsPublic(config,snapshot,{now});
 assert.equal(current.status,'observed');assert.equal(current.provenance.observedAt,observedAt);assert.equal(current.provenance.freshness.contractStale,true);
 assert.equal(renderPonsPublic(config,snapshot,{now:now+661000}).status,'stale');
 snapshot.serviceObservation.eventIdle=false;assert.equal(renderPonsPublic(config,snapshot,{now}).status,'stale');
});
