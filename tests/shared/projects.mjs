import {exerciseQianqi} from './qianqi.mjs';
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer as tcpServer } from 'node:net';
import { createServer,request } from 'node:http';
import pg from 'pg';
import { migrate } from '../../db/migrate.mjs';
import { createPool,verifyRole,inProject,readProject,claimViewJob } from '../../server/shared/store.mjs';
import { sharedApi } from '../../server/shared/api.mjs';
import { exerciseChainRead } from './chain-read.mjs';
import { exerciseTicketShadow } from './tickets.mjs';
import { exerciseFinancial } from './financial.mjs';

const run=promisify(execFile),dir=resolve('.local/test-results/shared-'+new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(dir,{recursive:true});
const bin=process.env.PG_BIN||'C:/Program Files/PostgreSQL/17/bin';
const command=(name,args)=>{
  const executable=join(bin,name+(process.platform==='win32'?'.exe':''));
  // pg_ctl's daemon may inherit pipe handles on Windows: wait for exit, not pipe closure.
  if(name==='pg_ctl')return new Promise((ok,bad)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:'ignore'});
    child.once('error',bad);child.once('exit',code=>code===0?ok():bad(Error('pg_ctl exit '+code)));
  });
  return run(executable,args,{windowsHide:true,maxBuffer:1024*1024});
};
const report={startedAt:new Date().toISOString(),scenarios:[],scope:process.argv.includes('--tickets')||process.argv.includes('--financial')||process.argv.includes('--worker')
  ?'Isolated PostgreSQL plus local chain31337 fork; test-only transactions; no production operations'
  :'Isolated local PostgreSQL; synthetic projects; no chain or financial operations'};
const scenario=async(name,fn)=>{await fn();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);};
const p1='11111111-1111-4111-8111-111111111111',p2='22222222-2222-4222-8222-222222222222';
const m1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',m2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const j1='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const address=n=>'0x'+n.toString(16).padStart(40,'0'),hash='0x'+'1'.repeat(64);
let started=false,admin,api,jobs,restored,server;
try{
  const socket=tcpServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const data=join(dir,'pgdata');
  await command('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','-E','UTF8']);
  await command('pg_ctl',['-D',data,'-l',join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
  const url=(user,db='launchpad')=>`postgresql://${user}@127.0.0.1:${port}/${db}`;
  admin=new pg.Client({connectionString:url('postgres','postgres')});await admin.connect();
  await admin.query('CREATE ROLE lp_owner NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE lp_api LOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE lp_jobs LOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE lp_ingest LOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE lp_executor LOGIN NOSUPERUSER NOBYPASSRLS');
  await admin.query('CREATE DATABASE launchpad OWNER lp_owner');await admin.end();
  admin=new pg.Client({connectionString:url('postgres')});await admin.connect();
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await migrate(admin);await migrate(admin);
  await admin.query(`INSERT INTO launchpad.projects VALUES ($1,'alpha','Alpha',31337,$3,'test'),($2,'beta','Beta',31337,$4,'test')`,[p1,p2,address(1),address(2)]);
  await admin.query("INSERT INTO launchpad.project_domains VALUES ('alpha.localhost',$1),('beta.localhost',$2)",[p1,p2]);
  for(const [project,module,program,block] of [[p1,m1,10,'123'],[p2,m2,20,'456']]){
    await admin.query("INSERT INTO launchpad.module_instances VALUES($1,$2,'short','synthetic-v1',$3,$4)",[project,module,address(program),'a'.repeat(64)]);
    await admin.query('INSERT INTO launchpad.project_cursors VALUES($1,$2,$3,$4)',[project,module,block,hash]);
    await admin.query("INSERT INTO launchpad.jobs(project_id,id,module_id,kind,dedupe_key) VALUES($1,$2,$3,'refresh-view',$4)",[project,j1,module,address(99)]);
  }
  api=createPool(url('lp_api'));jobs=createPool(url('lp_jobs'));await verifyRole(api,'lp_api');await verifyRole(jobs,'lp_jobs');
  server=createServer(sharedApi(api));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const http=(host,path='/api/project',headers={},method='GET')=>new Promise((ok,bad)=>{
    const req=request({host:'127.0.0.1',port:server.address().port,path,method,headers:{Host:host,...headers}},res=>{
      let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>ok({status:res.statusCode,headers:res.headers,body:JSON.parse(body)}));
    });req.on('error',bad);req.end();
  });
  await scenario('Host routing and read-only API cannot be redirected by project id or proxy headers',async()=>{
    const a=await http('alpha.localhost'),b=await http('beta.localhost');
    assert.equal(a.body.project.id,p1);assert.equal(b.body.project.id,p2);
    assert.equal(a.body.modules[0].program_address,address(10));assert.equal(b.body.modules[0].block_number,'456');
    assert.equal(a.headers['cache-control'],'no-store');
    assert.equal((await http('unknown.localhost')).status,421);
    assert.equal((await http('alpha.localhost','/api/project?project_id='+p2)).status,404);
    assert.equal((await http('alpha.localhost','/api/project',{'X-Forwarded-Host':'beta.localhost','X-Project-Id':p2})).body.project.id,p1);
    assert.equal((await http('alpha.localhost','/api/project',{},'POST')).status,405);
    assert.equal((await http('alpha.localhost.')).status,400);
    assert.equal((await http('ALPHA.localhost:4180')).body.project.id,p1);
  });
  await scenario('RLS denies unscoped/cross-project reads and API database writes',async()=>{
    assert.equal((await api.query('SELECT * FROM launchpad.projects')).rowCount,0);
    await inProject(api,p1,async client=>{
      assert.equal((await client.query('SELECT * FROM launchpad.module_instances')).rows[0].project_id,p1);
      assert.equal((await client.query('SELECT * FROM launchpad.module_instances WHERE project_id=$1',[p2])).rowCount,0);
    });
    await assert.rejects(inProject(api,p1,c=>c.query("UPDATE launchpad.projects SET display_name='bad' WHERE id=$1",[p1]),{readOnly:false}),e=>e.code==='42501');
    await assert.rejects(api.query('SELECT * FROM launchpad.jobs'),e=>e.code==='42501');
    await assert.rejects(api.query('SELECT * FROM launchpad.project_domains'),e=>e.code==='42501');
    await assert.rejects(api.query('SET ROLE lp_owner'),e=>e.code==='42501');
  });
  await scenario('Composite keys, RLS writes and scoped job claims prevent cross-project mutation',async()=>{
    await assert.rejects(inProject(jobs,p1,c=>c.query("INSERT INTO launchpad.jobs(project_id,id,module_id,kind,dedupe_key) VALUES($1,$2,$3,'refresh-view','foreign')",[p1,m1,m2]),{readOnly:false}),e=>e.code==='23503');
    await assert.rejects(inProject(jobs,p1,c=>c.query("INSERT INTO launchpad.jobs(project_id,id,module_id,kind,dedupe_key) VALUES($1,$2,$3,'refresh-view','foreign')",[p2,m1,m2]),{readOnly:false}),e=>e.code==='42501');
    const claims=await Promise.all([claimViewJob(jobs,p1),claimViewJob(jobs,p1)]);assert.equal(claims.filter(Boolean).length,1);
    assert.equal((await claimViewJob(jobs,p2)).project_id,p2);
    await inProject(jobs,p1,async c=>{assert.equal((await c.query("UPDATE launchpad.jobs SET status='failed' WHERE project_id=$1",[p2])).rowCount,0);},{readOnly:false});
    const beta=await inProject(jobs,p2,c=>c.query('SELECT status FROM launchpad.jobs'));assert.equal(beta.rows[0].status,'running');
  });
  await scenario('Concurrent pooled requests and rollback do not leak project context',async()=>{
    await assert.rejects(inProject(api,p1,async()=>{throw Error('deliberate rollback');}),/deliberate/);
    const answers=await Promise.all(Array.from({length:24},(_,i)=>http(i%2?'alpha.localhost':'beta.localhost')));
    answers.forEach((answer,i)=>assert.equal(answer.body.project.id,i%2?p1:p2));
    assert.equal((await api.query('SELECT * FROM launchpad.projects')).rowCount,0);
    assert.equal((await readProject(api,p1)).project.slug,'alpha');
  });
  await exerciseChainRead({admin,jobs,api,url,scenario,p1,p2,m1,m2,report});
  if(process.argv.includes('--qianqi-adapter'))await (await import('./qianqi-adapter.mjs')).exerciseQianqiAdapter({admin,jobs,api,url,scenario,dir,report});
  if(process.argv.includes('--qianqi')||process.argv.includes('--qianqi-live'))await exerciseQianqi({admin,jobs,api,url,scenario,dir,report});
  if(process.argv.includes('--qianqi-live'))await (await import('./qianqi-live.mjs')).exerciseQianqiLive({admin,jobs,api,url,scenario,report});
  if(process.argv.includes('--tickets'))await exerciseTicketShadow({admin,jobs,api,url,scenario,dir,report});
  if(process.argv.includes('--financial'))await exerciseFinancial({admin,jobs,api,url,scenario,report});
  if(process.argv.includes('--worker'))await scenario('Full PostgreSQL worker rehearsal on an isolated Pons fork',async()=>{
    let output='';
    await new Promise((ok,bad)=>{
      const child=spawn(process.execPath,['tests/fork/first-token.mjs','--postgres-worker'],{windowsHide:true,
        env:{...process.env,SHARED_TEST_DATABASES:JSON.stringify({admin:url('postgres'),executor:url('lp_executor'),jobs:url('lp_jobs'),ingest:url('lp_ingest')})},stdio:['ignore','pipe','pipe']});
      child.stdout.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});child.stderr.on('data',chunk=>process.stderr.write(chunk));
      child.once('error',bad);child.once('exit',code=>code===0?ok():bad(Error('Postgres worker rehearsal exited '+code)));
    });
    const path=output.trim().split(/\r?\n/).at(-1),result=JSON.parse(readFileSync(path,'utf8'));
    assert.equal(result.status,'PASS');report.postgresWorker=result.postgresWorker;report.workerReport=path;report.workerScenarios=result.scenarios;
  });
  await scenario('Backup restores schema, project data and role restrictions in another database',async()=>{
    const backup=join(dir,'launchpad.dump');
    await command('pg_dump',['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','launchpad','-Fc','-f',backup]);
    await admin.query('CREATE DATABASE launchpad_restored OWNER lp_owner');
    await command('pg_restore',['-h','127.0.0.1','-p',String(port),'-U','postgres','-d','launchpad_restored','--exit-on-error',backup]);
    restored=createPool(url('lp_api','launchpad_restored'));await verifyRole(restored,'lp_api');
    assert.deepEqual(await readProject(restored,p1),await readProject(api,p1));
    assert.deepEqual(await readProject(restored,p2),await readProject(api,p2));
    assert.equal((await restored.query('SELECT * FROM launchpad.projects')).rowCount,0);
    await assert.rejects(restored.query('SELECT * FROM launchpad.jobs'),e=>e.code==='42501');
    const restoredJobs=createPool(url('lp_jobs','launchpad_restored'));
    try{
      for(const project of [p1,p2]){
        const read=pool=>inProject(pool,project,async c=>({
          subscriptions:(await c.query('SELECT * FROM launchpad.read_subscriptions ORDER BY module_id')).rows,
          evidence:(await c.query('SELECT * FROM launchpad.project_evidence ORDER BY module_id,number')).rows
        }));
        assert.deepEqual(await read(restoredJobs),await read(jobs));
      }
      assert.deepEqual((await restoredJobs.query('SELECT * FROM launchpad.chain_sources ORDER BY id')).rows,(await jobs.query('SELECT * FROM launchpad.chain_sources ORDER BY id')).rows);
      assert.deepEqual((await restoredJobs.query('SELECT * FROM launchpad.chain_blocks ORDER BY source_id,number')).rows,(await jobs.query('SELECT * FROM launchpad.chain_blocks ORDER BY source_id,number')).rows);
      assert.equal((await restoredJobs.query('SELECT * FROM launchpad.project_evidence')).rowCount,0);
      for(const project of [...(report.ticketShadow?.projects??[]),...(report.postgresWorker?.projects??[])]){
        const read=pool=>inProject(pool,project,async c=>(await c.query('SELECT * FROM launchpad.ticket_shadows ORDER BY module_id')).rows);
        assert.deepEqual(await read(restoredJobs),await read(jobs));
        for(const table of ['ticket_ledgers','ticket_events','ticket_credits','ticket_wallets','ticket_commitments','ticket_snapshots']){
          const contents=pool=>inProject(pool,project,async c=>(await c.query('SELECT * FROM launchpad.'+table+' ORDER BY 1,2,3')).rows);
          assert.deepEqual(await contents(restoredJobs),await contents(jobs));
          assert.equal((await restoredJobs.query('SELECT * FROM launchpad.'+table)).rowCount,0);
        }
      }
      if(report.qianqi)for(const table of ['qianqi_imports','qianqi_history_rows','qianqi_live_heads','qianqi_live_halts','qianqi_live_bodies']){
        const rows=pool=>inProject(pool,report.qianqi.project,async c=>(await c.query('SELECT * FROM launchpad.'+table+(table==='qianqi_live_halts'?' ORDER BY 1,2,3':' ORDER BY 1,2,3,4'))).rows);
        assert.deepEqual(await rows(restoredJobs),await rows(jobs));
        assert.equal((await restoredJobs.query('SELECT * FROM launchpad.'+table)).rowCount,0);
      }
      if(report.qianqiLive){
        const {readQianqiLive}=await import('../../server/shared/qianqi-live.mjs');
        assert.deepEqual(await readQianqiLive(restoredJobs,report.qianqi.project,report.qianqi.module),await readQianqiLive(jobs,report.qianqi.project,report.qianqi.module));
      }
      assert.equal((await restoredJobs.query('SELECT * FROM launchpad.ticket_shadows')).rowCount,0);
      for(const table of ['financial_executors','financial_operations'])await assert.rejects(restoredJobs.query('SELECT * FROM launchpad.'+table),e=>e.code==='42501');
      const financial=createPool(url('lp_executor')),restoredFinancial=createPool(url('lp_executor','launchpad_restored'));
      if(report.qianqiAdapter){
        const {executorProject,viewProject}=report.qianqiAdapter;
        const bindings=p=>inProject(p,executorProject,async c=>(await c.query('SELECT * FROM launchpad.qianqi_executors')).rows);
        assert.deepEqual(await bindings(restoredFinancial),await bindings(financial));
        const views=p=>inProject(p,viewProject,async c=>(await c.query('SELECT * FROM launchpad.qianqi_api_views')).rows);
        assert.deepEqual(await views(restoredJobs),await views(jobs));
      }
      try{
        for(const project of [...(report.financial?.projects??[]),...(report.postgresWorker?.projects??[])])for(const table of ['financial_executors','financial_operations','worker_states']){
          const read=pool=>inProject(pool,project,async c=>(await c.query('SELECT * FROM launchpad.'+table+' ORDER BY 1,2,3')).rows);
          assert.deepEqual(await read(restoredFinancial),await read(financial));
        }
        assert.equal((await restoredFinancial.query('SELECT * FROM launchpad.financial_operations')).rowCount,0);
        assert.equal((await restoredFinancial.query('SELECT * FROM launchpad.worker_states')).rowCount,0);
      }finally{await financial.end();await restoredFinancial.end();}
    }finally{await restoredJobs.end();}
  });
  report.status='PASS';report.postgres=(await admin.query('SHOW server_version')).rows[0].server_version;
}catch(error){report.status='FAIL';report.error=String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[database]');console.log('FAIL '+report.error);process.exitCode=1;}
finally{
  if(server)await new Promise(r=>server.close(r));
  await Promise.allSettled([api?.end(),jobs?.end(),restored?.end(),admin?.end()]);
  if(started)await command('pg_ctl',['-D',join(dir,'pgdata'),'-m','fast','-w','stop']);
  report.finishedAt=new Date().toISOString();writeFileSync(join(dir,'report.json'),JSON.stringify(report,null,2));console.log(join(dir,'report.json'));
}
