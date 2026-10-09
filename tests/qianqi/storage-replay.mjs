import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {shadowConfig,openShadowStorage,readCapturedCycle,treeBytes} from '../../server/shared/shadow-storage.mjs';
import {canonical} from '../../src/qianqi/ticket-shadow.mjs';
import {advanceShadow} from '../../src/qianqi/live-shadow.mjs';
import {previous,liveReport,liveDirectory} from './live-fixture.mjs';
const root=mkdtempSync(resolve('.local/test-results/storage-replay-'));
const config=shadowConfig({QIANQI_STATE_DIR:join(root,'state'),SHARED_PROJECT_ID:'11111111-1111-4111-8111-111111111111',SHARED_MODULE_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',QIANQI_MIN_FREE_BYTES:'1'});
const storage=openShadowStorage(config);let rawBytes=0;
for(let cycle=0;cycle<2;cycle++){
 storage.begin(0);
 for(const name of readdirSync(liveDirectory).filter(f=>/^\d+-(rpc|api)\.json$/.test(f)).sort()){
  const bytes=readFileSync(join(liveDirectory,name));if(!cycle)rawBytes+=bytes.length;
  storage.save(name.includes('-rpc.')?'rpc':'api',JSON.parse(bytes));
 }
 storage.finish({status:'CAPTURED_FOR_OFFLINE_REPLAY'});
}
const files=readdirSync(join(config.root,'cycles'));
const {records}=readCapturedCycle(config.root,files[0].slice(0,-5));
const rpc=new Map(),api=new Map();
for(const {kind,row} of records)(kind==='rpc'?rpc:api).set(kind==='rpc'?canonical([row.method,row.params]):row.path,row);
const result=await advanceShadow({previous,rpc:async(method,params)=>{
 const row=rpc.get(canonical([method,params]));assert.ok(row,'Missing captured RPC');return structuredClone(row.result);
},getJson:async path=>{assert.ok(api.has(path),'Missing captured API');return structuredClone(api.get(path).data);}});
assert.deepEqual({...result,status:'LIVE_SHADOW_MATCH'},liveReport);
const report={status:'PASS',rawBytesOneCycle:rawBytes,storedBytesTwoCycles:treeBytes(config.root),objects:readdirSync(join(config.root,'objects')).length,recordsPerCycle:records.length,head:result.payload.provenance.head,executionEligible:false};
assert.ok(report.storedBytesTwoCycles<rawBytes);
writeFileSync(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));console.log(join(root,'report.json'));
