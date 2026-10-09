// Reused QIANQI notifier from rh_project@11a050d. Only the CLI is removed below.
// Read-only observer. Telegram failures never alter financial state or trigger sends.
const fs=require('node:fs'),path=require('node:path');
const actionable=new Set(['nativeFunding','gasPrice','unknownHash','pendingNonce','pendingReceipt','operationFailed','SCHEDULER_STORAGE_ERROR','historyUnavailable','indexerUnavailable','indexerStale','fundingUnavailable','beaconUnavailable']);
function summarize(operator,indexer){
 const reasons=(operator.reasons||[]).map(r=>r.code).filter(c=>actionable.has(c)).sort();
 const alarms=[];
 if(['attention','unavailable','stopped'].includes(operator.state))alarms.push('operator unavailable/attention');
 alarms.push(...reasons);
 if(!indexer?.ready)alarms.push('indexer not ready');
 return [...new Set(alarms)].sort().join(', ')||'ok';
}
async function deliver({file,summary,send,now=Date.now()}){
 let previous={};try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Notification state unreadable');}
 const split=s=>!s||s==='ok'?[]:s.split(', '),raw=split(summary);
 // Index targets advance in batches. Alert only after two minutes continuously
 // unready; executor/storage/funding alarms remain immediate.
 const indexerSince=raw.includes('indexer not ready')?(previous.indexerSince??now):null;
 const current=raw.filter(a=>a!=='indexer not ready'||now-indexerSince>=120000);
 const announced=previous.announced??split(previous.summary);
 const fresh=current.some(a=>!announced.includes(a));
 const recovery=raw.length===0&&announced.length>0;
 const reminder=current.length>0&&now-(previous.sentAt??0)>=6*3600000;
 const persist=value=>{fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);};
 if(!fresh&&!recovery&&!reminder){persist({...previous,indexerSince});return !previous.summary&&raw.length===0?'healthy':'suppressed';}
 const stable=current.sort().join(', ')||'ok';
 await send(`QIANQI: ${recovery?'наблюдаемые службы восстановились':stable}`);
 persist({summary:stable,sentAt:now,indexerSince,announced:recovery?[]:[...new Set([...announced,...current])]});
 return 'delivered';
}
module.exports={summarize,deliver};
