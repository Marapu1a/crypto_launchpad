import fs from 'node:fs/promises';
import path from 'node:path';
import {sharedApi} from '../shared/api.mjs';
import {validateLaunch} from './template.mjs';
import {createApiMiddleware} from '../api.mjs';
export function studioHttp({studio,apiPool,dist,defaults}){
 const publicApi=sharedApi(apiPool);
 const images=createApiMiddleware();
 return async(req,res)=>{
  const json=(code,value)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v));};
  try{
   const host=req.headers.host;
   if(typeof host!=='string'||! /^(?:127\.0\.0\.1|localhost|[a-z][a-z0-9-]*\.localhost):\d+$/.test(host))return json(403,{error:'Недопустимый Host'});
   if(req.url==='/api/project')return publicApi(req,res);
   if(['/api/pons/image-check','/api/pons/image-publish'].includes(req.url)){
    if(!/^(?:127\.0\.0\.1|localhost):/.test(host))return json(403,{error:'Загрузка доступна только из локальной панели'});
    return images(req,res);
   }
   if(req.url.startsWith('/api/studio/')){
    if(!/^(?:127\.0\.0\.1|localhost):/.test(host))return json(403,{error:'Управление доступно только с локальной панели'});
    if(req.headers.origin&&new URL(req.headers.origin).origin!=='http://'+host)return json(403,{error:'Недопустимый Origin'});
    if(req.method==='GET'&&req.url==='/api/studio/projects')return json(200,{projects:studio.list(),defaults});
    const match=/^\/api\/studio\/projects\/([0-9a-f-]+)(\/(?:pass|exercise))?$/.exec(req.url);
    if(req.method==='GET'&&match&&!match[2])return json(200,await studio.detail(match[1]));
    if(req.method!=='POST')return json(405,{error:'Метод не поддерживается'});
    if(req.headers['content-type']!=='application/json')return json(415,{error:'Нужен JSON'});
    let body='';for await(const bytes of req){body+=bytes;if(Buffer.byteLength(body)>32768)return json(413,{error:'Слишком большой запрос'});}
    const input=JSON.parse(body);
    if(req.url==='/api/studio/projects'){
     try{validateLaunch(input);}catch(e){return json(422,{error:e.fields?Object.values(e.fields).join('; '):'Проверьте параметры проекта, USDG/Short, доли и адреса'});}
     return json(200,await studio.launch(input));
    }
    if(match?.[2]==='/pass')return json(200,await studio.pass(match[1]));
    if(match?.[2]==='/exercise')return json(200,await studio.exercise(match[1]));
    return json(404,{error:'Нет маршрута'});
   }
   if(req.method!=='GET')return json(405,{error:'Метод не поддерживается'});
   const name=req.url==='/'?(/\.localhost:/.test(host)?'project.html':'launch.html'):decodeURIComponent(req.url.split('?')[0]).slice(1),target=path.resolve(dist,name);
   if(!target.startsWith(path.resolve(dist)+path.sep)||name.split('/').some(s=>s.startsWith('.')))return json(404,{error:'Нет файла'});
   const body=await fs.readFile(target),type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(target)]||'application/octet-stream';
   res.writeHead(200,{'content-type':type,'x-content-type-options':'nosniff'});res.end(body);
  }catch(e){json(409,{error:'Шаг не завершён. Сохранённый запуск можно продолжить; проверьте стенд и настройки.'});}
 };
}
