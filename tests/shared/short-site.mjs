import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer,request} from 'node:http';
import {chromium} from 'playwright';
import {createTestPostgres} from '../contracts/production-postgres.mjs';
import {projectSite} from '../../server/shared/site.mjs';
import {inProject} from '../../server/shared/store.mjs';
import {digest} from '../../src/tickets/digest.mjs';

const root='.local/test-results/short-site-'+new Date().toISOString().replace(/[:.]/g,'-');await fs.mkdir(root,{recursive:true});
const report={at:new Date().toISOString(),scenarios:[],limits:['Isolated PostgreSQL + Chromium; synthetic public snapshots','No DNS/VPS changes, no public transactions']};
const scenario=async(name,fn)=>{await fn();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);};
const a='a5897d1a-def5-4c9f-a7bb-a76f2b16519e',b='b5897d1a-def5-4c9f-a7bb-a76f2b16519e',addr=n=>'0x'+String(n).repeat(40),now=Math.floor(Date.now()/1000);
const snapshot=n=>({schema:'short-public-v1',checkpoint:{number:123,hash:'0x'+'1'.repeat(64),timestamp:now},finalized:{number:123,timestamp:now},metadata:{symbol:n===64?'ALPHA':'BETA',description:'Проверка публичной страницы',logo:''},settings:{asset:'USDG',decimals:6,thresholdRaw:'10000000',minimumFundRaw:'50000000',intervalSeconds:86400,creatorFeeBps:200,splitBps:[8000,1500,500],weights:[1]},fundRaw:String(n*1000000),liabilitiesRaw:'0',cycle:'1',pending:false,nextEligibleAt:String(now+86400),draw:{cycle:'1',budgetRaw:'50000000',awardedRaw:'0',settled:true},tickets:{creditedPurchases:4,wallets:3,totalIssued:'12',awaitingRecognition:1}});
let db,server,browser;
try{
 db=await createTestPostgres(root+'/postgres');
 for(const [id,slug,n] of [[a,'alpha',64],[b,'beta',96]]){
  await db.admin.query("INSERT INTO launchpad.projects VALUES($1,$2,$2,4663,$3,'test')",[id,slug,addr(n===64?1:2)]);
  await db.admin.query("INSERT INTO launchpad.module_instances VALUES($1,$1,'short','production-candidate-v1',$2,$3)",[id,addr(n===64?3:4),'a'.repeat(64)]);
  await db.admin.query('INSERT INTO launchpad.project_domains VALUES($1,$2)',[slug+'.localhost',id]);
  await inProject(db.pools.executor,id,c=>c.query("INSERT INTO launchpad.short_public_views(project_id,module_id,source_revision,snapshot,observed_at,service_status) VALUES($1,$1,1,$2,clock_timestamp(),'waiting')",[id,JSON.stringify(snapshot(n))]),{readOnly:false});
 }
 server=createServer(projectSite(db.pools.api));await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 const http=(host,path='/api/short',headers={},method='GET')=>new Promise((ok,bad)=>{const r=request({hostname:'127.0.0.1',port,path,method,headers:{host,...headers}},res=>{let body='';res.on('data',d=>body+=d);res.on('end',()=>ok({status:res.statusCode,body}));});r.on('error',bad);r.end();});
 await scenario('Domain-only API routing, read-only role, RLS and hidden owner/private paths',async()=>{
  assert.equal(JSON.parse((await http('alpha.localhost')).body).modules[0].snapshot.fundRaw,'64000000');
  assert.equal(JSON.parse((await http('beta.localhost')).body).modules[0].snapshot.fundRaw,'96000000');
  assert.equal((await http('unknown.localhost')).status,421);assert.equal((await http('alpha.localhost','/api/short?project_id='+b)).status,404);
  assert.equal(JSON.parse((await http('alpha.localhost','/api/short',{'X-Forwarded-Host':'beta.localhost','X-Project-Id':b})).body).modules[0].id,a);
  assert.equal((await http('alpha.localhost','/api/short',{},'POST')).status,405);
  for(const p of ['/owner.html','/.local/config.json','/assets/../owner.html'])assert.equal((await http('alpha.localhost',p)).status,404);
  assert.equal((await db.pools.api.query('SELECT * FROM launchpad.short_public_views')).rowCount,0);
  assert.equal((await inProject(db.pools.api,a,c=>c.query('SELECT * FROM launchpad.short_public_views WHERE project_id=$1',[b]))).rowCount,0);
  await assert.rejects(db.pools.api.query('SELECT * FROM launchpad.production_senders'),/permission denied/);
  await assert.rejects(inProject(db.pools.api,a,c=>c.query("UPDATE launchpad.short_public_views SET service_status='idle'"),{readOnly:false}),/permission denied/);
 });
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1250,height:1000}});
 await scenario('Browser shows correct token, fund, rules, ticket semantics and no-winner outcome',async()=>{
  await page.goto('http://alpha.localhost:'+port);await page.getByRole('heading',{name:'alpha',exact:true}).waitFor();
  assert.match(await page.locator('.token-metrics').innerText(),/64 USDG/);assert.match(await page.locator('.token-metrics').innerText(),/без победителя/);
  assert.match(await page.locator('main').innerText(),/10 USDG подтверждённых покупок/);assert.match(await page.locator('main').innerText(),/включая использованные билеты/);
  await page.screenshot({path:root+'/desktop.png',fullPage:true});
  await page.goto('http://beta.localhost:'+port);await page.getByRole('heading',{name:'beta',exact:true}).waitFor();assert.match(await page.locator('.token-metrics').innerText(),/96 USDG/);
 });
 await scenario('Stale/offline states preserve last values, escaped metadata cannot execute, mobile fits',async()=>{
  await db.admin.query("UPDATE launchpad.short_public_views SET observed_at=clock_timestamp()-interval '10 minutes',service_at=clock_timestamp()-interval '10 minutes' WHERE project_id=$1",[a]);
  await db.admin.query('UPDATE launchpad.projects SET display_name=$2 WHERE id=$1',[a,'<img src=x onerror=window.pwn=1>']);
  await page.goto('http://alpha.localhost:'+port);await page.locator('.is-warning').waitFor();assert.match(await page.locator('.token-metrics').innerText(),/Снимок устарел/);assert.equal(await page.evaluate(()=>window.pwn),undefined);
  await page.route('**/api/short',route=>route.fulfill({status:503,body:'{}'}));await page.locator('#refresh').click();await page.getByRole('alert').waitFor();assert.match(await page.locator('.token-metrics').innerText(),/64 USDG/);await page.unroute('**/api/short');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.screenshot({path:root+'/mobile.png',fullPage:true});
 });
 await scenario('Missing snapshot is visibly unavailable, never a fabricated zero fund',async()=>{
  await db.admin.query('UPDATE launchpad.short_public_views SET snapshot=NULL,observed_at=NULL WHERE project_id=$1',[a]);await page.reload();await page.getByText('Первого подтверждённого снимка ещё нет.').waitFor();assert.equal(await page.locator('.token-metrics').count(),0);
 });
 report.status='PASS';report.sources={};for(const file of ['server/shared/api.mjs','server/shared/site.mjs','server/shared/short-view.mjs','src/project.mjs','src/project.css','db/migrations/014_short_public_views.sql'])report.sources[file]=digest((await fs.readFile(file,'utf8')).replaceAll('\r\n','\n'));
}catch(e){report.status='FAIL';report.error=e.message;console.error(e);process.exitCode=1;}
finally{await fs.writeFile(root+'/report.json',JSON.stringify(report,null,2));console.log(root+'/report.json');await browser?.close();if(server)await new Promise(r=>server.close(r));await db?.close();}
