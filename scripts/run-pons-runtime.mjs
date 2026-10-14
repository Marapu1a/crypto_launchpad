import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runPonsRuntime} from '../server/shared/pons-runtime.mjs';
import {configuredPonsBootstrap} from '../server/shared/pons-bootstrap.mjs';
const [file,...extra]=process.argv.slice(2);
if(!file||extra.length)throw Error('Usage: node scripts/run-pons-runtime.mjs CONFIG_JSON');
const config=JSON.parse(await readFile(resolve(file),'utf8')),stop=new AbortController();
const halt=()=>stop.abort();process.once('SIGINT',halt);process.once('SIGTERM',halt);
try{await runPonsRuntime({...config,signal:stop.signal,prepare:configuredPonsBootstrap(config)});}
catch{console.error('Pons runtime stopped; inspect configuration, ownership, budget and saved health. No journal was reset.');process.exitCode=1;}
finally{process.removeListener('SIGINT',halt);process.removeListener('SIGTERM',halt);}
