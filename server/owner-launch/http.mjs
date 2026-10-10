import {UUID} from '../studio/template.mjs';
import {createApiMiddleware} from '../api.mjs';

// Mounted only by a prepared private rehearsal environment. No public RPC URL,
// keystore, account, timing or calldata is accepted from an HTTP client.
export function ownerLaunchHttp({coordinator,defaults,handoff,localSign}){
 const images=createApiMiddleware();
 return async(req,res,next=()=>{res.writeHead(404);res.end();})=>{
  const pathname=req.url?.split('?')[0];
  if(['/api/pons/image-check','/api/pons/image-publish'].includes(pathname))return images(req,res);
  if(!pathname?.startsWith('/api/owner-launch/'))return next();
  const reply=(code,value)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
  try{
   const host=req.headers.host;
   if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host??''))return reply(403,{error:'Недопустимый Host'});
   if(req.method==='GET'&&pathname==='/api/owner-launch/config')return reply(200,{...coordinator.info(),defaults,localFixtureWallet:Boolean(localSign)});
   if(req.method!=='POST')return reply(405,{error:'Требуется POST'});
   if(req.headers.origin!=='http://'+host)return reply(403,{error:'Недопустимый Origin'});
   if(req.headers['content-type']!=='application/json'||req.headers['content-encoding'])return reply(415,{error:'Требуется JSON'});
   const match=/^\/api\/owner-launch\/([^/]+)\/(create|next|arm|attach|retry|handoff|rehearsal-sign)$/.exec(pathname);
   if(!match||!UUID.test(match[1]))return reply(404,{error:'Нет такого шага'});
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>65536)return reply(413,{error:'Слишком большой запрос'});chunks.push(chunk);}
   let body;try{body=JSON.parse(Buffer.concat(chunks));}catch{return reply(400,{error:'Некорректный JSON'});}
   const keys={create:['input'],next:[],arm:['requestId','revision'],attach:['requestId','hash'],retry:['requestId'],handoff:[],'rehearsal-sign':['requestId']}[match[2]];
   if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!keys.includes(k)))return reply(400,{error:'Некорректные параметры шага'});
   if(match[2]==='handoff')return handoff?reply(200,await handoff(match[1])):reply(409,{error:'Подготовка обслуживания ещё не настроена на этом стенде'});
   if(match[2]==='rehearsal-sign')return localSign?reply(200,await localSign(match[1],body.requestId)):reply(409,{error:'Локальный тестовый кошелёк не включён'});
   reply(200,await coordinator.run(match[1],match[2],body));
  }catch(error){
   if(error.code==='OWNER_LAUNCH')reply(409,{error:error.message});
   else if(error.code==='23505')reply(409,{error:'Запуск, поддомен или кошелёк исполнителя уже закреплён за другим проектом'});
   else if(error.fields)reply(422,{error:'Проверьте поля',fields:error.fields});
   else reply(503,{error:'Проверка шага не завершена. Сохранённый журнал остаётся на сервере; обновите состояние.'});
  }
 };
}
