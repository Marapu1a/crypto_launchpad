import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const output='.local/token-sites/review';await mkdir(output,{recursive:true});
const browser=await chromium.launch(),report=[];
try{
 for(const [id,port] of [['qianqi',4200],['igw',4201]]){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/www.geckoterminal.com/**',r=>r.abort());
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:950});await page.goto('http://127.0.0.1:'+port,{waitUntil:'networkidle'});
   assert.equal(await page.locator('[data-site-component="footer"]').count(),1);
   assert.equal(await page.locator('[data-site-component="draws"]').count(),1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,id+' overflow '+width);
   const button=page.locator('.kit-footer .contact-open');await button.click();assert.equal(await page.locator('.kit-contact').evaluate(n=>n.open),true);
   assert.equal(await page.locator('.kit-contact-links a').count(),3);
   await page.keyboard.press('Escape');assert.equal(await page.locator('.kit-contact').evaluate(n=>n.open),false);assert.equal(await button.evaluate(n=>document.activeElement===n),true);
   await button.click();await page.mouse.click(2,2);assert.equal(await page.locator('.kit-contact').evaluate(n=>n.open),false);
   const images=await page.locator('img').evaluateAll(nodes=>nodes.filter(n=>!n.hidden&&getComputedStyle(n).display!=='none').map(n=>({src:n.getAttribute('src'),ok:n.complete&&n.naturalWidth>0})));
   assert.equal(images.every(i=>i.ok),true,JSON.stringify(images));
   if(id==='qianqi')assert.ok(await page.locator('.kit-footer-mascot').evaluate(n=>n.getBoundingClientRect().width)<=104);
   if(width===390||width===1440){await page.screenshot({path:output+'/'+id+'-'+width+'.png',fullPage:true});}
   report.push({id,width,overflow:false,dialog:'PASS',images:'PASS'});
  }
  if(id==='qianqi'){
   for(const [lang,label] of [['ru','Связаться'],['zh-HK','聯絡'],['en','Contact']]){
    await page.locator('[data-language-select]').selectOption(lang);await page.waitForFunction(label=>document.querySelector('.kit-footer .contact-open').textContent===label,label);
   }
   await page.locator('header .connect').click();await page.waitForFunction(()=>document.querySelector('#dialog').open);
   await page.keyboard.press('Escape');report.push({id,languages:'PASS',walletDialog:'PASS'});
   let stale=false;
   await page.route('**/v1/overview?**',r=>{
    const offset=Number(new URL(r.request().url()).searchParams.get('offset'));
    const draw={freeRaw:'100000000',earliestAt:'1791800000',state:'awaitingTime'};
    return r.fulfill({json:{schema:'promo-overview-v1',status:stale?'stale':'observed',asset:{decimals:6},provenance:{chainId:4663,head:{number:100},observedAt:new Date().toISOString(),indexerState:'caughtUp'},reserves:{freeShort:'100000000',freeCurrent:'100000000',freeNext:'100000000',nextStartTarget:'100000000',reserved:'0',claimable:'0'},draws:{SHORT:draw,MONTHLY:draw},history:{total:6,nextOffset:offset?null:5,items:[{drawId:'test-'+offset,kind:'SHORT',status:'winner',completedAt:'1791700000',paidRaw:'25000000',budgetRaw:'100000000',awardedRaw:'50000000',terminal:{source:{transactionHash:'0x'+'a'.repeat(64)}}}]}}});
   });
   await page.reload({waitUntil:'networkidle'});assert.match(await page.locator('#draw-history').textContent(),/25.*USDG paid/s);
   await page.locator('#history-next').click();await page.waitForFunction(()=>document.querySelector('#history-heading').textContent==='Previous results');
   await page.locator('#history-prev').click();await page.waitForFunction(()=>document.querySelector('#history-heading').textContent==='Latest results');
   stale=true;await page.reload({waitUntil:'networkidle'});assert.match(await page.locator('#overview-status').textContent(),/Updates delayed/);
   report.push({id,confirmedResult:'PASS',pagination:'PASS',stale:'PASS'});
  }else{
   let state='fresh';
   await page.route('**/api/project',r=>r.fulfill(state==='prelaunch'?{status:421,json:{error:'unknown_project_host'}}:state==='offline'?{status:503,json:{}}:{json:{project:{slug:state==='wrong'?'qianqi':'igw',chain_id:4663,token_address:'0x'+'1'.repeat(40)}}}));
   await page.route('**/api/draws',r=>r.fulfill({json:{modules:state==='empty'?[]:[{observedAt:new Date().toISOString(),stale:state==='stale',service:{status:state==='blocked'?'blocked':'waiting'},snapshot:{kind:'short',settings:{asset:'USDG',decimals:6},fundRaw:state==='invalid'?'-1':'50123456',nextEligibleAt:'1791800000',draw:state==='waiting'?null:{cycle:'2',settled:true,budgetRaw:'50000000',awardedRaw:'35000000'}}}]}}));
   for(state of ['fresh','stale','blocked','empty','waiting','invalid','wrong','offline','prelaunch']){
    await page.reload({waitUntil:'networkidle'});
    const text=await page.locator('.kit-draws').textContent(),status=await page.locator('#kit-draw-state').textContent();
    if(['fresh','stale','blocked','waiting'].includes(state))assert.match(text,/50\.123456/);else assert.doesNotMatch(text,/50\.123456/);
    if(['stale','blocked'].includes(state))assert.match(status,/Updates delayed/);
    if(state==='fresh')assert.match(text,/35 USDG awarded/);
    if(['wrong','offline','invalid'].includes(state))assert.match(status,/Updates unavailable/);
    if(state==='empty')assert.match(status,/first confirmed snapshot/);
    report.push({id,state,result:'PASS'});
   }
   // A failed refresh after a successful one must clear a previous project's data.
   await page.evaluate(()=>{
    document.dispatchEvent(new CustomEvent('token-site-draws',{detail:{state:'confirmed',modules:[{observedAt:new Date().toISOString(),service:{},snapshot:{kind:'short',settings:{asset:'USDG',decimals:6},fundRaw:'99123456'}}]}}));
    document.dispatchEvent(new CustomEvent('token-site-draws',{detail:{state:'unavailable'}}));
   });assert.doesNotMatch(await page.locator('.kit-draws').textContent(),/99\.123456/);
  }
  assert.deepEqual(errors,[],id+' JS errors');await page.close();
 }
 await writeFile(output+'/checks.json',JSON.stringify(report,null,2));console.log('PASS: '+report.length+' layout, dialog, language and data-state checks');
}finally{await browser.close();}
