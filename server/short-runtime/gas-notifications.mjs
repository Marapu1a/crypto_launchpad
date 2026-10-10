import {readFile,open,unlink,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {formatEther,isAddress} from 'ethers';
import {inProject,verifyRole} from '../shared/store.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {writeHealthFile} from './health-file.mjs';

export async function readGasNotifications(pool,entries){
 await verifyRole(pool,'lp_executor');const events=[],errors=[];
 for(const entry of entries.filter(p=>p.enabled)){
  try{await inProject(pool,entry.projectId,async c=>{
   const {rows:[row]}=await c.query(`SELECT s.policy_text,s.policy_hash,s.state_text,s.state_hash,p.display_name,p.token_address
    FROM launchpad.production_senders s JOIN launchpad.projects p ON p.id=s.project_id
    WHERE s.project_id=$1 AND s.module_id=$2`,[entry.projectId,entry.moduleId]);
   if(!row||row.policy_hash!==entry.policyHash)throw Error('Binding');
   const policy=JSON.parse(row.policy_text),state=JSON.parse(row.state_text);
   if(digest(policy)!==row.policy_hash||digest(state)!==row.state_hash||policy.projectId!==entry.projectId)throw Error('Checksum');
   for(const [role,journal] of [['executor',state],['publisher',state.runtime?.publisher]]){
    const event=journal?.gasFunding;if(!event)continue;
    if(event.role!==role||!isAddress(event.wallet)||event.wallet.toLowerCase()!==policy[role].toLowerCase()||typeof event.active!=='boolean'||typeof event.action!=='string')throw Error('Gas event');
    for(const k of ['balanceWei','requiredWei','shortfallWei'])if(!(event[k]===null&&k!=='balanceWei')&&!/^[0-9]+$/.test(event[k]))throw Error('Amount');
    events.push({projectId:entry.projectId,moduleId:entry.moduleId,projectName:row.display_name,token:row.token_address,role,wallet:event.wallet,active:event.active,action:event.action,balanceWei:event.balanceWei,requiredWei:event.requiredWei,shortfallWei:event.shortfallWei});
   }
  });}catch{errors.push(entry.projectId);}
 }
 return {events,errors};
}

export function gasMessage(event,recovery=false){
 const title=String(event.projectName).replace(/[\r\n]/g,' ').slice(0,80);
 const heading=recovery?'Отправки после нехватки газа возобновились.':'Не хватает ETH на газ. Исполнитель ждёт пополнения.';
 const amount=(value)=>value===null?'оценка недоступна':formatEther(value)+' ETH';
 return `${title}\n${heading}\nПроект: ${event.projectId}\nТокен: ${event.token}\nРоль: ${event.role}\nПополнять: ${event.wallet}\nШаг: ${event.action}\nБаланс: ${amount(event.balanceWei)}`+
  (recovery?'\nЭто не уведомление о завершении розыгрыша или выплате.':`\nТребуется: ${amount(event.requiredWei)}\nНе хватает: ${amount(event.shortfallWei)}\nПосле пополнения работа продолжится автоматически.`);
}

// Separate observer process: Telegram outages never block the financial worker.
export async function deliverGasNotifications({file,events,send,now=Date.now(),reminderMs=6*3600000}){
 await mkdir(dirname(file),{recursive:true,mode:0o700});let lock;
 try{lock=await open(file+'.lock','wx',0o600);}catch(e){if(e.code==='EEXIST')return {busy:true};throw e;}
 try{
  let state={schema:'gas-notifications-v1',entries:{}};
  try{state=JSON.parse(await readFile(file,'utf8'));if(state.schema!=='gas-notifications-v1'||!state.entries)throw Error('Notification state invalid');}catch(e){if(e.code!=='ENOENT')throw e;}
  let sent=0,failed=0;
  for(const event of events){
   const key=[event.projectId,event.moduleId,event.role,event.wallet.toLowerCase()].join(':'),old=state.entries[key];
   const recovery=!event.active&&old?.active;
   const notify=event.active?(!old?.active||old.action!==event.action||now-old.sentAt>=reminderMs):recovery;
   if(!notify)continue;
   try{await send(gasMessage(event,recovery));}catch{failed++;continue;}
   state.entries[key]={active:event.active,action:event.action,sentAt:now};
   // Commit after each successful delivery; failure never acknowledges a message.
   await writeHealthFile(file,state);sent++;
  }
  return {sent,failed};
 }finally{await lock.close();await unlink(file+'.lock');}
}

export function telegramSender({token,chat,fetcher=fetch}){
 if(!/^\d+:[A-Za-z0-9_-]+$/.test(token)||! /^-?\d+$/.test(chat))throw Error('Invalid Telegram credentials');
 return async text=>{
  try{const r=await fetcher(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text}),signal:AbortSignal.timeout(10000)});if(!r.ok||!(await r.json()).ok)throw Error();}
  catch{throw Error('Telegram delivery failed');}
 };
}
