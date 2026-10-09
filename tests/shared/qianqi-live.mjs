import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {observeQianqiLive,readQianqiLive} from '../../server/shared/qianqi-live.mjs';
import {inProject} from '../../server/shared/store.mjs';
import {contentHash} from '../../src/qianqi/ticket-shadow.mjs';
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
  try{await assert.rejects(tick(),/test live write failure/);assert.deepEqual(await read(),base);}finally{await admin.query('DROP TRIGGER test_reject_live ON launchpad.qianqi_live_heads; DROP FUNCTION launchpad.test_reject_live()');}
 });
 await scenario('Live QIANQI concurrent observations append exactly one isolated checkpoint',async()=>{
  const results=await Promise.all([tick(),tick()]);assert.equal(results.filter(x=>x.inserted).length,1);assert.deepEqual((await read()).payload,liveReport.payload);assert.equal((await admin.query('SELECT * FROM launchpad.qianqi_live_heads')).rowCount,1);
  assert.equal((await jobs.query('SELECT * FROM launchpad.qianqi_live_heads')).rowCount,0);assert.equal(await readQianqiLive(jobs,'22222222-2222-4222-8222-222222222222',m),null);
  await assert.rejects(api.query('SELECT * FROM launchpad.qianqi_live_heads'),e=>e.code==='42501');await assert.rejects(inProject(jobs,p,c=>c.query('DELETE FROM launchpad.qianqi_live_heads'),{readOnly:false}),e=>e.code==='42501');
 });
 await scenario('Live QIANQI new process resumes stored checkpoint without replaying old interval',async()=>{
  await new Promise((ok,bad)=>{const child=spawn(process.execPath,['tests/qianqi/live-child.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,QIANQI_LIVE_TEST:JSON.stringify({url:url('lp_jobs'),p,m,digest:contentHash(liveReport.payload)})}});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',bad);child.once('exit',code=>code===0?ok():bad(Error(output)));});
 });
 await scenario('Live QIANQI reorg permanently halts subsequent automatic retries',async()=>{
  await assert.rejects(tick(r=>{if(r.method==='eth_getBlockByNumber')r.result.hash='0x'+'11'.repeat(32)}),e=>e.code==='QIANQI_REORG');
  await assert.rejects(tick(),/halted/);assert.deepEqual((await read()).payload,liveReport.payload);
  assert.equal((await jobs.query('SELECT * FROM launchpad.qianqi_live_halts')).rowCount,0);
 });
 report.qianqiLive={project:p,module:m,head:liveReport.payload.provenance.head,digest:contentHash(liveReport.payload),delta:liveReport.delta,comparedWallets:liveReport.comparedWallets,executionEligible:false};
}
