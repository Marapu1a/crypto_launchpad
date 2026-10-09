import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyHistoryArchive} from '../src/qianqi/history-archive.mjs';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {inspectFinance} from '../src/qianqi/finance-shadow.mjs';
import {canonical,check} from '../src/qianqi/ticket-shadow.mjs';
import config from './rpc-config.cjs';
const {payload:history}=await verifyHistoryArchive({history:'.local/test-results/qianqi-history-2026-10-09T13-19-20-045Z',capture:'.local/test-results/qianqi-shadow-2026-10-09T12-12-21-030Z',routes:'.local/test-results/qianqi-routes-2026-10-09T12-33-18-288Z'});
const dir='.local/test-results/qianqi-finance-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(dir,{recursive:true});
const {url}=config.resolveRpc(),cache=new Map();let count=0,next=0;
if(process.argv[2])for(const f of readdirSync(process.argv[2]).filter(f=>/^\d+-rpc.json$/.test(f))){const r=JSON.parse(readFileSync(resolve(process.argv[2],f)));cache.set(canonical([r.method,r.params]),r.result);}
async function rpc(method,params){
 check(['eth_call','eth_getLogs','eth_getCode','eth_chainId','eth_getBlockByNumber','eth_getTransactionReceipt','eth_getTransactionByHash'].includes(method),'Read-only method rejected');
 const key=canonical([method,params]);let result=(method==='eth_chainId'||(method==='eth_getBlockByNumber'&&['finalized','0x503cf5b'].includes(params[0])))?undefined:cache.get(key);
 if(result===undefined){await new Promise(r=>setTimeout(r,Math.max(0,next-Date.now())));next=Date.now()+160;const response=await fetch(method==='eth_getLogs'?config.PUBLIC_RPC:url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20000)});check(response.ok,`RPC HTTP ${response.status}`);const body=await response.json();check(!body.error&&body.result!=null,'RPC read failed');result=body.result;cache.set(key,result);}
 writeFileSync(`${dir}/${String(++count).padStart(4,'0')}-rpc.json`,JSON.stringify({method,params,result}));return result;
}
let report;try{report=await inspectFinance({rpc,head:history.provenance.head,history});}catch(e){report={status:'INCOMPLETE',error:e.message};process.exitCode=1;}
report.observedAt=new Date().toISOString();report.baseCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();report.sourceHashes=Object.fromEntries(['src/qianqi/finance-shadow.mjs','scripts/qianqi-finance-shadow.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(f,'utf8').replaceAll('\r\n','\n')).digest('hex')]));
writeFileSync(dir+'/report.json',JSON.stringify(report,null,2));console.log(report.status,report.error??'',dir);
