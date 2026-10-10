import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createOwnerRehearsal} from '../server/owner-launch/rehearsal-environment.mjs';

const root=path.resolve('.local/owner-rehearsal/'+new Date().toISOString().replace(/[:.]/g,'-'));
let env,child,timer,stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;clearInterval(timer);if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}await env?.close();};
try{
 env=await createOwnerRehearsal(root,process.argv.includes('--v2')?{version:2,httpPort:4188}:{});
 child=spawn(process.execPath,['scripts/run-owner-rehearsal.mjs',env.file],{stdio:'inherit',windowsHide:true});
 child.once('exit',()=>console.log('UI stopped. Original fork and DB remain until this supervisor stops. Resume UI: node scripts/run-owner-rehearsal.mjs '+JSON.stringify(env.file)));
 await fs.writeFile(path.join(root,'supervisor.json'),JSON.stringify({pid:process.pid,uiPid:child.pid,file:env.file},null,2));
 console.log('Private rehearsal only. Journal: '+root);
 process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
 // Keep the infrastructure supervisor alive after an independent UI restart.
 timer=setInterval(async()=>{try{await fs.access(path.join(root,'stop-request'));await stop();}catch{}},1000);
}catch{console.error('Owner rehearsal setup failed; inspect ignored local logs.');await stop();process.exitCode=1;}
