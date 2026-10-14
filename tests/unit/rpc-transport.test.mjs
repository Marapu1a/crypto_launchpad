import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {runtimeProvider} from '../../server/short-runtime/rpc-provider.mjs';

test('429 and redirects cannot generate unmetered HTTP attempts',async()=>{
 let requests=0,reservations=0,status=429;
 const server=createServer((req,res)=>{requests++;res.writeHead(status,{location:`http://127.0.0.1:${server.address().port}/redirect`});res.end('unavailable');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const provider=runtimeProvider(`http://127.0.0.1:${server.address().port}`,{gate:async()=>{reservations++;}});
 try{
  for(status of [429,301,302,307,308]){
   const before=requests;
   await assert.rejects(provider._send({id:1,jsonrpc:'2.0',method:'eth_blockNumber',params:[]}));
   assert.equal(requests,before+1);assert.equal(requests,reservations);
  }
 }finally{provider.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
