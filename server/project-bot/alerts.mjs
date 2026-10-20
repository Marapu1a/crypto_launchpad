// Extend the existing single poller. Never create a second getUpdates consumer.
export function alertBridge({url,secret},{fetcher=fetch}={}){
 const endpoint=new URL(url);if(endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&['127.0.0.1','localhost'].includes(endpoint.hostname)))throw Error('Invalid alerts bridge URL');
 if(typeof secret!=='string'||secret.length<32)throw Error('Invalid alerts bridge secret');
 return async(update,api)=>{
  const m=update.message;if(m?.chat?.type!=='private'||String(m.from?.id)!==String(m.chat.id)||!(/^\/start pw_[A-Za-z0-9_-]{32}$/.test(m.text??'')||m.text==='/stop'))return false;
  let text;try{const r=await fetcher(url,{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(update),signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)throw Error();text=m.text==='/stop'?'Уведомления вотчера в Telegram отключены.':'Запрос обработан. Вернись в вотчер и нажми «Проверить подключение». Если связь не появилась, создай новую ссылку.'}
  catch{text='Вотчер временно недоступен. Попробуй снова открыть ссылку подключения или повторить /stop позже.'}
  try{await api('sendMessage',{chat_id:m.chat.id,text})}catch(e){if(e.code!==403)throw e}return true;
 };
}
