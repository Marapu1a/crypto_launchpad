// A fresh process: no access to the parent's objects, signer or in-memory journal.
import {readFileSync} from 'node:fs';
import {JsonRpcProvider} from 'ethers';
import {createPool} from '../../server/shared/store.mjs';
import {readHolderExecution,resolveHolderTransaction,resumeHolderReconciliation} from '../../server/shared/holder-execution.mjs';
const job=JSON.parse(readFileSync(process.argv[2],'utf8'));
for(const value of [job.rpc,process.env.PW_TEST_DB])if(new URL(value).hostname!=='127.0.0.1')throw Error('Loopback test endpoints only');
const provider=new JsonRpcProvider(job.rpc,undefined,{batchMaxCount:1,cacheTimeout:-1}),pool=createPool(process.env.PW_TEST_DB);
try{
 const meta=await provider.send('hardhat_metadata',[]);if(meta.instanceId!==job.instanceId)throw Error('Wrong local instance');
 const journal=await readHolderExecution(pool,job.scope),saved=journal.transactions.find(t=>t.body.txHash===job.txHash);
 if(!saved)throw Error('Missing durable transaction');
 const result=job.resolveReceipt?await resolveHolderTransaction(pool,job.scope,{provider,txHash:job.txHash}):{observation:{status:saved.status}};
 const reconciliation=job.reconcilePage?await resumeHolderReconciliation(pool,job.scope,{provider,maxItems:1}):undefined;
 console.log(JSON.stringify({reconciliation,txHash:job.txHash,status:result.observation.status,planCount:journal.plans.length}));
}finally{await pool.end();provider.destroy();}
