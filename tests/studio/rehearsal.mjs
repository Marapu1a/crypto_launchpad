import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Contract} from 'ethers';
import {chromium} from '@playwright/test';
import {createEnvironment} from '../../server/studio/environment.mjs';
import {createStudio} from '../../server/studio/service.mjs';
import {studioHttp} from '../../server/studio/http.mjs';
import {readLaunch} from '../../server/studio/onboard.mjs';
import {USDG} from '../../server/studio/template.mjs';
import {initialDraft} from '../../src/pons/plan.mjs';
import {fetchBeacon,GENESIS,PERIOD} from '../../src/randomness/drand.mjs';
const root=path.resolve('.local/test-results/studio-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(root,{recursive:true});const report={scope:'Isolated local fork and PostgreSQL; real browser; no production changes',scenarios:[]};
let env,server,browser;
const scenario=async(name,fn)=>{await fn();report.scenarios.push(name);console.log('PASS '+name);};
try{
 env=await createEnvironment(root);const {provider,signer,pools}=env,projects=env.runtime.root;
 const defaults={config:JSON.parse(fs.readFileSync('config/rehearsals/first-token.json')),team:await (await provider.getSigner(2)).getAddress(),operations:await (await provider.getSigner(3)).getAddress()};
 let fail=true;
 let studio=createStudio({root:projects,provider,signer,pools,hook:async(phase,key)=>{if(fail&&phase==='signed'&&key==='launch'){fail=false;throw Error('simulated process interruption');}}});
 let handler=studioHttp({studio,apiPool:pools.api,dist:path.resolve('dist'),defaults});
 server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,url='http://127.0.0.1:'+port;
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 let first;
 await scenario('Browser validates split before any deployment',async()=>{
  await page.goto(url+'/launch.html');await page.locator('[name=prizes]').fill('90');await page.locator('#create').click();
  await page.getByRole('status').filter({hasText:'100%'}).waitFor();assert.equal(studio.list().length,0);await page.locator('[name=prizes]').fill('80');
 });
 await scenario('UI launch interrupted after signed intent resumes with same token after service reload',async()=>{
  await page.locator('#create').click();await page.getByRole('status').filter({hasText:'Шаг не завершён'}).waitFor({timeout:180000});
  first=studio.list()[0];const saved=readLaunch(path.join(projects,first.id,'launch.json')),hash=saved.transactions.launch.hash;
  assert.equal(saved.stage,'deploying');assert.equal(await provider.getTransactionReceipt(hash),null);
  studio=createStudio({root:projects,provider,signer,pools});handler=studioHttp({studio,apiPool:pools.api,dist:path.resolve('dist'),defaults});
  await page.reload();await page.locator('#create').click();await page.getByRole('status').filter({hasText:'Проект подключён'}).waitFor({timeout:180000});
  const after=readLaunch(path.join(projects,first.id,'launch.json'));assert.equal(after.transactions.launch.hash,hash);first=studio.list()[0];
  const nonce=await provider.getTransactionCount(signer.address);await studio.launch(after.input);assert.equal(await provider.getTransactionCount(signer.address),nonce);
  await assert.rejects(studio.launch({...after.input,draws:{...after.input.draws,ticketPurchase:'11'}}),/изменились/);
  await page.screenshot({path:path.join(root,'created.png'),fullPage:true});
 });
 await scenario('Second token has isolated contracts, executor, routing and tickets',async()=>{
  const s=readLaunch(path.join(projects,first.id,'launch.json'));
  const input={...s.input,id:randomUUID(),slug:'second-token',draft:{...s.input.draft,salt:initialDraft().salt,name:'Second Token',symbol:'SECOND'}};
  const second=await studio.launch(input);assert.notEqual(first.program,second.program);assert.notEqual(first.token,second.token);
  const other=readLaunch(path.join(projects,second.id,'launch.json'));assert.notEqual(s.config.executor,other.config.executor);
  for(const p of [first,second]){
   const r=await new Promise((resolve,reject)=>{const req=httpRequest(url+'/api/project',{headers:{Host:p.hostname+':'+port}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();});assert.equal(r.status,200);assert(r.body.includes(p.token.toLowerCase()));
  }
  assert.equal((await fetch(url+'/api/project')).status,421);
  assert.equal((await fetch(url+'/api/studio/projects',{method:'POST',headers:{'content-type':'application/json',Origin:'https://evil.invalid'},body:JSON.stringify(input)})).status,403);
  report.second=second;
 });
 const s=readLaunch(path.join(projects,first.id,'launch.json'));
 const quote=new Contract(USDG,['function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)'],signer);
 const curve=new Contract(s.launch.curve,['function buy(uint256,uint256,address) returns(uint256)'],signer);
 const program=new Contract(first.program,['function cycle() view returns(uint256)','function pending() view returns(bool)','function consumedThrough(address) view returns(uint128)','function requestForCycle(uint256) view returns(uint256)','function randomness() view returns(address)','function draws(uint256) view returns(bytes32 participantsHash,bytes32 context,bytes32 resultHash,uint256 budget,uint256 awarded,bool settled)','function liabilities() view returns(uint256)'],provider);
 const tx=async value=>(await value).wait();
 await scenario('Known buys are recognized late, fund split collected, daily snapshot frozen automatically',async()=>{
  await page.locator('#exercise').click();await page.getByRole('status').filter({hasText:'Тестовая покупка выполнена'}).waitFor({timeout:60000});
  const nonce=await provider.getTransactionCount(signer.address);await studio.exercise(first.id);assert.equal(await provider.getTransactionCount(signer.address),nonce);
  for(let i=0;i<35&&!await program.pending();i++)await studio.pass(first.id);
  assert.equal(await program.cycle(),1n);assert.equal(await program.pending(),true);
  const detail=await studio.detail(first.id);assert.equal(detail.ledger.wallets[signer.address.toLowerCase()].tickets,'312');
  assert.equal((await studio.detail(report.second.id)).ledger.wallets[signer.address.toLowerCase()],undefined);
 });
 const adapter=new Contract(await program.randomness(),['function requests(uint256) view returns(address consumer,bytes32 context,uint64 round,bool proven,bool delivered,bytes32 seed)'],provider);
 const rng=await adapter.requests(await program.requestForCycle(1));
 console.log('Waiting for pinned drand round '+rng.round);
 const deadline=Date.now()+100000;let beacon;
 while(!beacon){try{beacon=await fetchBeacon(Number(rng.round));}catch(e){if(Date.now()>deadline)throw e;await new Promise(r=>setTimeout(r,2000));}}
 await provider.send('evm_setNextBlockTimestamp',[Math.max(GENESIS+(Number(rng.round)-1)*PERIOD,(await provider.getBlock('latest')).timestamp+1)]);await provider.send('evm_mine',[]);
 await scenario('Service restart continues pinned randomness through settlement and pays at most once',async()=>{
  studio=createStudio({root:projects,provider,signer,pools});
  for(let i=0;i<18;i++){await studio.pass(first.id);if((await program.draws(1)).settled&&await program.liabilities()===0n)break;}
  const draw=await program.draws(1);assert.equal(draw.settled,true);assert.equal(await program.liabilities(),0n);assert.equal(await program.consumedThrough(signer.address),312n);
  const balance=await quote.balanceOf(signer.address);for(let i=0;i<3;i++)await studio.pass(first.id);assert.equal(await quote.balanceOf(signer.address),balance);assert.equal(await program.cycle(),1n);
  report.result={token:first.token,project:first.id,round:String(rng.round),budget:String(draw.budget),awarded:String(draw.awarded)};
 });
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e.shortMessage||e.message).replace(/https?:\/\/\S+/g,'[endpoint]');console.error(report.error);process.exitCode=1;}
finally{await browser?.close();if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});await env?.close();fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(path.join(root,'report.json'));}
