import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const assets=new Set(['ui.js','ui.css','wallet-ui.js','access.js']);
const server=createServer(async(req,res)=>{const file=req.url==='/wallets'?'wallets.html':req.url?.slice(1);if(!assets.has(file)&&file!=='wallets.html'&&!/^imgs\/pw_(eye|mascot)\.png$/.test(file)){res.writeHead(404);return res.end()}res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html; charset=utf-8');res.end(await readFile('apps/monitor/'+file))});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let authenticated=false,active=false,quotes=0,privateReads=0;const wallet='0x'+'1'.repeat(40),id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',hash='0x'+'2'.repeat(64);
 const invoice={id,plan:'day',amountWei:'400000000000000',amountETH:'0.0004',rateUsd:'2500',recipient:'0x'+'3'.repeat(40),chainId:4663,data:'0x1234',createdAt:Date.now()/1000,expiresAt:Date.now()/1000+600,state:'quoted'};
 await page.addInitScript(w=>{window.ethereum={request:async({method})=>method==='eth_requestAccounts'||method==='eth_accounts'?[w]:method==='eth_sendTransaction'?'0x'+'2'.repeat(64):method==='personal_sign'?'0xsignature':null,on(){}}},wallet);
 await page.route('**/api/**',async r=>{const path=new URL(r.request().url()).pathname;let data={};
  if(path==='/api/access')data={active,wallet:authenticated?wallet:null,paymentsEnabled:true,expiresAt:Date.now()/1000+86400};
  else if(path==='/api/auth/challenge')data={id:'nonce',message:'Test-only login'};
  else if(path==='/api/auth/verify'){authenticated=true;data={wallet}}
  else if(path==='/api/billing/quote'){quotes++;data=invoice}
  else if(path==='/api/billing/confirm'){active=true;data={...invoice,state:'paid',txHash:hash}}
  else if(path==='/api/billing/invoices')data={invoices:[]};
  else if(path==='/api/active-wallets'){privateReads++;data={walletActivity:[]}}
  else if(path==='/api/auth/logout'){active=false;authenticated=false}
  await r.fulfill({json:data});
 });
 await page.goto('http://127.0.0.1:'+server.address().port+'/wallets');await page.locator('#subscription button').first().waitFor();
 assert.equal(await page.locator('#wallet-workspace').isVisible(),false);assert.equal(privateReads,0);
 for(const lang of ['en','zh','ru']){await page.locator('#language').selectOption(lang);for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)}}
 await page.locator('#language').selectOption('en');await page.locator('.billing-plan button').first().click();await page.locator('.billing-invoice').waitFor();assert.equal(quotes,1);assert.match(await page.locator('.billing-invoice').innerText(),/0.0004 ETH/);
 await page.getByRole('button',{name:'Confirm in wallet',exact:true}).click();await page.waitForFunction(()=>!document.getElementById('wallet-workspace').hidden);assert.ok(privateReads>0);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForFunction(()=>document.getElementById('wallet-workspace').hidden);
 assert.deepEqual(errors,[]);await page.locator('#language').selectOption('ru');await page.screenshot({path:'.local/billing-mobile.png',fullPage:true});
 console.log('PASS billing UI: gated wallet page, signed login flow, fixed quote/send/confirm, logout, EN/zh/RU 1440/390/320');
}finally{await browser.close();await new Promise(r=>server.close(r))}
