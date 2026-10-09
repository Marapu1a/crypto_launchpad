import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../server/adapters/qianqi/runtime/',import.meta.url));
fs.mkdirSync(new URL('../server/adapters/qianqi/runtime/.local/logs/',import.meta.url),{recursive:true});
const tests=['purchase-recognition','local-transaction','local-state-lock','pons-public-profile','pons-public-execution','public-status'];
if(process.argv.includes('--contracts'))tests.push('pons-public-runtime');
const result=spawnSync(process.execPath,['--test',...tests.map(name=>`test/${name}.test.cjs`)],{cwd,stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
