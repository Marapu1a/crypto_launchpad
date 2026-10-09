// Extend the existing QIANQI observer; same credentials, state and dedup channel.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const RUNTIME='/opt/crypto-launchpad/qianqi-current/server/adapters/qianqi/runtime/scripts';
const STATUS='/var/lib/qianqi-backup-status/status.json';
const units=['qianqi-public-automation.service','qianqi-public-indexer.service','crypto-launchpad-api.service'];
function evaluate({backup,backupRunning,services,api,now=Date.now()/1000}){
 const alarms=[];
 const inProgress=backup&& !['success','failed'].includes(backup.phase);
 const planned=!!(inProgress&&backup.stopRequested&&backupRunning&&now-backup.startedAt>=0&&now-backup.startedAt<900);
 if(!backup)alarms.push('backup status unavailable');
 else {
  if(backup.phase==='failed')alarms.push(backup.stopRequested?'backup failed; writers require manual reconciliation':'backup preflight failed');
  if(inProgress&&(!backupRunning||now-backup.startedAt>=900||now<backup.startedAt))alarms.push('backup interrupted or overdue; inspect durable status');
  if(!backup.lastSuccess||!Number.isFinite(backup.lastSuccess.at)||now-backup.lastSuccess.at>30*3600||now<backup.lastSuccess.at)alarms.push('native verified backup older than 30h or missing');
 }
 for(const unit of units)if(services[unit]!=='active'&&!(planned&&unit!=='crypto-launchpad-api.service'))alarms.push(unit+' inactive');
 if(!planned&&api?.status!=='observed')alarms.push('public API stale or unavailable');
 return {planned,alarms};
}
function service(unit){try{return execFileSync('systemctl',['show',unit,'-p','ActiveState','--value'],{encoding:'utf8',timeout:3000}).trim();}catch{return 'unknown';}}
async function main(){
 const old=require('./notify.cjs');
 const credentials=process.env.CREDENTIALS_DIRECTORY;
 const token=fs.readFileSync(path.join(credentials,'telegram-token'),'utf8').trim();
 const chat=fs.readFileSync(path.join(credentials,'telegram-chat'),'utf8').trim();
 if(!/^\d+:[A-Za-z0-9_-]+$/.test(token)||!/^\d+$/.test(chat))throw Error('credentials');
 const send=async text=>{
  const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text}),signal:AbortSignal.timeout(10000)});
  if(!response.ok||!(await response.json()).ok)throw Error('delivery');
 };
 if(process.argv.includes('--test-delivery')){
  await send('QIANQI: тест оповещения backup/monitor. Финансовые операции не выполнялись.');
  console.log('TEST_DELIVERY_CONFIRMED');return;
 }
 let backup=null,indexer=null,api=null;
 try{backup=JSON.parse(fs.readFileSync(STATUS));if(backup.schema!=='qianqi-backup-status-v1')backup=null;}catch{}
 await Promise.all([
  (async()=>{try{indexer=await (await fetch('http://127.0.0.1:8789/healthz',{signal:AbortSignal.timeout(5000)})).json();}catch{}})(),
  (async()=>{try{const r=await fetch('https://qianqi.site/v1/overview?limit=1',{signal:AbortSignal.timeout(5000)});if(r.ok)api=await r.json();}catch{}})()
 ]);
 const services=Object.fromEntries(units.map(unit=>[unit,service(unit)]));
 const backupRunning=['active','activating'].includes(service('qianqi-public-backup.service'));
 const {planned,alarms}=evaluate({backup,backupRunning,services,api});
 const operator=require(path.join(RUNTIME,'ops-session.cjs')).readStatus('/var/lib/qianqi-public/automation.json.status.json',15*60000);
 const legacy=planned?'ok':old.summarize(operator,indexer);
 const summary=[...new Set([...alarms,...(legacy==='ok'?[]:legacy.split(', '))])].sort().join(', ')||'ok';
 // During a planned stop do not falsely announce recovery from an earlier incident.
 if(planned&&summary==='ok'){console.log('PLANNED_BACKUP_STOP');return;}
 const result=await old.deliver({file:'/var/lib/qianqi-monitor/telegram.json',summary,send});
 console.log('Notification check: '+result+'; '+(alarms.length?'operational incident':'operational checks healthy'));
 if(alarms.length)process.exitCode=1;
}
if(require.main===module)main().catch(()=>{console.error('Notification unavailable; inspect monitor credentials/network/state');process.exitCode=1;});
module.exports={evaluate};
