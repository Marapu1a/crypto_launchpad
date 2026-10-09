import {createPool} from '../../server/shared/store.mjs';
import {runShadow} from '../../server/shared/shadow-runner.mjs';
import {fileURLToPath} from 'node:url';
// Load fixture relative to repository only in this test; runner itself needs no cwd.
process.chdir(fileURLToPath(new URL('../../',import.meta.url)));
const {capturedReads}=await import('./live-fixture.mjs');
const {url,config,hold}=JSON.parse(process.env.QIANQI_RUNNER_TEST),pool=createPool(url);
process.chdir(fileURLToPath(new URL('.',import.meta.url)));
try{
 await runShadow({pool,config,makeReads:save=>{const r=capturedReads();return {rpc:async(method,params)=>{if(hold){console.log('LOCK_HELD');await new Promise(()=>{});}const result=await r.rpc(method,params);save('rpc',{method,params,result});return result;},getJson:async path=>{const data=await r.getJson(path);save('api',{path,data});return data;}};}});
}finally{await pool.end();}
