const methods=new Set(['getMe','getWebhookInfo','getUpdates','sendMessage','answerCallbackQuery']);
export class TelegramError extends Error{
 constructor(code=0,retryAfter=5){super('Telegram request failed ('+code+')');this.code=code;this.retryAfter=Number.isFinite(retryAfter)?Math.max(1,Math.min(3600,retryAfter)):5;}
}
export function telegram(token,{fetcher=fetch,signal}={}){
 if(!/^\d+:[a-zA-Z0-9_-]{20,}$/.test(token))throw Error('Invalid bot token file');
 return async(method,body={})=>{
  if(!methods.has(method))throw Error('Unsupported bot method');
  try{
   const response=await fetcher('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([AbortSignal.timeout(35000),...(signal?[signal]:[])])});
   let data;try{data=await response.json();}catch{throw new TelegramError(response.status);}
   if(!response.ok||!data.ok)throw new TelegramError(data.error_code??response.status,data.parameters?.retry_after);
   return data.result;
  }catch(e){if(e instanceof TelegramError)throw e;throw new TelegramError();}
 };
}
