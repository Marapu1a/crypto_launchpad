import {readFileSync} from 'node:fs';
import {JsonRpcProvider} from 'ethers';
import {createPool} from '../../server/shared/store.mjs';
import {recoverHolderFunding} from '../../server/shared/holder-funding-recovery.mjs';
const job=JSON.parse(readFileSync(process.argv[2],'utf8')),url=new URL(job.rpc);
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw Error('Test loopback only');
const provider=new JsonRpcProvider(job.rpc,undefined,{cacheTimeout:-1,batchMaxCount:1});
const pool=createPool(process.env.PW_TEST_JOBS_DB);
try{console.log(JSON.stringify(await recoverHolderFunding(pool,job.scope,{provider})));}
finally{await pool.end();provider.destroy();}
