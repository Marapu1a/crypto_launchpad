import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {loadPwOwnerSigner} from '../server/owner-launch/pw-signer.mjs';
import {privateText} from '../server/short-runtime/config.mjs';
import {operatorRpc} from '../server/shared/rpc-policy.mjs';
import {createPool,verifyRole} from '../server/shared/store.mjs';
import {createPwOwnerCoordinator} from '../server/owner-launch/pw-coordinator.mjs';
import {createPwConsole,pwConsoleHttp} from '../server/owner-launch/pw-console.mjs';

let server,pool,provider;
try{
 const c=JSON.parse(await privateText(process.argv[2]));
 if(c.schema!=='pw-operator-v1'||c.profile?.mode!=='production'||typeof c.allowPublicTransactions!=='boolean'||!Number.isInteger(c.httpPort)||c.httpPort<1024||c.httpPort>65535||c.launchInput?.id!==c.profile.id)throw Error('Invalid private PW UI configuration');
 const rpc=await operatorRpc(await privateText(c.rpcFile),c);provider=rpc.provider;
 pool=createPool(await privateText(c.databaseFiles.executor));await verifyRole(pool,'lp_executor');
 const preparation=JSON.parse(await readFile(new URL('../tokens/PatternWatcher/preparation.json',import.meta.url),'utf8'));
 const coordinator=createPwOwnerCoordinator({pool,provider,profile:c.profile,preparation,allowPublicTransactions:c.allowPublicTransactions});
 const signer=await loadPwOwnerSigner(c);
 const app=createPwConsole({coordinator,input:c.launchInput,owner:c.profile.owner,signer,browserWallet:c.browserWallet===true,enabled:c.allowPublicTransactions,usage:rpc.usage});
 const origin='http://127.0.0.1:'+c.httpPort,middleware=pwConsoleHttp(app,{origin});
 server=createServer((req,res)=>middleware(req,res,async()=>{
  try{
   if(req.headers.host!==new URL(origin).host||!['GET','HEAD'].includes(req.method))throw Error();
   const url=req.url.split('?')[0],file=['/','/pw-owner.html'].includes(url)?'pw-owner.html':/^\/assets\/[a-zA-Z0-9_.-]+$/.test(url)?url.slice(1):null;
   if(!file)throw Error();
   const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(file)];if(!type)throw Error();
   const bytes=await readFile(resolve('dist',file));
   res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404);res.end();}
 }));
 server.requestTimeout=30000;server.headersTimeout=15000;
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(c.httpPort,'127.0.0.1',ok);});
 console.log('PW owner: '+origin+'; sending '+(c.allowPublicTransactions?'ENABLED':'DISABLED'));
 const stop=async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();provider.destroy();};
 process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
}catch{console.error('PW owner unavailable. Check private configuration, budget and journal.');server?.close();await pool?.end();provider?.destroy();process.exitCode=1;}
