import {alertBridge} from './alerts.mjs';
import {readFile,mkdir,open,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {loadCatalog} from './catalog.mjs';
import {telegram} from './telegram.mjs';
import {pollOnce} from './poll.mjs';
import {privateText} from '../monitor-alerts/private-file.mjs';
import {writeHealthFile} from '../short-runtime/health-file.mjs';

const controller=new AbortController(),signal=controller.signal;
process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
let lock,lockFile;
try{
 const catalog=await loadCatalog();
 if(!catalog.botUsername)throw Error('Set botUsername in the project catalog first');
 const tokenFile=resolve(process.argv[2]??'.local/config/project-bot-token.txt'),stateFile=resolve(process.argv[3]??'.local/project-bot/state.json');
 if(tokenFile===stateFile)throw Error('Token and state paths must differ');
 await mkdir(dirname(stateFile),{recursive:true,mode:0o700});lockFile=process.env.PROJECT_BOT_LOCK_FILE?resolve(process.env.PROJECT_BOT_LOCK_FILE):stateFile+'.lock';
 try{lock=await open(lockFile,'wx',0o600);await lock.writeFile(String(process.pid));}catch{throw Error('Bot state is locked; check the existing process before restarting');}
 const alertHandler=process.env.PW_ALERTS_BRIDGE_FILE?alertBridge(JSON.parse(await privateText(process.env.PW_ALERTS_BRIDGE_FILE))):null;
 const api=telegram(await privateText(tokenFile),{signal}),me=await api('getMe');
 if(!me.is_bot||me.username?.toLowerCase()!==catalog.botUsername.toLowerCase())throw Error('Token does not match catalog botUsername');
 const webhook=await api('getWebhookInfo');if(webhook.url)throw Error('Bot already has a webhook; no changes made');
 let state;
 try{state=JSON.parse(await readFile(stateFile,'utf8'));}
 catch(e){if(e.code!=='ENOENT')throw Error('Cannot read bot offset');state={schema:'project-bot-state-v1',botId:me.id,offset:0};}
 if(state.schema!=='project-bot-state-v1'||state.botId!==me.id||!Number.isSafeInteger(state.offset)||state.offset<0)throw Error('Invalid bot state');
 const save=s=>writeHealthFile(stateFile,s);await save(state);
 console.log('Project bot ready: @'+me.username);
 while(!signal.aborted){
  try{await pollOnce({catalog,username:me.username,api,state,save,signal,alertHandler});}
  catch(e){
   if(signal.aborted)break;
   if(!Number.isInteger(e.code)||[400,401,404,409].includes(e.code))throw Error('Bot stopped; check configuration or conflicting poller');
   console.error('Telegram temporarily unavailable ('+e.code+'); retrying');
   try{await delay((e.retryAfter??5)*1000,undefined,{signal});}catch{}
  }
 }
}catch(e){console.error(e.code?'Project bot failed; check local configuration':e.message);process.exitCode=1;}
finally{if(lock){await lock.close();await unlink(lockFile);}}
