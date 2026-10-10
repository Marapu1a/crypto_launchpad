import {spawn} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {createEnvironment} from '../server/studio/environment.mjs';
const root=path.resolve('.local/studio/'+new Date().toISOString().replace(/[:.]/g,'-'));
let env,child;
try{
 env=await createEnvironment(root);
 child=spawn(process.execPath,['scripts/run-studio.mjs',path.join(root,'runtime.json')],{stdio:'inherit',windowsHide:true});
 console.log('Local infrastructure: '+root+'; no production transactions.');
 let stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;clearInterval(control);if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}await env.close();process.exit();};
 const control=setInterval(()=>{if(fs.existsSync(path.join(root,'stop-request')))void stop();},1000);
 fs.writeFileSync(path.resolve('.local/studio/current.json'),JSON.stringify({root,runtime:path.join(root,'runtime.json'),ownerPid:process.pid,panelPid:child.pid},null,2));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 child.once('exit',()=>console.log('Panel stopped. Infrastructure retained; resume with: node scripts/run-studio.mjs '+path.join(root,'runtime.json')));
}catch{console.error('Studio startup failed; inspect ignored local logs');await env?.close();process.exitCode=1;}
