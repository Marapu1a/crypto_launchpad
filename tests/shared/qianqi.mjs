import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readdirSync,readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {importQianqiHistory,readQianqiHistory,adapter} from '../../server/shared/qianqi-history.mjs';
import {verifyHistoryArchive} from '../../src/qianqi/history-archive.mjs';
import {contentHash} from '../../src/qianqi/ticket-shadow.mjs';
import {inProject} from '../../server/shared/store.mjs';
import {exerciseImportCli} from '../qianqi/import-cli.mjs';
export async function exerciseQianqi({admin,jobs,api,url,scenario,dir,report}){
 const archive={history:resolve('.local/test-results/qianqi-history-2026-10-09T13-19-20-045Z'),capture:resolve('.local/test-results/qianqi-shadow-2026-10-09T12-12-21-030Z'),routes:resolve('.local/test-results/qianqi-routes-2026-10-09T12-33-18-288Z')};
 const expected=await verifyHistoryArchive(archive),p='33333333-3333-4333-8333-333333333333',m='dddddddd-dddd-4ddd-8ddd-dddddddddddd',bad='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',other='22222222-2222-4222-8222-222222222222';
 await admin.query("INSERT INTO launchpad.projects VALUES($1,'qianqi-shadow','QIANQI historical shadow',4663,$2,'shadow')",[p,expected.payload.publicProfile.profile.token.toLowerCase()]);
 for(const id of [m,bad])await admin.query("INSERT INTO launchpad.module_instances VALUES($1,$2,'short',$3,$4,$5)",[p,id,adapter,expected.payload.publicProfile.lifecycle.source.toLowerCase(),contentHash(expected.payload.publicProfile).slice(2)]);
 const importIt=()=>importQianqiHistory(jobs,p,m,archive),read=()=>readQianqiHistory(jobs,p,m);
 await scenario('QIANQI late insert failure rolls back all rows and checkpoint',async()=>{
  await admin.query(`CREATE FUNCTION launchpad.test_reject_qianqi() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='draw' THEN RAISE EXCEPTION 'test late import failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_qianqi BEFORE INSERT ON launchpad.qianqi_history_rows FOR EACH ROW EXECUTE FUNCTION launchpad.test_reject_qianqi()`);
  try{await assert.rejects(importIt(),/test late import failure/);assert.equal(await read(),null);assert.equal((await admin.query('SELECT * FROM launchpad.qianqi_history_rows')).rowCount,0);}finally{await admin.query('DROP TRIGGER test_reject_qianqi ON launchpad.qianqi_history_rows; DROP FUNCTION launchpad.test_reject_qianqi()');}
 });
 await scenario('QIANQI verified history imports exactly once under concurrent delivery',async()=>{
  const results=await Promise.all([importIt(),importIt()]);assert.equal(results.filter(r=>r.inserted).length,1);
  assert.deepEqual(await read(),expected);assert.equal(expected.payload.purchases.length,68);assert.equal(expected.payload.replay.wallets.length,52);assert.equal(expected.payload.replay.draws.length,2);
 });
 await scenario('Portable import CLI revalidates explicit evidence paths from an unrelated working directory',async()=>{
  await exerciseImportCli({url:url('lp_jobs'),project:p,module:m,dir,archive});
 });
 await scenario('QIANQI RLS, immutable rows and project binding reject cross-project access',async()=>{
  assert.equal((await jobs.query('SELECT * FROM launchpad.qianqi_history_rows')).rowCount,0);
  assert.equal(await readQianqiHistory(jobs,other,m),null);
  for(const table of ['qianqi_imports','qianqi_history_rows']){
   await assert.rejects(api.query('SELECT * FROM launchpad.'+table),e=>e.code==='42501');
   await assert.rejects(inProject(jobs,p,c=>c.query('DELETE FROM launchpad.'+table),{readOnly:false}),e=>e.code==='42501');
  }
  await assert.rejects(inProject(jobs,p,c=>c.query("UPDATE launchpad.qianqi_history_rows SET value_text='{}'"),{readOnly:false}),e=>e.code==='42501');
  await assert.rejects(inProject(jobs,other,c=>c.query("INSERT INTO launchpad.qianqi_history_rows VALUES($1,$2,'wallet','foreign','{}')",[p,m]),{readOnly:false}),e=>e.code==='42501');
  await assert.rejects(importQianqiHistory(jobs,other,m,archive),/binding mismatch/);
 });
 await scenario('QIANQI missing evidence blocks import even with copied successful report',async()=>{
  const incomplete=join(dir,'incomplete-qianqi');mkdirSync(incomplete);
  copyFileSync(join(archive.history,'report.json'),join(incomplete,'report.json'));
  await assert.rejects(importQianqiHistory(jobs,p,bad,{...archive,history:incomplete}),/Incomplete offline/);
  assert.equal(await readQianqiHistory(jobs,p,bad),null);
 });
 await scenario('QIANQI altered raw receipt cannot be imported',async()=>{
  const corrupted=join(dir,'corrupted-qianqi');mkdirSync(corrupted);let changed=false;
  for(const file of readdirSync(archive.history).filter(f=>/^\d+-rpc.json$/.test(f))){const r=JSON.parse(readFileSync(join(archive.history,file),'utf8'));if(!changed&&r.method==='eth_getTransactionReceipt'){r.result.status='0x0';changed=true;}writeFileSync(join(corrupted,file),JSON.stringify(r));}
  assert.ok(changed);await assert.rejects(importQianqiHistory(jobs,p,bad,{...archive,history:corrupted}));assert.equal(await readQianqiHistory(jobs,p,bad),null);
 });
 await scenario('QIANQI database corruption is detected rather than accepted on retry',async()=>{
  const original=(await admin.query("SELECT row_key,value_text FROM launchpad.qianqi_history_rows WHERE kind='wallet' ORDER BY row_key LIMIT 1")).rows[0];
  await admin.query("UPDATE launchpad.qianqi_history_rows SET value_text='{}' WHERE row_key=$1",[original.row_key]);
  try{await assert.rejects(read());}finally{await admin.query('UPDATE launchpad.qianqi_history_rows SET value_text=$1 WHERE row_key=$2',[original.value_text,original.row_key]);}
  assert.deepEqual(await read(),expected);
 });
 await scenario('QIANQI new process restores exact balances and retries without duplicate writes',async()=>{
  await new Promise((ok,bad)=>{const child=spawn(process.execPath,['tests/qianqi/postgres-child.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,QIANQI_TEST:JSON.stringify({url:url('lp_jobs'),p,m,archive,digest:expected.digest})}});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',bad);child.once('exit',code=>code===0?ok():bad(Error('QIANQI recovery child failed: '+output)));});
  assert.deepEqual(await read(),expected);
 });
 report.qianqi={project:p,module:m,digest:expected.digest,head:expected.payload.provenance.head,counts:expected.payload.counts,executionEligible:false,archive};
}
