import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createPool} from '../shared/store.mjs';
import {validateRuntimeConfig,privateText} from './config.mjs';
import {readGasNotifications,deliverGasNotifications,telegramSender} from './gas-notifications.mjs';

let pool;
try{
 const config=validateRuntimeConfig(JSON.parse(await readFile(process.argv[2],'utf8'))),n=config.notifications;
 if(!n||!['tokenFile','chatFile','stateFile'].every(k=>typeof n[k]==='string'&&isAbsolute(n[k])))throw Error('Notification paths required');
 const interval=n.intervalMs??30000,reminder=n.reminderMs??21600000;
 if(!Number.isInteger(interval)||interval<5000||interval>300000||!Number.isInteger(reminder)||reminder<3600000)throw Error('Notification intervals');
 pool=createPool(await privateText(config.databaseFile));
 const send=telegramSender({token:await privateText(n.tokenFile),chat:await privateText(n.chatFile)});
 let stopped=false,wake;const stop=()=>{stopped=true;wake?.();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 while(!stopped){
  try{const {events,errors}=await readGasNotifications(pool,config.projects);const result=await deliverGasNotifications({file:n.stateFile,events,send,reminderMs:reminder});if(errors.length||result.failed||result.busy)console.error('Gas notifier requires attention');}
  catch{console.error('Gas notifier pass failed; financial worker is independent');}
  if(!stopped)await new Promise(r=>{const timer=setTimeout(r,interval);wake=()=>{clearTimeout(timer);r();};});
 }
}catch{console.error('Gas notifier configuration unavailable');process.exitCode=1;}
finally{await pool?.end();}
