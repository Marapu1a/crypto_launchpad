import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyOutcomeArchive} from '../src/qianqi/outcome-archive.mjs';
const archive={history:'.local/test-results/qianqi-history-2026-10-09T13-19-20-045Z',capture:'.local/test-results/qianqi-shadow-2026-10-09T12-12-21-030Z',routes:'.local/test-results/qianqi-routes-2026-10-09T12-33-18-288Z',finance:'.local/test-results/qianqi-finance-2026-10-09T15-21-08-436Z'};
const directory='.local/test-results/qianqi-outcome-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(directory,{recursive:true});
let report;try{report=await verifyOutcomeArchive(archive);}catch(e){report={status:'INCOMPLETE',error:e.message};process.exitCode=1;}
report.archive=archive;report.baseCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.sourceHashes=Object.fromEntries(['src/qianqi/outcome-replay.mjs','src/qianqi/outcome-archive.mjs','scripts/qianqi-outcome-replay.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(f,'utf8').replaceAll('\r\n','\n')).digest('hex')]));
writeFileSync(directory+'/report.json',JSON.stringify(report,null,2));console.log(report.status,report.error??'',directory);
