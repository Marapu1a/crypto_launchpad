import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,get} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {loadPreparedLogo} from '../../server/owner-launch/prepared-logo.mjs';
import {ownerLaunchHttp} from '../../server/owner-launch/http.mjs';

test('Prepared project image is pinned and served without accepting file paths from HTTP',async()=>{
 const bytes=await readFile('tokens/IGW/igw_logo.png'),uri='ipfs://prepared-logo';
 const asset={path:'tokens/IGW/igw_logo.png',uri,sha256:createHash('sha256').update(bytes).digest('hex')};
 const preparedLogo=await loadPreparedLogo(asset,uri);assert.equal(preparedLogo.mime,'image/png');
 for(const change of [{path:'../secrets.png'},{path:'tokens/IGW/../../secrets.png'},{sha256:'0'.repeat(64)},{uri:'ipfs://different'}])await assert.rejects(loadPreparedLogo({...asset,...change},uri));
 const actions=[],coordinator={info:()=>({}),run:async(...args)=>{actions.push(args);return {};}};
 const server=createServer(ownerLaunchHttp({coordinator,defaults:{},preparedLogo}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 try{
  const image=await fetch(url+'/api/owner-launch/logo');assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);
  const config=await(await fetch(url+'/api/owner-launch/config')).json();assert.deepEqual(config.preparedLogo,{path:asset.path,previewUrl:'/api/owner-launch/logo'});
  const arbitrary=await fetch(url+'/api/owner-launch/logo?file=/etc/passwd');assert.deepEqual(Buffer.from(await arbitrary.arrayBuffer()),bytes);
  const foreign=await new Promise((ok,bad)=>get(url+'/api/owner-launch/logo',{headers:{host:'foreign.example'}},res=>{res.resume();ok(res.statusCode);}).on('error',bad));assert.equal(foreign,403);
  const mismatch=await fetch(url+'/api/owner-launch/11111111-1111-4111-8111-111111111111/create',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({input:{draft:{logo:'ipfs://other'}}})});assert.equal(mismatch.status,409);assert.deepEqual(actions,[]);
 }finally{await new Promise(r=>server.close(r));}
});
