import { Wallet } from 'ethers';
import { providerFor } from '../../src/pons/client.mjs';
import { createPool } from '../../server/shared/store.mjs';
import { advanceFinancialOperation } from '../../server/shared/financial-journal.mjs';
// Ephemeral local test signer is received over IPC, never argv/files/logs.
process.once('message',async input=>{
  const provider=providerFor(input.rpc),pool=createPool(input.database);
  try{
    await advanceFinancialOperation({...input,pool,provider,signer:new Wallet(input.testPrivateKey,provider),hook:async(phase,intent)=>{
      if(phase===input.stopAt){process.send({phase,hash:intent.hash});await new Promise(()=>{});}
    }});
    process.send({error:'Expected interruption was not reached'});
  }catch{process.send({error:'Child journal failed'});}
  finally{await pool.end();provider.destroy();}
});
