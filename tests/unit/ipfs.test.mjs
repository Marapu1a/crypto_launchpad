import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { ponsPublisher, publicationFromPons, PONS_UPLOAD_PAGE } from '../../server/ipfs.mjs';
import { createApiMiddleware } from '../../server/api.mjs';
import { studioHttp } from '../../server/studio/http.mjs';
const cid = 'bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee';
const content=Buffer.from('image');
function fixture({status=200,result={cid,uri:'ipfs://'+cid},readback=content}={}) {
 const calls=[];let finish;
 const response={url:()=> 'https://ponsfamily.com/api/ipfs/image',request:()=>({method:()=> 'POST'}),ok:()=>status===200,status:()=>status,body:async()=>Buffer.from(JSON.stringify(result))};
 const page={setDefaultTimeout(){},url:()=>PONS_UPLOAD_PAGE,goto:async url=>{assert.equal(url,PONS_UPLOAD_PAGE);calls.push('navigate');},getByPlaceholder:()=>({fill:async()=>calls.push('draft')}),waitForFunction:async()=>calls.push('hydrated'),waitForResponse:predicate=>{assert.equal(predicate(response),true);return new Promise(r=>finish=()=>r(response));},locator:selector=>({setInputFiles:async file=>{assert.equal(selector,'input[type=file]');assert.deepEqual(file.buffer,content);calls.push('file');finish();}})};
 const browser={newPage:async()=>page,close:async()=>calls.push('closed')};
 return {calls,browser,publish:ponsPublisher({launchBrowser:async()=>browser,fetcher:async()=>new Response(readback,{status:readback===null?503:200})})};
}
test('Pons URI requires a matching CID and no unexpected path or protocol',()=>{
 assert.equal(publicationFromPons({cid,uri:'ipfs://'+cid}).uri,'ipfs://'+cid);
 for(const value of [null,{cid,uri:'https://example.com'},{cid,uri:'ipfs://'+cid+'/file'},{cid:'invalid',uri:'ipfs://invalid'}])assert.throws(()=>publicationFromPons(value));
});
test('Helper uses the native file input after hydration, reads back bytes and closes browser',async()=>{
 const f=fixture(),p=await f.publish(content,{type:'image/png'});
 assert.equal(p.verified,true);assert.equal(p.storage,'pons');assert.equal(p.uri,'ipfs://'+cid);
 assert.deepEqual(f.calls,['navigate','draft','hydrated','file','closed']);
});
test('Refusal and malformed reply fail without retry; readback outage keeps the successful URI',async()=>{
 for(const options of [{status:403},{status:429},{result:{uri:'bad'}}]){
  const f=fixture(options);await assert.rejects(f.publish(content,{type:'image/png'}));assert.equal(f.calls.filter(x=>x==='file').length,1);assert.equal(f.calls.at(-1),'closed');
 }
 for(const readback of [null,Buffer.from('wrong')]){
  const f=fixture({readback}),p=await f.publish(content,{type:'image/png'});assert.equal(p.verified,false);assert.equal(p.uri,'ipfs://'+cid);assert.ok(p.warning);
 }
});
test('Concurrent upload is rejected and browser launch failure releases the slot',async()=>{
 let release;
 const f=fixture();const publish=ponsPublisher({launchBrowser:()=>new Promise(r=>release=()=>r(f.browser)),fetcher:async()=>new Response(content)});
 const first=publish(content,{type:'image/png'});
 await assert.rejects(f.publish(content,{type:'image/png'}),/Другая картинка/);release();await first;
 await assert.rejects(ponsPublisher({launchBrowser:async()=>{throw Error('internal path SECRET')}})(content,{type:'image/png'}),/Chromium/);
 assert.equal((await f.publish(content,{type:'image/png'})).verified,true);
});
test('Upload validates bytes before contacting Pons and refuses remote or missing Origin', async t => {
  let calls = 0;
  const api = createApiMiddleware({ publishImage: async () => { calls++; throw Error('SECRET'); } });
  const server = createServer(api); await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'red' } }).png().toBuffer();
  for (const origin of [undefined, 'https://evil.test']) {
    const r = await fetch(base + '/api/pons/image-publish', { method: 'POST', headers: { 'content-type': 'image/png', ...(origin ? { origin } : {}) }, body: image }); assert.equal(r.status, 403);
  }
  const send = body => fetch(base + '/api/pons/image-publish', { method: 'POST', headers: { 'content-type': 'image/png', origin: base }, body });
  assert.equal((await send(Buffer.from('fake'))).status, 422); assert.equal(calls, 0);
  const result = await send(image); assert.equal(result.status, 503); assert.equal(calls, 1); assert.equal((await result.text()).includes('SECRET'), false);
});
test('Studio exposes image validation only on the owner panel host',async t=>{
 const server=createServer(studioHttp({studio:{},apiPool:{},dist:'dist',defaults:{}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const port=server.address().port,base=`http://127.0.0.1:${port}`;
 const image=await sharp({create:{width:16,height:16,channels:3,background:'red'}}).png().toBuffer();
 const good=await fetch(base+'/api/pons/image-check',{method:'POST',headers:{'content-type':'image/png',origin:base},body:image});assert.equal(good.status,200);
 const {request}=await import('node:http');
 const status=await new Promise((resolve,reject)=>{const req=request(base+'/api/pons/image-publish',{method:'POST',headers:{host:`token.localhost:${port}`}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end();});assert.equal(status,403);
});
