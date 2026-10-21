import {language} from '../monitor-alerts/language.mjs';
import {actions} from './replies.mjs';

export async function dispatch({catalog,update,username,api,alertHandler,state={}}){
 const cb=update.callback_query,m=cb?.message??update.message,from=cb?.from??m?.from;
 const privateUser=m?.chat?.type==='private'&&Number.isSafeInteger(m.chat.id)&&m.chat.id>0&&from?.id===m.chat.id&&!from?.is_bot;
 const bridge=alertHandler?await alertHandler(update,api):null;
 let lang=language(from?.language_code);
 if(privateUser){
  const key=String(m.chat.id),choice=/^lang:(en|ru|zh)$/.exec(cb?.data??'')?.[1]??/^\/language (en|ru|zh)$/.exec(m.text??'')?.[1];
  lang=bridge?.language??choice??state.languages?.[key]??lang;
  state.languages??={};state.languages[key]=lang;
 }
 if(bridge===true||bridge?.handled)return;
 for(const action of actions(catalog,update,username,lang)){
  try{await api(action.method,action.body);}
  catch(e){
   // Expired callback acknowledgements must not discard the requested card.
   if(action.method==='answerCallbackQuery'&&e.code===400)continue;
   if(e.code===403)return; // User blocked the bot; nothing further to deliver.
   throw e;
  }
 }
}
// The offset is persisted after processing. A crash after send but before save
// can repeat a navigation card; never claim exactly-once Telegram delivery.
export async function pollOnce({catalog,username,api,state,save,signal,alertHandler}){
 const updates=await api('getUpdates',{offset:state.offset,timeout:25,limit:50,allowed_updates:['message','callback_query']});
 if(!Array.isArray(updates)||updates.some(u=>!Number.isSafeInteger(u.update_id)||u.update_id<0))throw Error('Invalid Telegram updates');
 for(const update of updates){
  if(signal?.aborted)break;
  if(update.update_id<state.offset)continue;
  await dispatch({catalog,update,username,api,alertHandler,state});
  const next={...state,offset:update.update_id+1};await save(next);Object.assign(state,next);
 }
}
