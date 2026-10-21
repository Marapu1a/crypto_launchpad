import {language,localized} from '../monitor-alerts/language.mjs';
// Extend the existing single poller; the bridge persists language and link state.
export function alertBridge({url,secret},{fetcher=fetch}={}){
 const endpoint=new URL(url);if(endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&['127.0.0.1','localhost'].includes(endpoint.hostname)))throw Error('Invalid alerts bridge URL');
 if(typeof secret!=='string'||secret.length<32)throw Error('Invalid alerts bridge secret');
 return async(update,api)=>{
  const cb=update.callback_query,m=cb?.message??update.message,from=cb?.from??m?.from;
  if(m?.chat?.type!=='private'||from?.id!==m.chat.id||from?.is_bot)return false;
  const changingLanguage=/^lang:(en|ru|zh)$/.test(cb?.data??'')||/^\/language (en|ru|zh)$/.test(m.text??'');
  const special=!cb&&(/^\/start pw_[A-Za-z0-9_-]{32}$/.test(m.text??'')||m.text==='/stop');
  let lang=language(from.language_code),text;
  try{
   const r=await fetcher(url,{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(update),signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)throw Error();
   const result=await r.json();lang=language(result.language??lang);
   if(!special)return {handled:false,language:lang};
   text=result.status==='stopped'?localized(lang,'Watcher Telegram notifications are off.','Уведомления вотчера в Telegram отключены.','已关闭监测工具的 Telegram 通知。'):result.status==='linked'?localized(lang,'Connected. Return to the watcher and press “Check connection”.','Подключено. Вернись в вотчер и нажми «Проверить подключение».','已连接。请返回监测网站，点击“检查连接”。'):localized(lang,'This link has expired or was already used. Create a new link on the website.','Ссылка истекла или уже использована. Создай новую на сайте.','链接已过期或已使用，请在网站上创建新链接。');
  }catch{
   if(!special&&!changingLanguage)return false;
   if(cb)try{await api('answerCallbackQuery',{callback_query_id:cb.id})}catch{}
   text=localized(lang,'Watcher unavailable. Please try again later.','Вотчер временно недоступен. Повтори запрос позже.','监测服务暂不可用，请稍后重试。');
  }
  try{await api('sendMessage',{chat_id:m.chat.id,text,reply_markup:{inline_keyboard:[[{text:localized(lang,'Projects','Проекты','项目'),callback_data:'menu'}],[{text:'Language · Язык · 语言',callback_data:'language'}]]}})}catch(e){if(e.code!==403)throw e}
  return {handled:true,language:lang};
 };
}
