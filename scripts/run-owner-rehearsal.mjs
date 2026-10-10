import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {JsonRpcProvider} from 'ethers';
import {createPool} from '../server/shared/store.mjs';
import {createOwnerCoordinator} from '../server/owner-launch/coordinator.mjs';
import {createRuntimeHandoff} from '../server/owner-launch/handoff.mjs';
import {ownerLaunchHttp} from '../server/owner-launch/http.mjs';
import {rehearsalSigner} from '../server/owner-launch/rehearsal-sign.mjs';

let provider,pools,server;
try{
 const c=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
 if(c.schema!=='owner-rehearsal-v1'||c.profile?.mode!=='rehearsal'||!Number.isInteger(c.httpPort)||c.httpPort<1024||c.httpPort>65535)throw Error('Invalid rehearsal config');
 for(const [value,protocol] of [[c.rpcUrl,'http:'],...Object.values(c.urls).map(u=>[u,'postgresql:'])]){const u=new URL(value);if(u.hostname!=='127.0.0.1'||u.protocol!==protocol)throw Error('Loopback endpoints required');}
 provider=new JsonRpcProvider(c.rpcUrl,undefined,{cacheTimeout:-1});provider.pollingInterval=50;
 const meta=await provider.send('hardhat_metadata',[]);if(meta.instanceId!==c.profile.instanceId||meta.chainId!==4663||meta.forkedNetwork?.forkBlockNumber!==82000000)throw Error('Fork instance changed; old journal cannot resume');
 // Local model only: latest stands for finalized on the private copy.
 const chain=new Proxy(provider,{get(target,key){if(key==='getBlock')return n=>target.getBlock(n==='finalized'?'latest':n);const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
 pools=Object.fromEntries(Object.entries(c.urls).map(([role,url])=>[role,createPool(url)]));
 const coordinator=createOwnerCoordinator({pool:pools.executor,adminPool:pools.admin,provider:chain,profile:c.profile});
 const runtime={schema:'short-runtime-config-v1',mode:'rehearsal',instanceId:c.profile.instanceId,intervalMs:5000,concurrency:1,rpcFile:path.join(c.root,'rpc.txt'),databaseFile:path.join(c.root,'db.txt'),healthFile:path.join(c.root,'short-health.json')};
 const handoff=projectId=>createRuntimeHandoff({pool:pools.executor,apiPool:pools.api,profile:c.profile,runtime,keys:{[projectId]:c.keys},baseDomain:'tokens.localhost'})(projectId);
 const middleware=ownerLaunchHttp({coordinator,defaults:c.defaults,handoff,localSign:rehearsalSigner({pool:pools.executor,provider:chain,profile:c.profile})});
 server=createServer((req,res)=>middleware(req,res,async()=>{
  try{
   if(!['GET','HEAD'].includes(req.method)||! /^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host??''))throw Error();
   const url=req.url.split('?')[0],name=['/','/owner.html'].includes(url)?'owner.html':url.startsWith('/assets/')?url.slice(1):null;
   if(!name||name.includes('..')||name.includes('%')||name.includes('\\'))throw Error();
   const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'}[path.extname(name)];if(!type)throw Error();
   const bytes=await fs.readFile(path.resolve('dist',name));res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404);res.end();}
 }));
 server.requestTimeout=30000;server.headersTimeout=15000;
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(c.httpPort,'127.0.0.1',ok);});
 console.log('Owner rehearsal: http://127.0.0.1:'+c.httpPort+'/owner.html');
 const stop=async()=>{await new Promise(r=>server.close(r));await Promise.allSettled(Object.values(pools).map(p=>p.end()));provider.destroy();};
 process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
}catch{console.error('Owner rehearsal unavailable: check local configuration and the original fork instance.');server?.close();await Promise.allSettled(Object.values(pools??{}).map(p=>p.end()));provider?.destroy();process.exitCode=1;}
