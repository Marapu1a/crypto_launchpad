import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const root='.local/monitor-v2';await mkdir(root,{recursive:true});
const html=await readFile('scripts/pons-monitor/index.html');
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
const metric={buys:250,buyers:2,volume:'50',median:'0.2',maximum:'0.2',maximumTx:'0x'+'a'.repeat(64),top3Pct:100,missingAmounts:0};
const data={schema:'pons-monitor-v2',updated:Date.now()/1000,windowEnd:Date.now()/1000-60,complete:true,signal:false,stale:false,scanSeconds:1,observedTokens:2,current:{buys:250,buyers:2,tokens:1,launches:2},baseline:{buys:2,buyers:1,tokens:1,launches:1},chart:[{buyers:1},{buyers:2}],volumes:[{symbol:'USDG',volume:'50',missingAmounts:0}],board:[{address:'0x'+'1'.repeat(40),symbol:'TINY',name:'Many small buys',quote:'USDG',ageSeconds:1500,twitter:'https://x.com/example',recent:metric,lifetime:{...metric,volume:'100',buys:500}},{address:'0x'+'2'.repeat(40),symbol:'<img src=x onerror=alert(1)>',name:'No trades',quote:'ETH',ageSeconds:180,twitter:'javascript:alert(1)',recent:{...metric,buys:0,buyers:0,volume:'0',maximum:null,median:null,maximumTx:null,top3Pct:null},lifetime:metric}]};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/status',r=>r.fulfill({json:data}));let refreshes=0;await page.route('**/api/refresh',r=>{assert.equal(r.request().method(),'POST');assert.equal(r.request().headers()['x-monitor-refresh'],'1');refreshes++;return r.fulfill({status:202,json:{}});});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('#rows tr');
 const first=page.locator('#rows tr').first();assert.equal(await first.locator('td').nth(1).locator('strong').innerText(),'2');assert.equal(await first.locator('td').nth(2).locator('strong').innerText(),'250');
 assert.equal(await page.locator('#rows tr').count(),1);assert.equal(await page.evaluate(()=>amount('1.234567')), '1,23');assert.equal(await page.evaluate(()=>amount('0.000031')), '<0,01');assert.equal(await page.evaluate(()=>amount('0')), '0');assert.match(await page.locator('#cards').innerText(),/Ранее в среднем/);assert.equal(await page.locator('#rows img').count(),0);assert.equal(await page.locator('#rows a[href^="javascript:"]').count(),0);assert.equal(await page.locator('#rows a[href="https://x.com/example"]').count(),1);
 await page.screenshot({path:root+'/desktop-test.png',fullPage:true});
 await page.locator('#lifetime').click();assert.match(await first.locator('td').nth(3).innerText(),/100 USDG/);
 assert.equal(await page.locator('#rows tr').count(),2);assert.equal(await page.locator('#rows img').count(),0);assert.equal(await page.locator('#rows a[href^="javascript:"]').count(),0);await page.locator('#sort').selectOption('age');assert.match(await first.innerText(),/No trades/);
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.screenshot({path:root+'/mobile-test.png',fullPage:true});
 await page.evaluate(d=>render({...d,complete:false,signal:true}),data);assert.equal(await page.locator('#status.hot').count(),0);assert.ok(await page.locator('#quality').innerText());
 await page.evaluate(d=>render({...d,stale:true,signal:true}),data);assert.equal(await page.locator('#status.hot').count(),0);
 await page.evaluate(d=>render({...d,board:[]}),data);assert.equal(await page.locator('#rows td[colspan="5"]').count(),1);
 await page.locator('#refresh').click();await page.waitForTimeout(50);assert.equal(refreshes,1);assert.equal(await page.locator('#refresh').isDisabled(),true);await page.evaluate(d=>render({...d,refreshing:true}),data);assert.match(await page.locator('#refresh').innerText(),/Собираем/);await page.evaluate(d=>render({...d,refreshing:false,market:{label:'Широкий ажиотаж',today:{buyers:85},seasonal:null,todaySamples:20,seasonalDays:0,seasonalSamples:0},breadth:{qualifiedTokens:4,leaderPct:25,buysPerWallet:2}}),data);assert.match(await page.locator('#market-description').innerText(),/85%/);assert.equal(await page.locator('#refresh').isDisabled(),false);assert.deepEqual(errors,[]);console.log('PASS: wallet counts, windows, sorting, links/XSS, empty/incomplete/stale, 1440/390/320px');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
