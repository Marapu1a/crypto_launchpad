import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import budget from '../../server/shared/rpc-budget.cjs';

test('release inspection refuses QuickNode before network or key loading and preserves quota',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pons-inspection-'));
 try{
  const file=join(dir,'budget.json');await budget.initializeBudget(file,{maxRequests:10,windowMs:3600000});
  const before=await readFile(file,'utf8');
  await writeFile(join(dir,'scheduler.json'),'{}');
  await writeFile(join(dir,'rpc'),'https://never-call.quiknode.pro/example');
  const config={schema:'pons-runtime-config-v1',mode:'production',allowedRpcHosts:['never-call.quiknode.pro'],rpcBudget:{file,maxRequests:10,windowMs:3600000},projects:[{id:'qianqi',adapter:'qianqi',schedulerFile:join(dir,'scheduler.json'),rpcFile:join(dir,'rpc')}]};
  await writeFile(join(dir,'config.json'),JSON.stringify(config));
  const output=join(dir,'report.json');
  const child=spawnSync(process.execPath,[resolve('scripts/inspect-pons-runtime.mjs'),join(dir,'config.json'),output],{encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(child.status,1,child.stderr);const report=JSON.parse(await readFile(output,'utf8'));
  assert.equal(report.status,'blocked');assert.equal(report.authorizationToSend,false);
  assert.equal(await readFile(file,'utf8'),before);
 }finally{await rm(dir,{recursive:true,force:true});}
});
