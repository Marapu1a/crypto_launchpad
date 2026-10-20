import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Wallet} from 'ethers';
import {createPool} from '../server/shared/store.mjs';
import {createTestPostgres} from './contracts/production-postgres.mjs';
import {createBilling,quoteWei,paymentData} from '../server/monitor-billing/core.mjs';
import {billingHttp} from '../server/monitor-billing/http.mjs';

const db=await createTestPostgres('.local/test-results/billing-'+Date.now());let server;const pool=createPool(db.url('postgres'));
try{
 await db.admin.query(await readFile('server/monitor-billing/schema.sql','utf8'));
 const owner=Wallet.createRandom(),other=Wallet.createRandom(),recipient=Wallet.createRandom().address;
 const txs=new Map(),receipts=new Map(),blocks=new Map();let now=1800000000,priceReads=0,chain=4663n,finalized=100;
 const provider={getNetwork:async()=>({chainId:chain}),getTransaction:async h=>txs.get(h),getTransactionReceipt:async h=>receipts.get(h),getBlock:async n=>n==='finalized'?{number:finalized}:blocks.get(n)};
 const options={pool,provider,price:async()=>{priceReads++;return '2500.12345678'},origin:'http://127.0.0.1:4444',recipient,enabled:true,now:()=>now};
 let billing=createBilling(options);const w=owner.address.toLowerCase();
 assert.equal(quoteWei(100,'2500'),'400000000000000');assert.ok(BigInt(quoteWei(100,'2500.12345678'))>0n);
 const challenge=await billing.challenge(w);
 await assert.rejects(billing.login(challenge.id,await other.signMessage(challenge.message)),/INVALID_SIGNATURE/);
 const session=await billing.login(challenge.id,await owner.signMessage(challenge.message));assert.equal(await billing.session(session.token),w);
 await assert.rejects(billing.login(challenge.id,await owner.signMessage(challenge.message)),/CHALLENGE_EXPIRED/);
 const quotes=await Promise.all([billing.quote(w,'day'),billing.quote(w,'day')]);assert.equal(quotes[0].id,quotes[1].id);assert.equal(priceReads,1);assert.equal(quotes[0].expiresAt,now+600);
 const invoice=quotes[0],hash='0x'+'1'.repeat(64),blockHash='0x'+'a'.repeat(64);
 txs.set(hash,{chainId:4663n,from:w,to:recipient,data:paymentData(invoice.id),value:BigInt(invoice.amountWei),blockHash});receipts.set(hash,{status:1,blockNumber:100,blockHash});blocks.set(100,{hash:blockHash,timestamp:now+10});
 chain=1n;await assert.rejects(billing.confirm(w,invoice.id,hash),/WRONG_RPC_CHAIN/);chain=4663n;
 txs.get(hash).from=other.address;await assert.rejects(billing.confirm(w,invoice.id,hash),/PAYMENT_MISMATCH/);txs.get(hash).from=w;
 finalized=99;assert.equal((await billing.confirm(w,invoice.id,hash)).check,'pending');assert.equal((await billing.access(w)).active,false);finalized=100;
 billing=createBilling(options); // Restart: pending invoice is durable.
 const paid=await Promise.all([billing.confirm(w,invoice.id,hash),billing.confirm(w,invoice.id,hash)]);assert.equal(paid[0].accessUntil,now+86400);assert.equal(paid[1].accessUntil,paid[0].accessUntil);
 const duplicate='0x'+'5'.repeat(64);txs.set(duplicate,{...txs.get(hash)});receipts.set(duplicate,receipts.get(hash));assert.equal((await billing.confirm(w,invoice.id,duplicate)).reason,'DUPLICATE_PAYMENT');assert.equal((await billing.access(w)).expiresAt,now+86400);assert.equal((await db.admin.query('SELECT count(*) FROM monitor_billing.payment_attempts WHERE tx_hash=$1',[duplicate])).rows[0].count,'1');
 const weekly=await billing.quote(w,'week'),hash2='0x'+'2'.repeat(64);txs.set(hash2,{...txs.get(hash),data:paymentData(weekly.id),value:BigInt(weekly.amountWei)});receipts.set(hash2,receipts.get(hash));
 assert.equal((await billing.confirm(w,weekly.id,hash2)).accessUntil,now+86400+604800);
 const late=await billing.quote(w,'month'),hash3='0x'+'3'.repeat(64);txs.set(hash3,{...txs.get(hash),data:paymentData(late.id),value:BigInt(late.amountWei)});receipts.set(hash3,receipts.get(hash));blocks.get(100).timestamp=late.expiresAt+1;
 assert.equal((await billing.confirm(w,late.id,hash3)).reason,'LATE_PAYMENT');assert.equal((await billing.access(w)).expiresAt,now+86400+604800);
 await assert.rejects(billing.confirm(other.address.toLowerCase(),late.id,hash3),/INVOICE_NOT_FOUND/);
 const under=await billing.quote(other.address.toLowerCase(),'day'),hash4='0x'+'4'.repeat(64);blocks.get(100).timestamp=now+20;txs.set(hash4,{...txs.get(hash),from:other.address,data:paymentData(under.id),value:1n});receipts.set(hash4,receipts.get(hash));assert.equal((await billing.confirm(other.address.toLowerCase(),under.id,hash4)).reason,'AMOUNT_MISMATCH');assert.equal((await billing.access(other.address.toLowerCase())).active,false);
 await assert.rejects(createBilling({...options,enabled:false}).quote(w,'day'),/PAYMENTS_NOT_OPEN/);
 server=billingHttp({billing,origin:options.origin,secure:false,fetcher:async()=>({ok:true,json:async()=>({walletActivity:[{address:w}],current:{buys:2}})})});await new Promise(r=>server.listen(4444,'127.0.0.1',r));
 assert.equal((await fetch(options.origin+'/api/wallet?address='+w)).status,401);
 const status=await (await fetch(options.origin+'/api/status')).json();assert.equal(status.walletActivity,undefined);
 assert.equal((await fetch(options.origin+'/api/active-wallets',{headers:{cookie:'pw_session='+session.token}})).status,200);
 assert.equal((await fetch(options.origin+'/api/billing/quote',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example',cookie:'pw_session='+session.token},body:JSON.stringify({plan:'day'})})).status,403);
 const expired=await billing.challenge(other.address);now+=301;await assert.rejects(billing.login(expired.id,await other.signMessage(expired.message)),/CHALLENGE_EXPIRED/);now-=301;
 await billing.logout(session.token);assert.equal(await billing.session(session.token),null);
 console.log('PASS billing: signed identity, one-use nonce, durable quotes, replay/restart, chain/sender, finality, renewals, late/underpaid review, server paywall and CSRF');
}finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}await pool.end();await db.close()}
