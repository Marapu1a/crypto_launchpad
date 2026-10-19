import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const root='.local/monitor-v2';await mkdir(root,{recursive:true});
const html=await readFile('apps/monitor/index.html');
const server=createServer(async(req,res)=>{if(['/imgs/pw_eye.png','/imgs/pw_mascot.png'].includes(req.url)){res.setHeader('Content-Type','image/png');res.end(await readFile('apps/monitor'+req.url));return;}if(/^\/(ui\.css|ui\.js|tokens\.js|wallet-ui\.js)$/.test(req.url)){res.setHeader("Content-Type",req.url.endsWith(".css")?"text/css":"text/javascript");res.end(await readFile("apps/monitor"+req.url));return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch();
const metric={buys:250,buyers:2,volume:'50',median:'0.2',maximum:'0.2',maximumTx:'0x'+'a'.repeat(64),top3Pct:100,missingAmounts:0};
const data={schema:'pons-monitor-v2',updated:Date.now()/1000,windowEnd:Date.now()/1000-60,complete:true,signal:false,stale:false,scanSeconds:1,observedTokens:2,current:{buys:250,buyers:2,tokens:1,launches:2},baseline:{buys:2,buyers:1,tokens:1,launches:1},chart:[{buyers:1},{buyers:2}],volumes:[{symbol:'USDG',volume:'50',missingAmounts:0}],board:[{address:'0x'+'1'.repeat(40),symbol:'TINY',name:'Many small buys',quote:'USDG',ageSeconds:1500,twitter:'https://x.com/example',recent:metric,lifetime:{...metric,volume:'100',buys:500}},{address:'0x'+'2'.repeat(40),symbol:'<img src=x onerror=alert(1)>',name:'No trades',quote:'ETH',ageSeconds:180,twitter:'javascript:alert(1)',recent:{...metric,buys:0,buyers:0,volume:'0',maximum:null,median:null,maximumTx:null,top3Pct:null},lifetime:metric}]};
try{
 const page=await browser.newPage({locale:'en-US',viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let reads=0;await page.route('**/api/status',r=>{reads++;return r.fulfill({json:data});});let refreshes=0;await page.route('**/api/refresh',r=>{refreshes++;return r.fulfill({status:202,json:{}});});
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('#rows tr');
 const first=page.locator('#rows tr').first();assert.equal(await first.locator('td').nth(1).locator('strong').innerText(),'2');assert.equal(await first.locator('td').nth(2).locator('strong').innerText(),'250');
 assert.equal(await page.locator('#rows tr').count(),1);assert.equal(await page.evaluate(()=>amount('1.234567')), '1.23');assert.equal(await page.evaluate(()=>amount('0.000031')), '0.000031');assert.equal(await page.evaluate(()=>amount('0')), '0');assert.match(await page.locator('#heat-detail').innerText(),/More history needed/);assert.equal(await page.locator('#rows img').count(),0);assert.equal(await page.locator('#rows a[href^="javascript:"]').count(),0);assert.equal(await page.locator('#rows a[href="https://x.com/example"]').count(),1);
 await page.screenshot({path:root+'/desktop-test.png',fullPage:true});
 await page.locator('#lifetime').click();assert.match(await first.locator('td').nth(3).innerText(),/100 USDG/);
 assert.equal(await page.locator('#rows tr').count(),2);assert.equal(await page.locator('#rows img').count(),0);assert.equal(await page.locator('#rows a[href^="javascript:"]').count(),0);await page.locator('#sort').selectOption('age');assert.match(await first.innerText(),/No trades/);
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.screenshot({path:root+'/mobile-test.png',fullPage:true});
 await page.evaluate(d=>render({...d,complete:false,signal:true}),data);assert.equal(await page.locator('#status.hot').count(),0);assert.ok(await page.locator('#quality').innerText());
 await page.evaluate(d=>render({...d,stale:true,signal:true}),data);assert.equal(await page.locator('#status.hot').count(),0);
 await page.evaluate(d=>render({...d,board:[]}),data);assert.equal(await page.locator('#rows td[colspan="5"]').count(),1);
 const before=reads;await page.locator('#refresh').click();await page.waitForFunction(()=>!document.getElementById('refresh').disabled);assert.equal(reads,before+1);assert.equal(refreshes,0);assert.equal(await page.locator('#sort').inputValue(),'age');assert.equal(await page.locator('#lifetime').getAttribute('aria-pressed'),'true');
 await page.evaluate(d=>render({...d,refreshing:false,market:{today:{buyers:85},seasonal:null,todaySamples:20,seasonalDays:0,seasonalSamples:0},breadth:{qualifiedTokens:4,leaderPct:25,buysPerWallet:2},collection:{fromEnd:d.windowEnd-3600,toEnd:d.windowEnd,expected:13,complete:10,incomplete:1,missing:2,completePct:76.92,gaps:[{fromEnd:d.windowEnd-600,to:d.windowEnd-300,intervals:2}],recentAttempts:[{started:d.updated,status:'interrupted'}]}}),data);
 await page.locator('#method > summary').click();
 assert.match(await page.locator('#market-description').innerText(),/85%/);assert.match(await page.locator('#coverage-text').innerText(),/10\/13 full windows/);assert.match(await page.locator('#coverage-text').innerText(),/2 missing/);
 await page.locator('#coverage summary').click();assert.match(await page.locator('#attempts').innerText(),/Interrupted/);
 await page.evaluate(d=>render({...d,complete:false,market:{today:{buyers:99},seasonal:null,todaySamples:20,seasonalDays:0,seasonalSamples:0}}),data);assert.doesNotMatch(await page.locator('#market-description').innerText(),/99%/);
 const older={...data,windowEnd:data.windowEnd-300,current:{buyers:1,buys:10,tokens:1,launches:0},board:[{...data.board[0],recent:{...metric,buyers:1,buys:10,volume:'2'}}]};
 await page.evaluate(({data,older})=>render({...data,intervals:[older,data]}),{data,older});
 await page.locator('#heat-metric').selectOption('buys');assert.equal(await page.locator('#chart-title').innerText(),'Buys');
 await page.locator('#chart .trend-bar[data-metric-key=buys]').first().click();assert.match(await page.locator('#selected-time').innerText(),/Earlier window/);
 assert.equal(await page.locator('.summary-stat strong').innerText(),'10');
 await page.locator('#recent').click();assert.equal(await page.locator('#rows tr').first().locator('td').nth(2).locator('strong').innerText(),'10');
 await page.locator('#latest').click();assert.equal(await page.locator('.summary-stat strong').innerText(),'250');
 await page.evaluate(d=>render({...d,intervals:[],current:{...d.current,launches:1}}),data);
 await page.locator('#heat-metric').selectOption('launches');assert.equal(await page.locator('#rows tr').count(),1);assert.match(await page.locator('#rows').innerText(),/No trades/);
 assert.equal(await page.evaluate(()=>amount('0.005')),'0.005');assert.equal(await page.evaluate(()=>amount('0.0001')),'0.0001');assert.equal(await page.evaluate(()=>amount('9007199254740993.001')),'9,007,199,254,740,993');
 // Context uses six preceding consecutive complete windows, never the selected value.
 const timeline=Array.from({length:7},(_,i)=>({...data,windowEnd:data.windowEnd-(6-i)*300,current:{buyers:i===6?54:10,buys:20,tokens:2,launches:1}}));
 await page.evaluate(({data,timeline})=>{selectedEnd=null;render({...data,current:timeline[6].current,intervals:timeline});},{data,timeline});
 await page.locator('#heat-metric').selectOption('buyers');assert.match(await page.locator('#heat-detail').innerText(),/Earlier: 10 on average/);
 assert.match(await page.evaluate(()=>comparisonLabel(54,10)),/440% more/);
 assert.equal(await page.locator('.trend-bar').count(),28);
 assert.equal(await page.locator('.mean-line').count(),4);
 assert.equal(await page.locator('.trend-bar[data-selected=true]').count(),4);
 assert.equal(await page.locator('.trend-bar[data-metric-key=buyers]').last().getAttribute('class'),'trend-bar up');
 assert.equal(await page.locator('.trend-bar[data-metric-key=buyers]').first().getAttribute('class'),'trend-bar unknown');
 assert.equal(await page.locator('.trend-bar[data-metric-key=buyers]').nth(1).getAttribute('class'),'trend-bar flat');
 await page.locator('#heat-metric').selectOption('buyers');await page.locator('.trend-bar[data-metric-key="buyers"]').last().focus();
 assert.match(await page.locator('#heat-detail').innerText(),/54/);
 await page.evaluate(({data,timeline})=>render({...data,current:timeline[6].current,intervals:timeline.map((x,i)=>i===2?{...x,complete:false}:x)}),{data,timeline});
 assert.match(await page.locator('#heat-detail').innerText(),/More history needed/);
 assert.equal(await page.locator('.trend-gap').count(),4);
 assert.equal(await page.locator('.mean-line').count(),0);
 assert.equal(await page.locator('.trend-bar[data-metric-key=buyers]').nth(3).getAttribute('class'),'trend-bar unknown');
 await page.evaluate(({data,timeline})=>render({...data,current:timeline[6].current,intervals:timeline.map((x,i)=>i<6?{...x,current:{...x.current,buyers:0}}:x)}),{data,timeline});
 assert.match(await page.locator('#heat-detail').innerText(),/Earlier: 0 on average/);
 assert.doesNotMatch(await page.locator('#heat-detail').innerText(),/Infinity|NaN/);
 await page.evaluate(({data,timeline})=>render({...data,current:timeline[6].current,intervals:timeline.filter((x,i)=>i!==2)}),{data,timeline});
 assert.match(await page.locator('#heat-detail').innerText(),/More history needed/);
 await page.evaluate(()=>render({loading:true}));assert.equal(await page.locator('#chart .trend-bar').count(),0);assert.match(await page.locator('#data-note').innerText(),/Getting the saved snapshot/);
 // Freshness, missing data and zero buys must not tell the same story.
 await page.evaluate(d=>render({...d,preview:true,stale:true}),data);assert.match(await page.locator('#data-note').innerText(),/not current trading/);
 await page.evaluate(d=>render({...d,stale:true}),data);assert.match(await page.locator('#data-note').innerText(),/don’t yet know/);
 await page.evaluate(d=>render({...d,complete:false,board:[]}),data);assert.match(await page.locator('#data-note').innerText(),/may be lower/);assert.match(await page.locator('#rows').innerText(),/Missing data/);
 await page.evaluate(d=>render({...d,error:'failed'}),data);assert.match(await page.locator('#data-note').innerText(),/couldn’t get a newer snapshot/);
 await page.evaluate(d=>{metric='buys';mode='recent';render({...d,board:[],current:{buyers:0,buys:0,tokens:0,launches:0}});},data);assert.match(await page.locator('#data-note').innerText(),/No buys were recorded/);assert.match(await page.locator('#rows').innerText(),/No buys were recorded/);
 await page.evaluate(({data,timeline})=>render({...data,current:timeline[6].current,intervals:timeline}),{data,timeline});
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await page.locator('#heat-metric').selectOption('buys');
  assert.equal(await page.locator('.trend-bar:visible').count(),7);
  assert.equal(await page.locator('.trend-bar[data-metric-key=buyers]:visible').count(),0);
  assert.ok(await page.locator('.heat-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.locator('.trend-bar[data-metric-key=buys]').first().click();assert.match(await page.locator('#selected-time').innerText(),/Earlier window/);
  await page.locator('#latest').click();
 }
 assert.equal(await page.locator('.selection-link').getAttribute('href'),'#token-section');
 assert.equal(await page.locator('.wallet-bridge a').getAttribute('href'),'/wallets');
 assert.equal(await page.locator('#refresh').isDisabled(),false);const langReads=reads;await page.locator('#language').selectOption('zh');assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');assert.equal(await page.locator('#sort').inputValue(),'age');assert.equal(reads,langReads);for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:root+'/zh-'+width+'.png',fullPage:true})}await page.locator('#language').selectOption('en');await page.locator('#language').selectOption('ru');assert.equal(await page.locator('html').getAttribute('lang'),'ru-RU');for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)}assert.deepEqual(errors,[]);console.log('PASS: cached refresh, preserved filters, coverage, neutral comparisons, wallet counts, links/XSS, partial/stale, 1440/390/320px');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
