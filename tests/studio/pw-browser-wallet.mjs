import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {pwOwnerFixture} from './pw-owner-fixture.mjs';
const fixture=await pwOwnerFixture({browserWallet:true});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();
 await page.addInitScript(()=>{
  window.walletCalls=[];
  window.ethereum={request:async({method,params})=>{
   window.walletCalls.push({method,params});
   if(method==='eth_chainId')return '0x1237';
   if(method==='eth_getTransactionCount')return '0x0';
   if(method==='eth_accounts'||method==='eth_requestAccounts')return ['0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A'];
   if(method==='eth_sendTransaction')throw Object.assign(Error('Rejected'),{code:4001});
   throw Error(method);
  }};
 });
 await page.goto(fixture.url);await page.locator('[data-action=prepare]').click();await page.locator('[data-action=quote]').click();
 await page.locator('#confirm').check();await page.locator('#sign').click();
 await page.getByText('Запрос отклонён в кошельке.',{exact:false}).waitFor();
 assert.equal((await page.evaluate(()=>window.walletCalls.filter(c=>c.method==='eth_sendTransaction'))).length,1);
 await page.reload();await page.locator('#wallet-hash').waitFor();
 assert.equal(await page.evaluate(()=>window.walletCalls.length),0,'reload must not prompt wallet');
 await page.locator('#wallet-hash').fill('0x'+'a'.repeat(64));await page.locator('[data-action=wallet-attach]').click();
 await page.locator('[data-action=quote]').waitFor();assert.equal(fixture.counts().signatures,0);
 assert.equal(await page.evaluate(()=>window.walletCalls.length),0,'recovery must not sign');
 console.log('PASS browser reservation, rejection, reload and manual hash recovery');
}finally{await browser.close();await fixture.close();}
