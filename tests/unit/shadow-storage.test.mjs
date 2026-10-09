import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {shadowConfig,openShadowStorage,readCapturedCycle,treeBytes} from '../../server/shared/shadow-storage.mjs';
const env=()=>({QIANQI_STATE_DIR:mkdtempSync(join(tmpdir(),'lp-shadow-')),SHARED_PROJECT_ID:'11111111-1111-4111-8111-111111111111',SHARED_MODULE_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',QIANQI_MAX_BYTES:'1000000',QIANQI_MIN_FREE_BYTES:'100',QIANQI_CYCLE_BYTES:'100000',QIANQI_DURATION_SECONDS:'60'});
test('captures deduplicate, replay exact evidence and preserve deadline across restart',()=>{
 const c=shadowConfig(env());let clock=1000;const opts={now:()=>clock,freeBytes:()=>1e9};
 let s=openShadowStorage(c,opts);s.begin(100);s.save('rpc',{method:'test',result:[1,2]});s.save('rpc',{method:'test',result:[1,2]});s.finish({status:'MATCH'});
 const first=readdirSync(join(c.root,'cycles'))[0].slice(0,-5),captured=readCapturedCycle(c.root,first);
 assert.equal(captured.records.length,2);assert.deepEqual(captured.records[0].row,{method:'test',result:[1,2]});
 assert.equal(readdirSync(join(c.root,'objects')).length,1);
 clock=5000;s=openShadowStorage(c,opts);assert.equal(s.deadline,61000);s.begin(100);s.save('rpc',{method:'test',result:[1,2]});s.finish({status:'UNCHANGED'});
 assert.equal(readdirSync(join(c.root,'objects')).length,1);assert.equal(readdirSync(join(c.root,'cycles')).length,2);
 clock=61000;assert.throws(()=>openShadowStorage(c,opts).begin(100),/deadline/);
 assert.throws(()=>openShadowStorage({...c,durationMs:120000},opts),/binding mismatch/);
});
test('disk floor and database-inclusive budget stop before capture; no evidence is deleted',()=>{
 const c=shadowConfig(env());let free=1e9;const s=openShadowStorage(c,{freeBytes:()=>free});
 assert.throws(()=>s.begin(c.maxBytes),/budget/);s.begin(0);s.save('api',{data:'preserve'});s.finish({status:'MATCH'});
 const bytes=treeBytes(c.root);free=99;assert.throws(()=>s.begin(0),/floor/);assert.equal(treeBytes(c.root),bytes);
});
test('cycle cap prevents oversized writes and corrupted content is rejected on reuse',()=>{
 const c=shadowConfig({...env(),QIANQI_CYCLE_BYTES:'3000'}),s=openShadowStorage(c,{freeBytes:()=>1e9});s.begin(0);
 assert.throws(()=>s.save('api',{data:Array.from({length:10000},(_,i)=>i)}),/cycle storage/);
 s.save('api',{data:'original'});s.finish({status:'MATCH'});
 const file=join(c.root,'objects',readdirSync(join(c.root,'objects'))[0]);writeFileSync(file,'corrupt');s.begin(0);
 assert.throws(()=>s.save('api',{data:'original'}));
});
test('explicit root/identity and owned empty directory required; external files preserved',()=>{
 assert.throws(()=>shadowConfig({...env(),QIANQI_STATE_DIR:'relative'}),/Absolute/);
 assert.throws(()=>shadowConfig({...env(),SHARED_MODULE_ID:'bad'}),/identity/);
 assert.throws(()=>shadowConfig({...env(),QIANQI_MAX_BYTES:'NaN'}),/budget/);
 const c=shadowConfig(env());writeFileSync(join(c.root,'foreign'),'keep');
 assert.throws(()=>openShadowStorage(c),/new or initialized/);assert.equal(readFileSync(join(c.root,'foreign'),'utf8'),'keep');
});
