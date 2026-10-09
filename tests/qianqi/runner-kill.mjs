import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {readFileSync} from 'node:fs';
import {runShadow} from '../../server/shared/shadow-runner.mjs';
export async function exerciseRunnerKill({pool,url,config,makeReads}){
 const child=spawn(process.execPath,[resolve('tests/qianqi/runner-child.mjs')],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,QIANQI_RUNNER_TEST:JSON.stringify({url,config,hold:true})}});
 const exited=new Promise(resolve=>child.once('exit',resolve));
 let output='';
 try{
  await new Promise((ok,bad)=>{
   const timer=setTimeout(()=>bad(Error('Child did not acquire runner lock')),10000);
   child.once('error',e=>{clearTimeout(timer);bad(e);});child.once('exit',()=>{clearTimeout(timer);bad(Error('Child exited before lock: '+output));});
   child.stdout.on('data',b=>{output+=b;if(output.includes('LOCK_HELD')){clearTimeout(timer);ok();}});
   child.stderr.on('data',b=>output+=b);
  });
  const marker=readFileSync(join(config.root,'rehearsal.json'),'utf8');child.kill('SIGKILL');await exited;
  for(let i=0;;i++){
   try{await runShadow({pool,config,makeReads,log:()=>{}});break;}
   catch(e){if(i>=20||!e.message.includes('already active'))throw e;await new Promise(r=>setTimeout(r,100));}
  }
  assert.equal(readFileSync(join(config.root,'rehearsal.json'),'utf8'),marker);
 }finally{if(child.exitCode===null)child.kill('SIGKILL');await exited;}
}
