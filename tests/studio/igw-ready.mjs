import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {demoModule,demoAddress} from '../fixtures/igw-wallet-site.mjs';
const root='.local/igw-sites-ready-20261012';await fs.mkdir(root,{recursive:true});
const browser=await chromium.launch(),report=[];
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let mode='missing',walletReads=0;const token='0x'+'9'.repeat(40);
 await page.route('**/api/project',r=>r.fulfill(mode==='missing'?{status:421,json:{error:'unknown_project_host'}}:mode==='offline'?{status:503,json:{}}:{json:{project:{slug:mode==='wrong'?'qianqi':'igw',chain_id:4663,token_address:token}}}));
 await page.route('**/api/draws',r=>r.fulfill(mode==='draw-offline'?{status:503,json:{}}:{json:{modules:mode==='empty'?[]:[demoModule()]}}));
 await page.route('**/api/wallet/*',r=>{walletReads++;return r.fulfill({json:{address:demoAddress,modules:[demoModule()]}});});
 await page.goto('http://127.0.0.1:4201/');await page.waitForFunction(()=>document.querySelector('#network-state').textContent.includes('Contract data is unavailable'));
 assert.doesNotMatch(await page.locator('body').innerText(),/pre-launch|not launched|not live yet|in preparation|proposed|planned at launch|after launch/i);
 assert.equal(await page.locator('#market-links').isVisible(),false);assert.equal(await page.locator('#buy-igw').getAttribute('href'),null);
 await page.locator('#wallet-address').fill(demoAddress);await page.locator('#wallet-form').evaluate(f=>f.requestSubmit());assert.equal(walletReads,0);assert.equal(await page.locator('.wallet-card').count(),0);
 report.push('Missing identity: no invented address, trading URL, ticket or fund; wallet selection retained');
 const refresh=async()=>{await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));};
 mode='fresh';await refresh();await page.locator('.wallet-card').waitFor();await page.waitForFunction(()=>document.querySelector('#network-state').textContent.includes('Confirmed snapshot'));
 assert.equal(await page.locator('#buy-igw').getAttribute('href'),'https://www.ponsfamily.com/launchpad/'+token);assert.equal(await page.locator('#market-links').isVisible(),true);assert.equal(walletReads,1);
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedContract=text;}}}));await page.locator('#copy-contract').click();assert.equal(await page.evaluate(()=>window.copiedContract),token);
 report.push('Identity arrives without reload: Pons/explorer/copy and selected wallet activate');
 mode='draw-offline';await refresh();await page.waitForFunction(()=>document.querySelector('#network-state').textContent.includes('Draw data is temporarily unavailable'));
 assert.equal(await page.locator('#market-links').isVisible(),true);assert.doesNotMatch(await page.locator('.kit-draws').textContent(),/50\.123456/);report.push('Draw outage clears funds but preserves verified trading link');
 mode='empty';await refresh();await page.waitForFunction(()=>document.querySelector('#kit-draw-state').textContent.includes('first confirmed snapshot'));assert.equal(await page.locator('#market-links').isVisible(),true);report.push('Registered token without snapshot retains contract and trading links');
 for(mode of ['wrong','offline','missing']){
  await refresh();await page.waitForFunction(()=>document.querySelector('#market-links').hidden);assert.equal(await page.locator('#buy-igw').getAttribute('href'),null);assert.equal(await page.locator('.wallet-card').count(),0);
  await page.waitForFunction(()=>!busy);
 }
 report.push('Wrong identity and network failure clear links and wallet results');
 mode='fresh';await refresh();await page.locator('.wallet-card').waitFor();report.push('Recovery restores selected wallet without reloading');
 for(const width of [390,1440]){await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:root+'/fixture-'+width+'.png',fullPage:true});}
 assert.deepEqual(errors,[]);await fs.writeFile(root+'/transitions.json',JSON.stringify({status:'PASS',limits:'Mock API only; no chain sends',checks:report},null,2));console.log('PASS '+report.length+' launch transition checks');
}finally{await browser.close();}
