// Isolated PostgreSQL fixture. No RPC, custody or network broadcasts.
import {createPool} from '../../server/shared/store.mjs';
import {withQianqiExecutor} from '../../server/adapters/qianqi/executor.mjs';
import {Wallet,keccak256} from 'ethers';
process.once('message',async({url,binding,key,data})=>{
 const pool=createPool(url);
 try{
  await withQianqiExecutor(pool,binding,async check=>{
   await check();
   const raw=await new Wallet(key).signTransaction({chainId:4663,nonce:7,to:binding.token,data,gasLimit:21000,gasPrice:1});
   process.send({status:'signed',hash:keccak256(raw)});
   await new Promise(resolve=>process.once('message',resolve));
  });
 }catch(e){process.send({status:'refused',reason:e.message});}
 finally{await pool.end();process.disconnect();}
});
