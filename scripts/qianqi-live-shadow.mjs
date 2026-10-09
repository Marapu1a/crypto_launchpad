import {mkdirSync,writeFileSync} from 'node:fs';
import {verifyHistoryArchive} from '../src/qianqi/history-archive.mjs';
import {advanceShadow} from '../src/qianqi/live-shadow.mjs';
import {liveReads} from '../src/qianqi/live-transport.mjs';
const dir='.local/test-results/qianqi-live-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(dir,{recursive:true});
const archive={history:'.local/test-results/qianqi-history-2026-10-09T13-19-20-045Z',capture:'.local/test-results/qianqi-shadow-2026-10-09T12-12-21-030Z',routes:'.local/test-results/qianqi-routes-2026-10-09T12-33-18-288Z'};
const {payload:previous}=await verifyHistoryArchive(archive);writeFileSync(dir+'/previous.json',JSON.stringify(previous));
let index=0;const {rpc,getJson}=liveReads((kind,row)=>writeFileSync(`${dir}/${String(++index).padStart(4,'0')}-${kind}.json`,JSON.stringify(row)));
let report;try{report={status:'LIVE_SHADOW_MATCH',...await advanceShadow({previous,rpc,getJson})};}catch(e){report={status:'INCOMPLETE',error:e.message,code:e.code};process.exitCode=1;}
writeFileSync(dir+'/report.json',JSON.stringify(report,null,2));console.log(report.status,report.error??'',dir);
