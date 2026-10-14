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
