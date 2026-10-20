import webpush from 'web-push';
import {validateSubscription} from './service.mjs';
export function transports({vapid,telegramToken,origin,fetcher=fetch}){
 return {
  async sendPush(subscription,payload){if(!vapid)throw Error('Push not configured');validateSubscription(subscription);await webpush.sendNotification(subscription,JSON.stringify(payload),{vapidDetails:vapid,TTL:900,timeout:10000})},
  async sendTelegram(chat,payload){if(!telegramToken)throw Error('Telegram not configured');const r=await fetcher(`https://api.telegram.org/bot${telegramToken}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text:payload.title+'\n'+payload.body,reply_markup:{inline_keyboard:[[{text:'Посмотреть активность',url:new URL(payload.url,origin).href}]]},link_preview_options:{is_disabled:true}}),signal:AbortSignal.timeout(10000),redirect:'error'});const d=await r.json();if(!r.ok||!d.ok)throw Object.assign(Error('Telegram delivery failed'),{status:d.error_code??r.status,retryAfter:d.parameters?.retry_after})}
 };
}
