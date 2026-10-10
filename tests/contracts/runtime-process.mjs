import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {Wallet} from 'ethers';
import {digest} from '../../src/tickets/digest.mjs';

// Actual executable, actual encrypted keys, actual PG journals. Only chain RPC is
// served from the isolated test node. Restart does not roll back that node or DB.
export async function exerciseRuntimeProcess({root,provider,hre,db,projects}){
 const dir=resolve(root,'service');await mkdir(dir,{recursive:true});
 let child;const server=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const input=JSON.parse(Buffer.concat(chunks));
  const one=async x=>{try{return {jsonrpc:'2.0',id:x.id,result:await hre.network.provider.request({method:x.method,params:x.params})};}catch{return {jsonrpc:'2.0',id:x.id,error:{code:-32000,message:'Fixture RPC error'}};}};
  const result=Array.isArray(input)?await Promise.all(input.map(one)):await one(input);res.setHeader('content-type','application/json');res.end(JSON.stringify(result));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const privateFile=async(name,text)=>{const file=join(dir,name);await writeFile(file,text,{mode:0o600});return file;};
 const stop=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill();await done;}child=null;};
 try{
  const meta=await provider.send('hardhat_metadata',[]);
  const config={schema:'short-runtime-config-v1',mode:'rehearsal',instanceId:meta.instanceId,intervalMs:1000,concurrency:2,
   rpcFile:await privateFile('rpc.txt','http://127.0.0.1:'+server.address().port),databaseFile:await privateFile('db.txt',db.url('lp_executor')),healthFile:join(dir,'health.json'),projects:[]};
  for(const p of projects){
   const entry={projectId:p.projectId,moduleId:p.moduleId,enabled:true,policyHash:digest(p.policy)};
   for(const [role,signer] of [['executor',p.signer],['publisher',p.publisher]])entry[role]={keyFile:await privateFile(p.projectId+'-'+role+'.json',await new Wallet(signer.privateKey).encrypt('runtime-test-password')),passwordFile:await privateFile(p.projectId+'-'+role+'.password','runtime-test-password')};
   config.projects.push(entry);
  }
  const file=await privateFile('config.json',JSON.stringify(config));
  const before=await Promise.all(projects.map(p=>provider.getTransactionCount(p.signer.address)));
  let previous='';
  for(let restart=0;restart<2;restart++){
   child=spawn(process.execPath,['server/short-runtime/start.mjs',file],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
   let health;const deadline=Date.now()+45000;
   while(Date.now()<deadline){
    assert.equal(child.exitCode,null,'Runtime exited: '+output);
    try{health=JSON.parse(await readFile(config.healthFile,'utf8'));if(health.completedAt!==previous)break;}catch{}
    await new Promise(r=>setTimeout(r,100));
   }
   assert.ok(health&&health.completedAt!==previous,'Runtime did not publish health');previous=health.completedAt;
   assert.ok(health.projects.every(p=>p.status==='waiting'),JSON.stringify(health.projects));
   assert.ok(!output.includes('runtime-test-password'));await stop();
  }
  assert.deepEqual(await Promise.all(projects.map(p=>provider.getTransactionCount(p.signer.address))),before);
 }finally{await stop();await new Promise(r=>server.close(r));}
}
