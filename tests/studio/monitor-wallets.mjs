import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const html=await readFile('apps/monitor/wallets.html');const address='0x'+'1'.repeat(40),token='0x'+'2'.repeat(40);
const fixture={address,firstObservedAt:1792220000,historyUpdatedAt:1792220000,positionsUpdatedAt:1792220000,earliestAvailableAt:1792210000,errors:{},stats:{buys:1,sells:1,tokens:1,operations:3},positions:[{token,symbol:'TEST',amountTokens:25,valueUsd:2}],events:['buy','sell','receive'].map((kind,i)=>({kind,token,symbol:'<img src=x onerror=alert(1)>',timestamp:1792210000+i,amountTokens:3,valueUsd:1,txHash:'0x'+String(i+3).repeat(64)}))};
let reads=0;
const server=createServer((req,res)=>{if(req.url.startsWith('/api/wallet')){reads++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture))}else if(req.url==='/api/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({windowEnd:1792220000,walletActivity:[{address,buys:3,tokens:2}]}))}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
try{const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:'+server.address().port+'/wallets');assert.equal(reads,0);
await page.locator('#address').fill(address);await page.locator('#load').click();await page.waitForSelector('#events tr');assert.equal(reads,1);assert.equal(await page.locator('#events tr').count(),3);assert.equal(await page.locator('#events img').count(),0);
await page.locator('#kind').selectOption('sell');assert.equal(await page.locator('#events tr').count(),1);assert.match(await page.locator('#events').innerText(),/Продажа/);
await page.locator('#favorite').click();assert.equal(await page.locator('#saved button').count(),1);assert.equal(reads,1);
await page.locator('#kind').selectOption('all');await mkdir('.local/monitor-wallets',{recursive:true});await page.screenshot({path:'.local/monitor-wallets/desktop.png',fullPage:true});
for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)}await page.screenshot({path:'.local/monitor-wallets/mobile.png',fullPage:true});
assert.deepEqual(errors,[]);console.log('PASS wallet UI: manual load, filters, favorites, XSS, desktop/mobile');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
