import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createPool } from '../server/shared/store.mjs';
import { withQianqiExecutor } from '../server/adapters/qianqi/executor.mjs';
import { inspectAdoption } from '../server/adapters/qianqi/adoption.mjs';
const require=createRequire(import.meta.url);
let pool;
try{
 const binding=JSON.parse(fs.readFileSync(process.env.SHARED_QIANQI_EXECUTOR_BINDING,'utf8'));
 const credentials=require('../server/adapters/qianqi/runtime/scripts/service-credentials.cjs');
 const rpcUrl=process.env.CREDENTIALS_DIRECTORY?credentials.rpc():process.env.RH_RPC_URL;
 const report=inspectAdoption(binding,rpcUrl);
 if(process.argv.includes('--inspect'))console.log(JSON.stringify(report));
 else{
  if(process.argv.slice(2).some(x=>!['--watch','--drain'].includes(x)))throw Error('Invalid executor arguments');
  pool=createPool(process.env.SHARED_EXECUTOR_DATABASE_URL);
  process.argv=[...process.argv.slice(0,2),'--config',binding.configFile,'--profile',binding.profileFile,'--state',binding.statePath,'--keystore',binding.keystoreFile,...process.argv.slice(2)];
  await withQianqiExecutor(pool,binding,()=>require('../server/adapters/qianqi/runtime/scripts/run-pons-public.cjs').main());
 }
}catch{console.error('QIANQI adapter refused execution; inspect pinned configuration, saved state and ownership');process.exitCode=1;}
finally{await pool?.end();}
