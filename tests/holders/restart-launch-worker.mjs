// Fresh process: reads the durable launch journal and resolves one receipt, without keys.
import {readFileSync} from 'node:fs';
import {JsonRpcProvider} from 'ethers';
import {createPool} from '../../server/shared/store.mjs';
import {createPwOwnerCoordinator} from '../../server/owner-launch/pw-coordinator.mjs';
const job=JSON.parse(readFileSync(process.argv[2],'utf8'));
for(const endpoint of [job.rpc,process.env.PW_TEST_DB])if(new URL(endpoint).hostname!=='127.0.0.1')throw Error('Loopback test only');
const provider=new JsonRpcProvider(job.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1}),pool=createPool(process.env.PW_TEST_DB);
try{
 const coordinator=createPwOwnerCoordinator({pool,provider,profile:job.profile,preparation:job.preparation});
 const before=await coordinator.read(job.id);if(!before.pending)throw Error('Missing pending launch');
 const after=await coordinator.resolve(job.id);
 console.log(JSON.stringify({before:before.history.length,after:after.history.length,hash:before.pending.hash,stage:after.stage}));
}finally{await pool.end();provider.destroy();}
