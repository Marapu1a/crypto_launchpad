import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {pwOwnerFixture} from './pw-owner-fixture.mjs';
const root='.local/test-results/pw-owner-ui-'+new Date().toISOString().replace(/[:.]/g,'-');await mkdir(root,{recursive:true});
const fixture=await pwOwnerFixture(),disabled=await pwOwnerFixture({enabled:false});let browser;
const report={status:'FAIL',limits:['Built UI and actual signing console; modeled coordinator only','Public test key signs offline; no RPC, DB, funds or production configuration']};
try{
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(fixture.url);await page.locator('[data-action=prepare]').click();await page.locator('[data-action=quote]').click();await page.locator('#confirm').waitFor();
 assert.equal(await page.locator('#sign').isDisabled(),true);assert.deepEqual(fixture.counts(),{signatures:0,broadcasts:0});
 await page.screenshot({path:root+'/desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:root+'/mobile.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#confirm').check();await page.locator('#sign').click();await page.locator('[data-action=broadcast]').waitFor();
 assert.deepEqual(fixture.counts(),{signatures:1,broadcasts:0});
 await page.reload();await page.locator('[data-action=broadcast]').waitFor();assert.equal(await page.locator('#sign').count(),0);
 await page.locator('[data-action=broadcast]').click();await page.locator('[data-action=resolve]').click();await page.locator('[data-action=quote]').waitFor();
 for(let i=1;i<9;i++){
  await page.locator('[data-action=quote]').click();await page.locator('#confirm').check();await page.locator('#sign').click();await page.locator('[data-action=broadcast]').click();await page.locator('[data-action=resolve]').click();
  if(i<8)await page.locator('[data-action=quote]').waitFor();
 }
 await page.getByRole('heading',{name:'Ожидаем финализацию'}).waitFor();assert.equal(await page.locator('#sign,[data-action=broadcast]').count(),0);
 await page.locator('[data-action=resolve]').click();await page.getByRole('heading',{name:'Запуск завершён'}).waitFor();assert.deepEqual(fixture.counts(),{signatures:9,broadcasts:9});
 const locked=await browser.newPage();await locked.goto(disabled.url);await locked.locator('[data-action=prepare]').click();await locked.locator('[data-action=quote]').click();await locked.locator('#confirm').check();assert.equal(await locked.locator('#sign').isDisabled(),true);
 const post=(path,headers={},data={})=>page.request.post(fixture.url+'/api/pw-owner/'+path,{headers:{origin:fixture.url,'content-type':'application/json',...headers},data});
 assert.equal((await post('prepare',{origin:'https://foreign.invalid'})).status(),403);
 assert.equal((await post('sign',{}, {reviewId:'x',raw:'forbidden',privateKey:'forbidden'})).status(),400);
 assert.equal((await post('status',{'content-type':'text/plain'})).status(),415);
 assert.equal((await post('status',{}, {extra:'x'.repeat(5000)})).status(),413);
 assert.equal((await post('status',{host:'foreign.invalid'})).status(),403);
 assert.deepEqual(errors,[]);report.status='PASS';report.checks=['9 explicit steps, separate signing and send','reload recovers saved transaction without resigning','finality gate','disabled signing','desktop/mobile without overflow','Host/Origin/body boundaries'];
}finally{await writeFile(root+'/report.json',JSON.stringify(report,null,2));await browser?.close();await fixture.close();await disabled.close();console.log(root+'/report.json',report.status);}
