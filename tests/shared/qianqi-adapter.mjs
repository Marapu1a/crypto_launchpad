import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {Wallet} from 'ethers';
import {createPool,inProject} from '../../server/shared/store.mjs';
import {withQianqiExecutor} from '../../server/adapters/qianqi/executor.mjs';
import {loadQianqiApiAdapters} from '../../server/adapters/qianqi/api.mjs';
import {publishSnapshot,createDatabaseReader} from '../../server/adapters/qianqi/read-model.mjs';
const require=createRequire(import.meta.url),{hash}=require('../../server/adapters/qianqi/runtime/scripts/direct-buy.cjs');
export async function exerciseQianqiAdapter({admin,api,jobs,url,scenario,report}){
 const p='dddddddd-1111-4111-8111-111111111111',p2='dddddddd-2222-4222-8222-222222222222';
 const token='0x'+'17'.repeat(20),sender='0x'+'29'.repeat(20),binding={schema:'existing-qianqi-v1',projectId:p,chainId:'4663',sender,token};
 await admin.query("INSERT INTO launchpad.projects VALUES($1,'q-adapter','Q adapter',4663,$3,'test'),($2,'q-other','Other',4663,$4,'test')",[p,p2,token,'0x'+'18'.repeat(20)]);
 await admin.query('INSERT INTO launchpad.qianqi_executors VALUES($1,4663,$2,$3)',[p,sender,hash(binding)]);
 const pool=createPool(url('lp_executor'));
 try{
  await scenario('Independent processes cannot sign competing payloads for the same sender and nonce',async()=>{
   const wallet=Wallet.createRandom(),b={...binding,sender:wallet.address.toLowerCase()};
   await admin.query('UPDATE launchpad.qianqi_executors SET sender=$2,binding_hash=$3 WHERE project_id=$1',[p,b.sender,hash(b)]);
   const children=[];
   const start=data=>{
    const child=fork(new URL('./qianqi-writer-child.mjs',import.meta.url),[],{stdio:['ignore','ignore','inherit','ipc'],windowsHide:true});
    children.push(child);
    const result=once(child,'message',{signal:AbortSignal.timeout(15000)});
    child.send({url:url('lp_executor'),binding:b,key:wallet.privateKey,data});
    return {child,result};
   };
   try{
    const first=start('0x01');assert.equal((await first.result)[0].status,'signed');
    const second=start('0x02'),refused=(await second.result)[0];
    assert.equal(refused.status,'refused');assert.match(refused.reason,/already running/);
    const exited=once(first.child,'exit');first.child.send('release');await exited;
    // A clean successor is admitted only after the first process exits.
    const successor=start('0x01');assert.equal((await successor.result)[0].status,'signed');
    const done=once(successor.child,'exit');successor.child.send('release');await done;
   }finally{
    await Promise.all(children.filter(c=>c.exitCode===null&&c.signalCode===null).map(async c=>{const done=once(c,'exit');c.kill();await done;}));
    await admin.query('UPDATE launchpad.qianqi_executors SET sender=$2,binding_hash=$3 WHERE project_id=$1',[p,sender,hash(binding)]);
   }
  });
  await scenario('QIANQI signer lease excludes a second executor, rejects foreign binding and survives normal restart',async()=>{
   await withQianqiExecutor(pool,binding,async check=>{
    await check();await assert.rejects(withQianqiExecutor(pool,binding,async()=>assert.fail('second executor')),/already running/);
   });
   await withQianqiExecutor(pool,binding,async check=>check());
   await assert.rejects(withQianqiExecutor(pool,{...binding,token:'0x'+'33'.repeat(20)},async()=>assert.fail()),/binding unavailable/);
   await assert.rejects(admin.query('INSERT INTO launchpad.qianqi_executors VALUES($1,4663,$2,$3)',[p2,sender,hash(binding)]),e=>e.code==='23505');
  });
  await scenario('Lost PostgreSQL session permanently closes the active execution fence',async()=>{
   await withQianqiExecutor(pool,binding,async check=>{
    const {rows}=await admin.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted AND pid<>pg_backend_pid()");
    assert.equal(rows.length,1);
    await admin.query('SELECT pg_terminate_backend($1)',[rows[0].pid]);
    await assert.rejects(check(),/lease lost|binding unavailable/);
    await assert.rejects(check(),/lease lost/);
   });
   await withQianqiExecutor(pool,binding,async check=>check());
  });
  await scenario('API/jobs cannot read executor bindings; executor cannot rewrite an admission',async()=>{
   for(const denied of [api,jobs])await assert.rejects(denied.query('SELECT * FROM launchpad.qianqi_executors'),e=>e.code==='42501');
   assert.equal((await pool.query('SELECT * FROM launchpad.qianqi_executors')).rowCount,0);
   await inProject(pool,p2,async c=>assert.equal((await c.query('SELECT * FROM launchpad.qianqi_executors')).rowCount,0));
   await assert.rejects(inProject(pool,p,c=>c.query("UPDATE launchpad.qianqi_executors SET sender=$1",[sender]),{readOnly:false}),e=>e.code==='42501');
  });
  await scenario('API registry pins project and configuration without reading private files',async()=>{
   const entry={projectId:p,configHash:hash({fixture:true})},registry={schema:'qianqi-api-registry-v1',projects:[entry]};
   await admin.query('INSERT INTO launchpad.qianqi_api_views(project_id,config_hash) VALUES($1,$2)',[p,entry.configHash]);
   await assert.rejects(admin.query('UPDATE launchpad.qianqi_api_views SET head_number=1 WHERE project_id=$1',[p]),e=>e.code==='23514');
   let closes=0;const handlerFactory=()=>({handle(){},close(){closes++;}});
   const adapters=await loadQianqiApiAdapters(api,registry,{handlerFactory});assert.equal(adapters.size,1);adapters.get(p).close();
   await assert.rejects(loadQianqiApiAdapters(api,{...registry,projects:[entry,{...entry,projectId:p2}]},{handlerFactory}),/pinned/);
   assert.equal(closes,2);
   await assert.rejects(loadQianqiApiAdapters(api,{...registry,projects:[{...entry,configHash:hash({changed:true})}]},{handlerFactory}),/pinned/);
  });
  await scenario('PostgreSQL projection reproduces overview/wallet exactly, enforces freshness, RLS, branch and checksum',async()=>{
   const fixture=require('./qianqi-api-fixture.cjs')(),{config,raw,wallet}=fixture;
   const project='dddddddd-3333-4333-8333-333333333333';
   await admin.query("INSERT INTO launchpad.projects VALUES($1,'q-view','Q view',$2,$3,'test')",[project,config.manifest.chainId,config.manifest.token.toLowerCase()]);
   await admin.query('INSERT INTO launchpad.qianqi_api_views(project_id,config_hash) VALUES($1,$2)',[project,hash(config)]);
   await publishSnapshot(jobs,project,config,raw);
   const stored=(await admin.query('SELECT view_text FROM launchpad.qianqi_api_views WHERE project_id=$1',[project])).rows[0].view_text;
   assert(!stored.includes(config.indexer.statePath));
   report.qianqiAdapter={executorProject:p,viewProject:project};
   const reader=createDatabaseReader(api,project,hash(config)),native=require('../../server/adapters/qianqi/runtime/scripts/user-status-api.cjs'),view=native.prepare(config,raw),now=Date.now();
   for(const query of [{now},{wallet,now},{wallet,offset:1,limit:1,now},{now:now+61000}])assert.deepEqual(await reader.read(query),native.render(config,view,query));
   assert.equal((await createDatabaseReader(api,p2,hash(config)).read({})).status,'unavailable');
   await assert.rejects(publishSnapshot(jobs,p2,config,raw),/project mismatch/);
   await admin.query('UPDATE launchpad.qianqi_api_views SET head_number=head_number+1 WHERE project_id=$1',[project]);
   await assert.rejects(publishSnapshot(jobs,project,config,raw),/branch refused/);
   await admin.query("UPDATE launchpad.qianqi_api_views SET view_text='{}' WHERE project_id=$1",[project]);
   assert.equal((await reader.read({})).status,'unavailable');
   await assert.rejects(inProject(api,project,c=>c.query("UPDATE launchpad.qianqi_api_views SET view_text='{}'"),{readOnly:false}),e=>e.code==='42501');
   await assert.rejects(inProject(jobs,project,c=>c.query("UPDATE launchpad.qianqi_api_views SET config_hash=$1",[hash({})]),{readOnly:false}),e=>e.code==='42501');
  });
 }finally{await pool.end();}
}
