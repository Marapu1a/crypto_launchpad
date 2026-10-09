// Exercise the restored API on an ephemeral loopback port under the real lp_api role.
import fs from 'node:fs';
import {createServer,request} from 'node:http';
import assert from 'node:assert/strict';
import pg from 'pg';
import {loadQianqiApiAdapters} from '../server/adapters/qianqi/api.mjs';
import {sharedApi} from '../server/shared/api.mjs';
import {verifyRole} from '../server/shared/store.mjs';
const [inputFile]=process.argv.slice(2),input=JSON.parse(fs.readFileSync(inputFile));
assert.match(input.database,/^launchpad_recovery_[a-z0-9_]+$/);
const binding=JSON.parse(fs.readFileSync(input.bindingFile));
const pool=new pg.Pool({host:'/var/run/postgresql',database:input.database,user:'postgres',max:2,
 options:'-c role=lp_api -c default_transaction_read_only=on -c statement_timeout=15000'});
let server,adapters;
try{
 await verifyRole(pool,'lp_api');
 adapters=await loadQianqiApiAdapters(pool,{schema:'qianqi-api-registry-v1',projects:[{projectId:binding.projectId,configHash:binding.indexConfigHash}]});
 assert.equal((await pool.query('SELECT * FROM launchpad.qianqi_api_views')).rowCount,0);
 await assert.rejects(pool.query('SELECT * FROM launchpad.qianqi_executors'),e=>e.code==='42501');
 server=createServer(sharedApi(pool,{projectAdapters:adapters}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const get=(host,method='GET')=>new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:server.address().port,path:'/v1/overview?limit=1',method,headers:{host}},res=>{
   let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
  });req.on('error',reject);req.end();
 });
 const view=await get('qianqi.site');assert.equal(view.status,200);assert.equal(view.body.status,'stale');
 assert.equal((await get('qianqi.site','POST')).status,405);
 assert.equal((await get('unknown-recovery.invalid')).status,421);
 console.log(JSON.stringify({status:'PASS',api:'stale',head:view.body.provenance.head,readOnly:true,role:'lp_api',unscopedRows:0,executorTableDenied:true,financialExecution:false}));
}finally{
 if(server){await new Promise(r=>server.close(r));server.closeAllConnections();}
 if(adapters)for(const a of adapters.values())a.close();await pool.end();
}
