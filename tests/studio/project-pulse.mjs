import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch();
try{
const p=await browser.newPage();
await p.route('**/api/draws',r=>r.fulfill({json:{modules:[{observedAt:new Date().toISOString(),stale:false,service:{observedAt:new Date().toISOString(),status:'waiting'},snapshot:{kind:'short',fundRaw:'20',settings:{minimumFundRaw:'50'}}}]}}));
await p.goto('http://127.0.0.1:4201/project-status.html');await p.waitForFunction(()=>document.querySelector('project-pulse').dataset.state==='active');
assert.match(await p.locator('project-pulse').innerText(),/Prize fund growing/);
await p.evaluate(()=>{const e=document.querySelector('project-pulse');e.data.modules[0].service.observedAt=new Date(Date.now()-300000).toISOString();e.render();});assert.equal(await p.locator('project-pulse').getAttribute('data-state'),'delayed');
await p.evaluate(()=>{const e=document.querySelector('project-pulse');e.failed=true;e.render();});assert.equal(await p.locator('project-pulse').getAttribute('data-state'),'unknown');
await p.goto('http://127.0.0.1:4202/');assert.equal(await p.locator('iframe[title$="draw status"]').count(),2);
for(const width of [390,1440]){await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
for(const [timezoneId,date,expected] of [
 ['America/New_York','2026-10-13T12:00:00Z','08:00'],
 ['America/New_York','2026-01-13T12:00:00Z','07:00'],
 ['Europe/Moscow','2026-10-13T12:00:00Z','15:00'],
 ['Asia/Tokyo','2026-10-13T23:00:00Z','08:00']]){
 const context=await browser.newContext({timezoneId,locale:'en-GB'});const page=await context.newPage();
 await page.route('**/api/draws',r=>r.fulfill({status:503,json:{}}));
 await page.goto('http://127.0.0.1:4201/project-status.html');
 await page.evaluate(date=>document.querySelector('project-pulse').paint('',Date.parse(date),'delayed'),date);
 const text=await page.locator('project-pulse time').innerText();assert.ok(text.includes(expected),text);assert.match(text,/GMT/);
 assert.equal(await page.locator('project-pulse time').getAttribute('datetime'),new Date(date).toISOString());
 if(timezoneId==='Asia/Tokyo')assert.match(text,/14 Oct/);
 await context.close();
}
console.log('PASS: live component funding, stale heartbeat, failure, hub cards, mobile widths');
}finally{await browser.close();}
