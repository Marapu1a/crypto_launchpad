import {createPool} from '../server/shared/store.mjs';
import {liveReads} from '../src/qianqi/live-transport.mjs';
import {shadowConfig} from '../server/shared/shadow-storage.mjs';
import {runShadow} from '../server/shared/shadow-runner.mjs';
let pool,stop=false;
process.on('SIGINT',()=>{stop=true;});process.on('SIGTERM',()=>{stop=true;});
try{
 const config=shadowConfig();
 if(!process.env.SHARED_JOBS_URL||!process.env.PONS_ARCHIVE_RPC)throw Error('Missing runtime configuration');
 pool=createPool(process.env.SHARED_JOBS_URL);
 const result=await runShadow({pool,config,makeReads:liveReads,watch:process.argv.includes('--watch'),stopped:()=>stop});
 if(result.failed)process.exitCode=1;
}catch(e){
 console.error(e.code==='SHADOW_STOP'?e.message:'Shadow failed; check configuration and database availability');
 process.exitCode=e.code==='SHADOW_STOP'?78:1;
}finally{await pool?.end();}
