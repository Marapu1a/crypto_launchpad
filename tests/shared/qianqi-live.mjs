import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {observeQianqiLive,readQianqiLive} from '../../server/shared/qianqi-live.mjs';
import {inProject} from '../../server/shared/store.mjs';
import {contentHash,canonical} from '../../src/qianqi/ticket-shadow.mjs';
import {mkdtempSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {shadowConfig,readCapturedCycle} from '../../server/shared/shadow-storage.mjs';
import {runShadow} from '../../server/shared/shadow-runner.mjs';
import {exerciseRunnerKill} from '../qianqi/runner-kill.mjs';
import {capturedReads,liveReport} from '../qianqi/live-fixture.mjs';
export async function exerciseQianqiLive({admin,jobs,api,url,scenario,report}){
 const {project:p,module:m}=report.qianqi;
 const read=()=>readQianqiLive(jobs,p,m),tick=(edit)=>observeQianqiLive(jobs,p,m,capturedReads(edit));
 const base=await read();
 await scenario('Live QIANQI API mismatch leaves last verified cursor unchanged',async()=>{
  await assert.rejects(tick(r=>{if(r.path?.startsWith('/v1/wallets/'))r.data.balances.carryRaw='99999999'}),/balance mismatch/);assert.deepEqual(await read(),base);
 });
 await scenario('Live QIANQI failed database commit leaves no partial checkpoint',async()=>{
  await admin.query("CREATE FUNCTION launchpad.test_reject_live() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test live write failure'; END $$; CREATE TRIGGER test_reject_live BEFORE INSERT ON launchpad.qianqi_live_heads FOR EACH ROW EXECUTE FUNCTION launchpad.test_reject_live()");
  try{await assert.rejects(tick(),/test live write failure/);assert.deepEqual(await read(),base);assert.equal((await admin.query('SELECT * FROM launchpad.qianqi_live_bodies')).rowCount,0);}finally{await admin.query('DROP TRIGGER test_reject_live ON launchpad.qianqi_live_heads; DROP FUNCTION launchpad.test_reject_live()');}
 });
 await scenario('Storage guard failure immediately before commit rolls back body and head together',async()=>{
  let calls=0;
  await assert.rejects(observeQianqiLive(jobs,p,m,{...capturedReads(),beforeCommit:async()=>{if(++calls===2)throw Error('test storage guard');}}),/test storage guard/);
  assert.deepEqual(await read(),base);assert.equal((await admin.query('SELECT * FROM launchpad.qianqi_live_bodies')).rowCount,0);
 });
 await scenario('Live QIANQI concurrent observations append exactly one isolated checkpoint',async()=>{
  const results=await Promise.all([tick(),tick()]);assert.equal(results.filter(x=>x.inserted).length,1);assert.deepEqual((await read()).payload,liveReport.payload);assert.equal((await admin.query('SELECT * FROM launchpad.qianqi_live_heads')).rowCount,1);
  assert.equal((await jobs.query('SELECT * FROM launchpad.qianqi_live_heads')).rowCount,0);assert.equal(await readQianqiLive(jobs,'22222222-2222-4222-8222-222222222222',m),null);
  await assert.rejects(api.query('SELECT * FROM launchpad.qianqi_live_heads'),e=>e.code==='42501');await assert.rejects(inProject(jobs,p,c=>c.query('DELETE FROM launchpad.qianqi_live_heads'),{readOnly:false}),e=>e.code==='42501');
 });
 await scenario('Live QIANQI new process resumes stored checkpoint without replaying old interval',async()=>{
  await new Promise((ok,bad)=>{const child=spawn(process.execPath,['tests/qianqi/live-child.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,QIANQI_LIVE_TEST:JSON.stringify({url:url('lp_jobs'),p,m,digest:contentHash(liveReport.payload)})}});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',bad);child.once('exit',code=>code===0?ok():bad(Error(output)));});
 });
 await scenario('Compact checkpoint deduplicates body; corruption, RLS and immutable ACL verified; legacy full rows remain readable',async()=>{
  const rows=(await admin.query('SELECT * FROM launchpad.qianqi_live_bodies')).rows;assert.equal(rows.length,1);
  const row=(await admin.query('SELECT * FROM launchpad.qianqi_live_heads')).rows[0];assert.ok(row.payload_text.length<400);
  assert.equal((await jobs.query('SELECT * FROM launchpad.qianqi_live_bodies')).rowCount,0);
  await assert.rejects(api.query('SELECT * FROM launchpad.qianqi_live_bodies'),e=>e.code==='42501');
  await assert.rejects(inProject(jobs,p,c=>c.query('DELETE FROM launchpad.qianqi_live_bodies'),{readOnly:false}),e=>e.code==='42501');
  await admin.query("UPDATE launchpad.qianqi_live_bodies SET body_text='{}'");
  await assert.rejects(read(),/checksum/);await admin.query('UPDATE launchpad.qianqi_live_bodies SET body_text=$1',[rows[0].body_text]);
  await admin.query('UPDATE launchpad.qianqi_live_heads SET payload_text=$1',[canonical(liveReport.payload)]);
  assert.deepEqual((await read()).payload,liveReport.payload);
  await admin.query('UPDATE launchpad.qianqi_live_heads SET payload_text=$1',[row.payload_text]);
  report.qianqiStorage={payloadBytes:Buffer.byteLength(canonical(liveReport.payload)),headPayloadBytes:Buffer.byteLength(row.payload_text),bodyBytes:Buffer.byteLength(rows[0].body_text)};
 });
 const runtimeConfig=()=>shadowConfig({QIANQI_STATE_DIR:mkdtempSync(join(tmpdir(),'lp-runner-')),SHARED_PROJECT_ID:p,SHARED_MODULE_ID:m,QIANQI_MIN_FREE_BYTES:'1'});
 const makeReads=save=>{const r=capturedReads();return {rpc:async(method,params)=>{const result=await r.rpc(method,params);save('rpc',{method,params,result});return result;},getJson:async path=>{const data=await r.getJson(path);save('api',{path,data});return data;}};};
 await scenario('Bounded runner captures replayable reads; a new process resumes same state directory and deadline',async()=>{
  const config=runtimeConfig();await runShadow({pool:jobs,config,makeReads,log:()=>{}});
  const marker=readFileSync(join(config.root,'rehearsal.json'),'utf8');
  await new Promise((ok,bad)=>{const child=spawn(process.execPath,[resolve('tests/qianqi/runner-child.mjs')],{cwd:tmpdir(),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,QIANQI_RUNNER_TEST:JSON.stringify({url:url('lp_jobs'),config})}});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',bad);child.once('exit',code=>code===0?ok():bad(Error(output)));});
  assert.equal(readFileSync(join(config.root,'rehearsal.json'),'utf8'),marker);
  const cycles=readdirSync(join(config.root,'cycles'));assert.equal(cycles.length,2);
  assert.equal(readCapturedCycle(config.root,cycles[0].slice(0,-5)).report.status,'UNCHANGED');
 });
 await scenario('Disk floor stops before RPC; concurrent runner is excluded for same project/module',async()=>{
  let called=false;
  await assert.rejects(runShadow({pool:jobs,config:runtimeConfig(),makeReads:()=>{called=true;},storageOptions:{freeBytes:()=>0}}),/disk floor/);assert.equal(called,false);
  const config=runtimeConfig();let release,entered;
  const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
  const running=runShadow({pool:jobs,config,makeReads:save=>{const r=makeReads(save);return {...r,rpc:async(...a)=>{entered();await gate;return r.rpc(...a);}};},log:()=>{}});
  await ready;
  try{await assert.rejects(runShadow({pool:jobs,config,makeReads,log:()=>{}}),/already active/);}finally{release();await running;}
  assert.deepEqual((await read()).payload,liveReport.payload);
 });
 await scenario('Killed shadow process releases its database lock and restart retains original deadline',async()=>{
  await exerciseRunnerKill({pool:jobs,url:url('lp_jobs'),config:runtimeConfig(),makeReads});
 });
 await scenario('A synthetic empty next block appends a compact head and reuses the immutable body',async()=>{
  const original=liveReport.payload.provenance.head,next={number:original.number+1,hash:'0x'+'42'.repeat(32)};
  const tag=n=>'0x'+n.toString(16),r=capturedReads();
  const result=await observeQianqiLive(jobs,p,m,{
   rpc:async(method,params)=>{
    if(method==='eth_getLogs')return [];
    const mapped=JSON.parse(JSON.stringify(params).replaceAll(tag(next.number),tag(original.number)));
    const value=await r.rpc(method,mapped);
    if(method==='eth_getBlockByNumber'&&(params[0]===tag(next.number)||params[0]==='finalized'))return {...value,number:tag(next.number),hash:next.hash};
    return value;
   },getJson:async path=>{const data=await r.getJson(path);if(data.provenance)data.provenance.head=next;return data;}
  });
  assert.equal(result.inserted,true);assert.equal((await admin.query('SELECT * FROM launchpad.qianqi_live_bodies')).rowCount,1);
  assert.deepEqual((await read()).payload,{...liveReport.payload,provenance:{...liveReport.payload.provenance,head:next}});
  // Remove only this synthetic test row, so the following historical reorg fixture stays meaningful.
  await admin.query('DELETE FROM launchpad.qianqi_live_heads WHERE head_number=$1',[next.number]);
 });
 await scenario('Live QIANQI reorg permanently halts subsequent automatic retries',async()=>{
  await assert.rejects(tick(r=>{if(r.method==='eth_getBlockByNumber')r.result.hash='0x'+'11'.repeat(32)}),e=>e.code==='QIANQI_REORG');
  await assert.rejects(tick(),/halted/);assert.deepEqual((await read()).payload,liveReport.payload);
  assert.equal((await jobs.query('SELECT * FROM launchpad.qianqi_live_halts')).rowCount,0);
 });
 report.qianqiLive={project:p,module:m,head:liveReport.payload.provenance.head,digest:contentHash(liveReport.payload),delta:liveReport.delta,comparedWallets:liveReport.comparedWallets,executionEligible:false};
}
