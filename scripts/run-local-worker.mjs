import { readFile } from 'node:fs/promises';
import { Wallet } from 'ethers';
import { providerFor } from '../src/pons/client.mjs';
import { assertLocalFork } from '../src/pons/local-execution.mjs';
import { runLocalWorker, recoverLocalWorkerLocks } from '../src/worker/local-worker.mjs';

const [configPath,root,keyPath,url,mode,bundleDirectory]=process.argv.slice(2);
if(!configPath||!root||!keyPath||!url||!['--once','--watch','--recover-locks'].includes(mode))throw Error('Usage: config.json stateRoot LOCAL_TEST_KEY_FILE LOOPBACK_RPC --once|--watch|--recover-locks [bundles]');
const endpoint=new URL(url);
if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password)throw Error('Loopback HTTP only');
const provider=providerFor(url);let stopped=false;
process.once('SIGINT',()=>{stopped=true;});process.once('SIGTERM',()=>{stopped=true;});
try{
  await assertLocalFork(provider); // Reject public execution before reading any key.
  const config=JSON.parse(await readFile(configPath,'utf8'));
  if(mode==='--recover-locks'){
    console.log(JSON.stringify(await recoverLocalWorkerLocks(provider,config,root)));
  }else{
  const signer=new Wallet((await readFile(keyPath,'utf8')).trim(),provider);
  do{
    let result;
    try{result=await runLocalWorker({provider,signer,config,root,bundleDirectory});}
    catch(error){if(!['NETWORK_ERROR','TIMEOUT','SERVER_ERROR'].includes(error.code))throw error;result={status:'waiting',reason:'rpc-unavailable'};}
    console.log(JSON.stringify(result));
    if(result.status==='blocked'){process.exitCode=1;break;}
    if(mode==='--once'||stopped)break;
    await new Promise(r=>setTimeout(r,result.status==='confirmed'?100:5000));
  }while(!stopped);
  }
}catch(error){console.error(String(error.shortMessage||error.message).replace(/https?:\/\/\S+/g,'[endpoint]'));process.exitCode=1;}
finally{provider.destroy();}
