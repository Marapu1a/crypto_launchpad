import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {sharedApi,hostname} from './api.mjs';

// Optional public static shell. Only project.html and built assets, never owner UI.
export function projectSite(pool,{root=resolve('dist'),projectAdapters}={}){
 const api=sharedApi(pool,{projectAdapters});root=resolve(root);
 return async(req,res)=>{
  if(req.url?.startsWith('/api/')||req.url?.startsWith('/v1/'))return api(req,res);
  try{
   const host=hostname(req);if(!host){res.writeHead(400);res.end();return;}
   const {rows:[r]}=await pool.query('SELECT launchpad.resolve_host($1) AS id',[host]);if(!r?.id){res.writeHead(421);res.end();return;}
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
   const path=req.url.split('?')[0],name=['/','/project.html'].includes(path)?'project.html':path.startsWith('/assets/')?path.slice(1):null;
   if(!name||name.includes('..')||name.includes('\\')||name.includes('%'))throw Error();
   const file=resolve(root,name);if(!file.startsWith(root+sep))throw Error();
   const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'}[extname(file)];if(!type)throw Error();
   const bytes=await readFile(file);res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(404);res.end();}
 };
}
