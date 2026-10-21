import {randomUUID} from 'node:crypto';
import {Transaction} from 'ethers';
import {identity} from '../../src/holders/values.mjs';

const check=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{code:'PW_CONSOLE'});};
export function pwConsoleError(e){
 if(e.code==='PW_CONSOLE')return e.message;
 if(e.code==='RPC_BUDGET_EXHAUSTED')return 'Лимит RPC исчерпан. Сохранённый шаг остаётся в журнале.';
 const known={
  'Launch fee exceeds approved budget':'Текущая цена газа выше согласованного лимита. Попробуйте рассчитать шаг позже; предыдущие шаги сохранены.',
  'Launch fee data unavailable':'RPC не вернул корректную цену газа. Повторите расчёт шага.',
  'Launch gas exceeds approved budget':'Оценка расхода газа превысила лимит шага. Нужна проверка оператора.',
  'Owner nonce changed':'Номер транзакции кошелька изменился. Проверьте журнал и историю кошелька.',
  'PW production clock/finality outside policy':'Данные сети или финализированный блок отстают. Повторите расчёт позже.',
  'Wallet transaction not visible yet':'RPC пока не видит транзакцию. Сохраните её хеш и повторите проверку.',
 };
 return e.code==='OWNER_LAUNCH'&&known[e.message]||'Шаг не завершён. Обновите состояние; журнал сохранён.';
}
export function launchView(s){
 if(!s)return {stage:'not-prepared',history:[],steps:[],pending:null};
 return {stage:s.stage,token:s.scope?.token,launchAt:s.launchAt,finality:s.finality,
  steps:s.steps.map(x=>({kind:x.kind})),history:s.history.map(x=>({kind:x.kind,hash:x.hash,blockNumber:x.blockNumber})),
  pending:s.pending?{kind:s.pending.kind,hash:s.pending.hash}:null,
  walletPending:s.walletPending?{kind:s.walletPending.kind,request:s.walletPending.request}:null};
}

// No caller-controlled calldata or keys. Review tokens expire on restart and are
// bound to the exact quoted request. Signed bytes enter the existing durable
// coordinator before a separate broadcast action can become available.
export function createPwConsole({coordinator,input,owner,signer,browserWallet=false,enabled=false,usage=()=>null,now=Date.now}){
 let busy=false,review=null;
 const status=async()=>({...launchView(await coordinator.inspect(input.id)),rpcBudget:usage()});
 return {
  config:()=>({name:input.draft.name,symbol:input.draft.symbol,description:input.draft.description,telegram:input.draft.telegram,website:input.draft.website,owner,chainId:4663,
   browserWallet,signingEnabled:enabled&&(browserWallet||!!signer),sendEnabled:enabled,mode:coordinator.info().mode}),
  async run(action,body={}){
   check(!busy,'Операция уже выполняется. Обновите состояние.');busy=true;
   try{
    if(action==='status')return await status();
    if(action==='prepare'){review=null;return launchView(await coordinator.prepare(input));}
    if(action==='quote'){
     const quote=await coordinator.quote(input.id);
     review={id:randomUUID(),expiresAt:now()+120000,quote,raw:null};
     return {reviewId:review.id,expiresAt:review.expiresAt,...quote};
    }
    if(action==='sign'){
     check(enabled&&signer,'Подпись отключена в конфигурации.');
     const saved=await coordinator.inspect(input.id);
     if(saved?.pending)return launchView(saved);
     check(review&&review.id===body.reviewId&&now()<review.expiresAt,'Расчёт устарел. Получите новую оценку.');
     if(!review.raw){
      const fresh=await coordinator.quote(input.id);
      check(identity(fresh)===identity(review.quote),'Стоимость или шаг изменились. Получите новую оценку.');
      check((await signer.getAddress()).toLowerCase()===owner.toLowerCase(),'Кошелёк подписи не совпадает с владельцем.');
      const {from,...request}=fresh.request;
      check(from.toLowerCase()===owner.toLowerCase(),'Неверный отправитель шага.');
      const raw=await signer.signTransaction(request),tx=Transaction.from(raw);
      check(tx.isSigned()&&tx.from.toLowerCase()===owner.toLowerCase()&&tx.unsignedHash===Transaction.from(request).unsignedHash,'Подписанная транзакция отличается от показанного шага.');
      review.raw=raw;
     }
     const result=await coordinator.record(input.id,review.raw);review=null;return launchView(result);
    }
    if(action==='wallet-arm'){
     check(enabled&&browserWallet,'Подпись в браузере отключена.');
     const saved=await coordinator.inspect(input.id);
     if(saved?.walletPending)return launchView(saved);
     check(review&&review.id===body.reviewId&&now()<review.expiresAt,'Расчёт устарел. Получите новую оценку.');
     // armWallet checks chain/history, nonce, balance and eth_call again under
     // the journal lock. Keep the reviewed fee ceiling instead of chasing a
     // different quote on every block or spending RPC on a duplicate estimate.
     const result=await coordinator.armWallet(input.id,review.quote);review=null;return launchView(result);
    }
    if(action==='wallet-attach'){
     check(browserWallet,'Браузерный режим отключён.');
     return launchView(await coordinator.attachWallet(input.id,body.hash));
    }
    if(action==='broadcast'){
     check(enabled,'Отправка отключена в конфигурации.');
     const s=await coordinator.inspect(input.id);
     check(s?.pending&&s.pending.hash===body.hash,'Сначала обновите сохранённую транзакцию.');
     await coordinator.broadcast(input.id);return await status();
    }
    if(action==='resolve'){review=null;return launchView(await coordinator.resolve(input.id));}
    throw Object.assign(Error('Неизвестная операция.'),{code:'PW_CONSOLE'});
   }finally{busy=false;}
  }
 };
}

export function pwConsoleHttp(consoleApp,{origin}){
 const host=new URL(origin).host;
 return async(req,res,next)=>{
  const route=req.url?.split('?')[0];if(!route?.startsWith('/api/pw-owner/'))return next();
  const reply=(code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
  try{
   if(req.headers.host!==host||req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'Доступ только с локального экрана.'});
   if(req.method==='GET'&&route==='/api/pw-owner/config')return reply(200,consoleApp.config());
   if(req.method!=='POST'||req.headers.origin!==origin)return reply(403,{error:'Недопустимый запрос.'});
   if(req.headers['content-type']!=='application/json'||req.headers['content-encoding'])return reply(415,{error:'Требуется JSON.'});
   const action=route.slice('/api/pw-owner/'.length),keys={status:[],prepare:[],quote:[],sign:['reviewId'],'wallet-arm':['reviewId'],'wallet-attach':['hash'],broadcast:['hash'],resolve:[]}[action];
   if(!keys)return reply(404,{error:'Неизвестная операция.'});
   let text='',size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)return reply(413,{error:'Слишком большой запрос.'});text+=chunk;}
   let body;try{body=JSON.parse(text);}catch{return reply(400,{error:'Некорректный JSON.'});}
   if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!keys.includes(k)))return reply(400,{error:'Недопустимые поля.'});
   return reply(200,await consoleApp.run(action,body));
  }catch(e){
   // Provider/DB errors can contain credentials or raw signed bytes.
   return reply(409,{error:pwConsoleError(e)});
  }
 };
}
