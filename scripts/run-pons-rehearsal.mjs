import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {runPonsRuntime} from '../server/shared/pons-runtime.mjs';
import {configuredPonsBootstrap} from '../server/shared/pons-bootstrap.mjs';
const [configFile,bootstrapFile,...extra]=process.argv.slice(2);
if(!configFile||extra.length)throw Error('Usage: node scripts/run-pons-rehearsal.mjs CONFIG_JSON [LOCAL_BOOTSTRAP_MJS]');
const config=JSON.parse(await readFile(resolve(configFile),'utf8')),stop=new AbortController();
if(config.mode!=='rehearsal')throw Error('Use the production entrypoint for public execution');
const halt=()=>stop.abort();process.once('SIGINT',halt);process.once('SIGTERM',halt);
try{
 await runPonsRuntime({...config,signal:stop.signal,prepare:bootstrapFile?async context=>{
  const bootstrap=await import(pathToFileURL(resolve(bootstrapFile)).href);
  return bootstrap.prepare(context);
 }:configuredPonsBootstrap(config)});
}finally{process.removeListener('SIGINT',halt);process.removeListener('SIGTERM',halt);}
