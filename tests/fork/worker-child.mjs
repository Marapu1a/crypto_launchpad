import { readFile } from 'node:fs/promises';
import { Wallet } from 'ethers';
import { providerFor } from '../../src/pons/client.mjs';
import { runLocalWorker } from '../../src/worker/local-worker.mjs';
const [configPath,root,keyPath,url,bundles,phase]=process.argv.slice(2);
const provider=providerFor(url);
try{
  const config=JSON.parse(await readFile(configPath,'utf8')),signer=new Wallet((await readFile(keyPath,'utf8')).trim(),provider);
  const result=await runLocalWorker({provider,signer,config,root,bundleDirectory:bundles,hook:async boundary=>{if(boundary===phase)process.exit(73);}});
  console.log(JSON.stringify(result));
}finally{provider.destroy();}
