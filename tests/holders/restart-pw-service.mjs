import {readFileSync} from 'node:fs';
import {JsonRpcProvider} from 'ethers';
import {createPool} from '../../server/shared/store.mjs';
import {readPwService,runPwWorker} from '../../server/shared/pw-service.mjs';
const job=JSON.parse(readFileSync(process.argv[2],'utf8'));
const provider=new JsonRpcProvider(job.rpc,undefined,{cacheTimeout:-1,batchMaxCount:1});provider.pollingInterval=10;
const pool=createPool(process.env.PW_TEST_DB),jobsPool=createPool(process.env.PW_TEST_JOBS_DB);
try{
 const {policy,state}=await readPwService(pool,job.projectId);
 if(!state.pending||policy.mode!=='rehearsal')throw Error('Pending local operation required');
 const hash=state.pending.hash;
 const result=await runPwWorker({pool,jobsPool,provider,projectId:job.projectId,moduleId:job.projectId,signer:{getAddress:async()=>policy.executor,signTransaction:async()=>{throw Error('No signing key in restarted process');}},publisher:{getAddress:async()=>policy.publisher},now:()=>job.clock,ponsRehearsal:{load:async()=>job.report},getLatestBeacon:async()=>job.beacon});
 const after=await readPwService(pool,job.projectId);
 console.log(JSON.stringify({status:result.status,hash,confirmed:after.state.history.at(-1)?.hash,pending:!!after.state.pending}));
}finally{await pool.end();await jobsPool.end();provider.destroy();}
