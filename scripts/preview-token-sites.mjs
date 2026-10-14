import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
// Loopback preview; optional read-only proxy to explicitly allowlisted public endpoints.
for(const [id,port] of [['qianqi',4200],['igw',4201],['hub',4202]]){
 const root=resolve('.local/token-sites',id);
 createServer(async(req,res)=>{
  try{
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
   const url=new URL(req.url,'http://localhost');
   const allowed=id==='igw'?['/api/project','/api/draws']:['/v1/overview'];
   if(process.env.SITE_PREVIEW_LIVE==='1'&&allowed.includes(url.pathname)){
    try{const upstream=await fetch('https://'+(id==='igw'?'igw':'init')+'.qianqi.site'+url.pathname+url.search,{signal:AbortSignal.timeout(10000)});res.writeHead(upstream.status,{'content-type':'application/json','cache-control':'no-store'});return res.end(await upstream.text());}catch{res.writeHead(503);return res.end('{}');}
   }
   if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/v1/')){
    const pending=id==='igw'&&url.pathname==='/api/project';
    res.writeHead(pending?421:503,{'content-type':'application/json'});return res.end(JSON.stringify({error:pending?'unknown_project_host':'local_preview_no_api'}));
   }
   let name=decodeURIComponent(url.pathname);if(name.endsWith('/'))name+='index.html';
   const file=resolve(root,'.'+name);if(!file.startsWith(root+sep))throw Error();
   const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json'};
   if(!types[extname(file)])throw Error();
   const bytes=await readFile(file);res.writeHead(200,{'content-type':types[extname(file)],'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404);res.end();}
 }).listen(port,'127.0.0.1',()=>console.log(id+': http://127.0.0.1:'+port+'/'));
}
