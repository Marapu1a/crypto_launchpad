import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inspectBackup} from './backups.mjs';

export function transition(previous,alarms,now){
 const current=[...new Set(alarms)].sort();
 const failures=current.length?(previous.failures||0)+1:0;
 const announced=previous.announced||[];
 // Two independent checks avoid a single brief internet/API interruption.
 const alert=failures>=2&&(current.some(x=>!announced.includes(x))||now-(previous.sentAt||0)>=6*3600000);
 const recovery=!current.length&&announced.length>0;
 return {state:{...previous,failures,current,checkedAt:now},notify:alert||recovery,recovery};
}
export async function probe(url,fetcher=fetch){
 try{
  const response=await fetcher(url,{signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!response.ok)return false;
  const body=await response.json();
  return ['observed','stale'].includes(body.status);
 }catch{return false;}
}
export function describeAlarms(alarms){
 const labels={pull_failed:'ошибка скачивания копий',pull_stale:'синхронизация копий давно не подтверждалась',pull_missing:'нет отчёта скачивания',archive_missing:'нет готового архива',archive_future:'дата архива в будущем',archive_stale:'архив старше допустимого срока',archive_integrity:'архив или его контрольная сумма повреждены'};
 return alarms.map(code=>{
  if(code==='public_api_unreachable')return 'API QIANQI недоступен с компьютера — проверьте также свой интернет';
  const [id,reason]=code.split(':');return `${id==='qianqi'?'QIANQI':'Платформа'}: ${labels[reason]||'ошибка проверки копии'}`;
 }).join('; ');
}
function save(file,value){fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);}
async function main(){
 const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,''));
 if(config.schema!=='launchpad-local-watchdog-v1'||!Array.isArray(config.backups)||config.backups.length!==2||new URL(config.apiUrl).protocol!=='https:')throw Error('Invalid watchdog configuration');
 fs.mkdirSync(config.stateDirectory,{recursive:true});
 const stateFile=path.join(config.stateDirectory,'state.json');
 let previous={};try{previous=JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Unreadable watchdog state');}
 const now=Date.now(),backups=await Promise.all(config.backups.map(c=>inspectBackup(c,now)));
 const reachable=await probe(config.apiUrl);
 const alarms=backups.flatMap(b=>b.alarms.map(a=>b.id+':'+a));
 if(!reachable)alarms.push('public_api_unreachable');
 const next=transition(previous,alarms,now);
 save(path.join(config.stateDirectory,'status.json'),{schema:'launchpad-local-watchdog-status-v1',at:new Date(now).toISOString(),reachable,backups,alarms});
 if(next.notify){
  const message=next.recovery?'Launchpad: внешняя проверка и копии снова в норме.':describeAlarms(alarms)+'. Подробности: '+path.join(config.stateDirectory,'status.json');
  // No VPS credentials or Telegram tokens are copied onto this machine.
  try{
   await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./notify-windows.ps1',import.meta.url)),'-Message',message],{windowsHide:true,timeout:20000});
   next.state.announced=next.recovery?[]:[...new Set([...(previous.announced||[]),...alarms])];next.state.sentAt=now;
  }catch{save(stateFile,next.state);throw Error('Notification unavailable; incident retained for retry');}
 }
 save(stateFile,next.state);
 console.log(JSON.stringify({status:alarms.length?'attention':'healthy',notified:next.notify,alarms}));
 if(alarms.length)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Watchdog failed: inspect local configuration/state and notification access');process.exitCode=2;});
