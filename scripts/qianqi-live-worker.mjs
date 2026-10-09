import {mkdirSync,writeFileSync} from 'node:fs';
import {createPool} from '../server/shared/store.mjs';
import {observeQianqiLive} from '../server/shared/qianqi-live.mjs';
import {liveReads} from '../src/qianqi/live-transport.mjs';
if(!process.env.SHARED_JOBS_URL||!process.env.SHARED_PROJECT_ID||!process.env.SHARED_MODULE_ID)throw Error('SHARED_JOBS_URL, SHARED_PROJECT_ID and SHARED_MODULE_ID required');
const pool=createPool(process.env.SHARED_JOBS_URL),watch=process.argv.includes('--watch');let stop=false;
process.on('SIGINT',()=>{stop=true;});process.on('SIGTERM',()=>{stop=true;});
try{do{
 const dir='.local/test-results/qianqi-live-cycle-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(dir,{recursive:true});let i=0;
 const reads=liveReads((kind,row)=>writeFileSync(`${dir}/${String(++i).padStart(4,'0')}-${kind}.json`,JSON.stringify(row)));
 let report;try{const result=await observeQianqiLive(pool,process.env.SHARED_PROJECT_ID,process.env.SHARED_MODULE_ID,reads);report={status:result.changed?'LIVE_SHADOW_MATCH':'UNCHANGED',head:result.payload.provenance.head,digest:result.digest,inserted:result.inserted,delta:result.delta,comparedWallets:result.comparedWallets,executionEligible:false};}
 catch(e){report={status:'NOT_ADVANCED',error:/^[A-Za-z0-9 ;:.,/_-]{1,160}$/.test(e.message)?e.message:'Observation failed',executionEligible:false};if(!watch)process.exitCode=1;if(e.code==='QIANQI_REORG'||e.message==='QIANQI live shadow halted')stop=true;}
 writeFileSync(dir+'/report.json',JSON.stringify(report,null,2));console.log(report.status,dir+'/report.json');
 if(watch&&!stop)for(let s=0;s<60&&!stop;s++)await new Promise(r=>setTimeout(r,1000));
}while(watch&&!stop);}finally{await pool.end();}
