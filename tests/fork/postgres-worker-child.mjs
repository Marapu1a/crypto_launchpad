import { Wallet } from 'ethers';
import { providerFor } from '../../src/pons/client.mjs';
import { createPool } from '../../server/shared/store.mjs';
import { runPostgresWorker } from '../../server/shared/postgres-worker.mjs';
process.once('message',async input=>{
  const provider=providerFor(input.localUrl),executorPool=createPool(input.urls.executor),jobsPool=createPool(input.urls.jobs),ingestPool=createPool(input.urls.ingest);
  try{
    await runPostgresWorker({...input,provider,signer:new Wallet(input.testPrivateKey,provider),executorPool,jobsPool,ingestPool,hook:async(phase,intent)=>{
      if(phase==='prepared'){process.send({hash:intent.hash});await new Promise(()=>{});}
    }});process.send({error:'Expected prepare interruption was not reached'});
  }catch(error){process.send({error:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[database]')});}
  finally{await Promise.all([executorPool.end(),jobsPool.end(),ingestPool.end()]);provider.destroy();}
});
