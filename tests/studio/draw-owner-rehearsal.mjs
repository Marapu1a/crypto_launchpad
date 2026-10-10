import {createServer} from 'node:http';
import {createPool} from '../../server/shared/store.mjs';
import {validateRuntimeConfig,loadRuntimeProject} from '../../server/short-runtime/config.mjs';
import {runtimePass} from '../../server/short-runtime/runtime.mjs';
import {publishShortView} from '../../server/short-runtime/projection.mjs';
import {projectSite} from '../../server/shared/site.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {JsonRpcProvider} from 'ethers';
import {createOwnerRehearsal} from '../../server/owner-launch/rehearsal-environment.mjs';
import {freePort} from '../../server/studio/environment.mjs';
import {digest} from '../../src/tickets/digest.mjs';
const root=path.resolve('.local/test-results/draw-owner-stand-'+new Date().toISOString().replace(/[:.]/g,'-'));await fs.mkdir(root,{recursive:true});
const report={at:new Date().toISOString(),scenarios:[],limits:['Private historical fork82000000 only; latest modeled as finalized','Loopback fixture wallet, not a wallet extension','Only UI restart is persistent; chain lives in the supervisor process']};
let env,child,browser,provider,pools,site;const kill=async()=>{if(child&&child.exitCode===null){const p=new Promise(r=>child.once('exit',r));child.kill();await p;}};
const scenario=async(name,fn)=>{await fn();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);};
try{
 const port=await freePort();env=await createOwnerRehearsal(root,{httpPort:port,version:2});const origin='http://127.0.0.1:'+port;
 provider=new JsonRpcProvider(env.config.rpcUrl,undefined,{cacheTimeout:-1});
 const start=async(file=env.file)=>{child=spawn(process.execPath,['scripts/run-owner-rehearsal.mjs',file],{stdio:'ignore',windowsHide:true});for(let i=0;i<360;i++){if(child.exitCode!==null)throw Error('UI startup failed');try{const r=await fetch(origin+'/api/owner-launch/config');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('UI startup timeout');};
 await start();browser=await chromium.launch();const page=await browser.newPage();page.setDefaultTimeout(120000);let accept=false;page.on('dialog',dialog=>accept?dialog.accept():dialog.dismiss());
 let project;
 const post=(kind,body={},headers={})=>fetch(origin+'/api/owner-launch/'+project+'/'+kind,{method:'POST',headers:{'content-type':'application/json',origin,...headers},body:JSON.stringify(body)});
 const state=async()=>{const r=await post('next');assert.equal(r.status,200);return r.json();};
 const click=async selector=>{await page.locator(selector).click();await page.waitForFunction(()=>!document.querySelector('#refresh')?.disabled,{},{timeout:120000});};
 await scenario('Isolated stand serves fixture UI; create/cancel/read-only actions never send',async()=>{
  await page.goto(origin);await page.getByText('Локальный тестовый кошелёк.',{exact:true}).waitFor();
  await page.evaluate(()=>localStorage.setItem('launchpad:owner-launch:v2',JSON.stringify({id:'old-project-id',instanceId:'old-instance',input:{}})));await page.reload();await page.getByText('old-project-id',{exact:true}).waitFor();await page.locator('#new-stand').click();await page.getByText('Локальный тестовый кошелёк.',{exact:true}).waitFor();
  await page.locator('[name=mode]').selectOption('monthly');assert.equal(await page.locator('[name=hours]').isVisible(),false);
  await page.locator('[name=mode]').selectOption('short');assert.equal(await page.locator('[name=monthlyMinimum]').isVisible(),false);
  await page.locator('[name=mode]').selectOption('both');
  await page.locator('[name=shortShare]').fill('7000');await page.locator('[name=shortShare]').dispatchEvent('input');
  assert.equal(await page.locator('#allocation-label').textContent(),'70%');
  await page.locator('[name=hours]').fill('168');
  await page.locator('[name=monthlyMinimum]').fill('50');await page.locator('[name=monthlyNext]').fill('50');
  await page.locator('[name=logo]').fill('ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee');
  const nonce=await provider.getTransactionCount(env.config.profile.owner);await page.locator('#owner-form button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#sign')||document.querySelector('#notice')?.textContent);assert.equal(await page.locator('#sign').count(),1,await page.locator('#notice').innerText());
  project=await page.evaluate(()=>JSON.parse(localStorage.getItem('launchpad:owner-launch:v2')).id);
  await click('#sign');assert.equal(await provider.getTransactionCount(env.config.profile.owner),nonce);
  assert.equal((await post('rehearsal-sign',{requestId:'wrong'})).status,409);
  assert.equal((await post('rehearsal-sign',{requestId:'wrong',to:env.config.profile.owner})).status,400);
  assert.equal((await post('rehearsal-sign',{requestId:'wrong'},{origin:'https://other.example'})).status,403);
  for(const file of ['/.local/owner-server.json','/assets/../owner-server.json','/launch.html'])assert.equal((await fetch(origin+file)).status,404);
 });
 await scenario('UI process restart and empty browser recover same launch and nonce',async()=>{
  accept=true;await click('#sign');const before=await state();assert.equal(before.history.length,1);const nonce=await provider.getTransactionCount(env.config.profile.owner);
  await kill();await start();await page.evaluate(()=>localStorage.clear());await page.reload();await page.getByText('Продолжить запуск по ID',{exact:true}).click();await page.locator('#resume-id').fill(project);await page.locator('#resume').click();await page.locator('#sign').waitFor({timeout:120000});
  assert.equal((await state()).history[0].hash,before.history[0].hash);assert.equal(await provider.getTransactionCount(env.config.profile.owner),nonce);await click('#refresh');
 });
 await scenario('Manual fixture steps register token; prepared keys export only disabled runtime',async()=>{
  for(let i=0;i<16;i++){const s=await state();if(s.stage==='deployed')break;await click('#refresh');await page.locator('#sign').waitFor();await click('#sign');}
  const s=await state();assert.equal(s.stage,'deployed');assert.equal(s.history.filter(h=>h.kind==='launch').length,1);report.token=s.launch.token;report.transactions=s.history.map(h=>({kind:h.kind,hash:h.hash}));
  assert.equal(s.input.draws.allocation.shortBps,7000);assert.equal(s.input.draws.short.intervalSeconds,604800);
  const nonce=await provider.getTransactionCount(env.config.profile.owner);await click('#handoff');await page.locator('#download-runtime').waitFor({timeout:120000});const h=await (await post('handoff')).json();assert.equal(h.prepared,true);assert.equal(h.config.allowPublicTransactions,false);assert.equal(h.config.projects[0].enabled,false);assert.equal(h.site.registered,false);assert.equal(await provider.getTransactionCount(env.config.profile.owner),nonce);
  await page.screenshot({path:path.join(root,'owner-stand.png'),fullPage:true});
 });
 await scenario('Disabled runtime stays paused; explicit local pass publishes both isolated public funds',async()=>{
  const h=await (await post('handoff')).json(),config=validateRuntimeConfig(h.config);assert.equal(config.schema,'draw-runtime-config-v2');
  pools=Object.fromEntries(Object.entries(env.config.urls).map(([role,url])=>[role,createPool(url)]));
  const chain=new Proxy(provider,{get(t,k){if(k==='getBlock')return n=>t.getBlock(n==='finalized'?'latest':n);const v=Reflect.get(t,k);return typeof v==='function'?v.bind(t):v;}});
  const entry=config.projects[0],loaded=await loadRuntimeProject({pool:pools.executor,provider:chain,config,entry});
  assert.equal(loaded.policySchema,'draw-production-policy-v2');
  await assert.rejects(loadRuntimeProject({pool:pools.executor,provider:chain,config:{...config,schema:'short-runtime-config-v1'},entry}),/registration mismatch/);
  const before=await provider.getTransactionCount(loaded.signer.address);
  assert.equal((await runtimePass({provider:chain,projects:[loaded]})).projects[0].status,'paused');
  const latest=await provider.getBlock('latest'),active={...loaded,enabled:true,now:()=>latest.timestamp};
  const health=await runtimePass({provider:chain,projects:[active]});assert.equal(health.projects[0].status,'waiting',JSON.stringify(health));
  assert.equal((await publishShortView({pool:pools.executor,provider:chain,...health.projects[0]})).failed,false);
  assert.equal(await provider.getTransactionCount(loaded.signer.address),before);
  await pools.admin.query('INSERT INTO launchpad.project_domains VALUES($1,$2)',['127.0.0.1',project]);
  site=createServer(projectSite(pools.api));await new Promise(r=>site.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+site.address().port;
  const data=await (await fetch(url+'/api/draws')).json();assert.equal(data.modules.length,2);
  assert.deepEqual(data.modules.map(m=>m.snapshot.settings.allocationBps),[7000,3000]);
  assert.equal(data.modules[1].snapshot.nextTargetRaw,'50000000');
  assert.ok(!JSON.stringify(data).includes('privateKey'));assert.ok(!JSON.stringify(data).includes('policy_text'));
  await page.goto(url);await page.getByRole('heading',{name:'Monthly · месячный розыгрыш'}).waitFor();
  await page.getByRole('heading',{name:'Short · короткий розыгрыш'}).waitFor();
  await page.getByText('Резерв следующего розыгрыша',{exact:true}).waitFor();
  await page.screenshot({path:path.join(root,'draw-project.png'),fullPage:true});
 });
 await scenario('A replaced fork instance cannot resume an old UI configuration',async()=>{
  await kill();const wrong=path.join(root,'wrong-instance.json');await fs.writeFile(wrong,JSON.stringify({...env.config,profile:{...env.config.profile,instanceId:'different'}}));
  child=spawn(process.execPath,['scripts/run-owner-rehearsal.mjs',wrong],{stdio:'ignore',windowsHide:true});const exit=await new Promise(r=>child.once('exit',r));assert.equal(exit,1);
 });
 report.status='PASS';report.sources={};for(const f of ['server/owner-launch/rehearsal-environment.mjs','server/owner-launch/rehearsal-sign.mjs','server/owner-launch/http.mjs','scripts/run-owner-rehearsal.mjs','scripts/start-owner-rehearsal.mjs','src/owner-launch.mjs','src/launch/owner-form.mjs','src/project.mjs','server/short-runtime/config.mjs','server/short-runtime/runtime.mjs','server/short-runtime/draw-projection.mjs','server/short-runtime/projection.mjs','server/shared/short-view.mjs'])report.sources[f]=digest((await fs.readFile(f,'utf8')).replaceAll('\r\n','\n'));
}catch(e){report.status='FAIL';report.error=String(e.message).replace(/https?:\/\/[^\s"']+/g,'[URL]');console.error(report.error);process.exitCode=1;}
finally{await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(path.join(root,'report.json'));await browser?.close();await kill();if(site)await new Promise(r=>site.close(r));await Promise.allSettled(Object.values(pools??{}).map(p=>p.end()));provider?.destroy();await env?.close();}
