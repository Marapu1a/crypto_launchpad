// Local owner UI; no fixture signer, key decryption or transaction broadcaster.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {JsonRpcProvider,FetchRequest} from 'ethers';
import {createPool,verifyRole} from '../server/shared/store.mjs';
import {privateText} from '../server/short-runtime/config.mjs';
import {validateProductionProfile,verifyProductionEnvironment} from '../server/owner-launch/production-profile.mjs';
import {createDrawOwnerCoordinator} from '../server/owner-launch/draw-coordinator.mjs';
import {registerDeployedDraw} from '../server/owner-launch/draw-handoff.mjs';
import {createRuntimeHandoff} from '../server/owner-launch/handoff.mjs';
import {ownerLaunchHttp} from '../server/owner-launch/http.mjs';

let provider,pools,server,phase='configuration';
try{
 const c=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
 if(c.schema!=='owner-production-v2'||typeof c.allowPublicTransactions!=='boolean'||!Number.isInteger(c.httpPort)||c.httpPort<1024||c.httpPort>65535||c.defaults?.draws?.version!==2)throw Error();
 validateProductionProfile(c.profile);
 phase='public-network';const rpc=new FetchRequest(await privateText(c.rpcFile));rpc.timeout=15000;
 provider=new JsonRpcProvider(rpc,undefined,{cacheTimeout:-1});await verifyProductionEnvironment(provider,c.profile);
 phase='database';pools={};for(const role of ['admin','executor','api'])pools[role]=createPool(await privateText(c.databaseFiles[role]));
 await verifyRole(pools.executor,'lp_executor');await verifyRole(pools.api,'lp_api');
 const {rows:[schema]}=await pools.admin.query('SELECT max(version) AS version FROM launchpad.schema_migrations');
 if(schema.version!==15)throw Error('Owner v2 requires migrations through 015');
 const coordinator=createDrawOwnerCoordinator({pool:pools.executor,adminPool:pools.admin,provider,profile:c.profile,allowPublicTransactions:c.allowPublicTransactions});
 const runtime={schema:'draw-runtime-config-v2',mode:'production',intervalMs:15000,concurrency:1,rpcFile:c.rpcFile,databaseFile:c.databaseFiles.executor,healthFile:c.healthFile};
 const handoff=async projectId=>{await registerDeployedDraw({pool:pools.executor,adminPool:pools.admin,provider,projectId,owner:c.profile.owner});return createRuntimeHandoff({pool:pools.executor,apiPool:pools.api,profile:c.profile,runtime,keys:{[projectId]:c.keys},baseDomain:c.baseDomain})(projectId);};
 const middleware=ownerLaunchHttp({coordinator,defaults:c.defaults,handoff});
 server=createServer((req,res)=>middleware(req,res,async()=>{
  try{
   if(!['GET','HEAD'].includes(req.method)||!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host??''))throw Error();
   const url=req.url.split('?')[0],name=['/','/owner.html'].includes(url)?'owner.html':url.startsWith('/assets/')?url.slice(1):null;
   if(!name||name.includes('..')||name.includes('%')||name.includes('\\'))throw Error();
   const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'}[path.extname(name)];if(!type)throw Error();
   const bytes=await fs.readFile(path.resolve('dist',name));res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404);res.end();}
 }));
 server.requestTimeout=30000;server.headersTimeout=15000;phase='listen';
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(c.httpPort,'127.0.0.1',ok);});
 console.log('Owner production UI: http://127.0.0.1:'+c.httpPort+'/owner.html; signing '+(c.allowPublicTransactions?'enabled':'DISABLED'));
 const stop=async()=>{await new Promise(r=>server.close(r));await Promise.allSettled(Object.values(pools).map(p=>p.end()));provider.destroy();};
 process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
}catch{console.error('Owner production UI unavailable at '+phase);server?.close();await Promise.allSettled(Object.values(pools??{}).map(p=>p.end()));provider?.destroy();process.exitCode=1;}
