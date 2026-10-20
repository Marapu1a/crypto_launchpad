// Retired subscription/wallet-alert prototype. Not part of the free monitor deployment.
import {readFile} from 'node:fs/promises';
import {createPool} from '../server/shared/store.mjs';
import {privateText} from '../server/short-runtime/config.mjs';
import {operatorRpc} from '../server/shared/rpc-policy.mjs';
import {createBilling} from '../server/monitor-billing/core.mjs';
import {createAlerts} from '../server/monitor-alerts/service.mjs';
import {ingest,deliver} from '../server/monitor-alerts/worker.mjs';
import {transports} from '../server/monitor-alerts/transports.mjs';
import {billingHttp} from '../server/monitor-billing/http.mjs';

const c=JSON.parse(await privateText(process.argv[2]));
if(c.schema!=='pw-monitor-billing-v1'||typeof c.paymentsEnabled!=='boolean'||!Number.isInteger(c.port)||c.port<1024||c.port>65535)throw Error('Invalid billing configuration');
const pool=createPool(await privateText(c.databaseFile));
const {provider}=await operatorRpc(await privateText(c.rpcFile),c);
let rateCache=null,ratePending=null;
async function price(){
 if(rateCache&&Date.now()-rateCache.at<30000)return rateCache.value;
 if(ratePending)return ratePending;
 ratePending=(async()=>{const r=await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot',{signal:AbortSignal.timeout(8000),redirect:'error'});if(!r.ok)throw Error('Price unavailable');const d=await r.json();if(d?.data?.base!=='ETH'||d.data.currency!=='USD')throw Error('Invalid price');rateCache={value:d.data.amount,at:Date.now()};return rateCache.value})();
 try{return await ratePending}finally{ratePending=null}
}
const billing=createBilling({pool,provider,price,origin:c.origin,recipient:c.recipient,enabled:c.paymentsEnabled});
const a=c.alertsFile?JSON.parse(await privateText(c.alertsFile)):null;
if(a&&(typeof a.enabled!=='boolean'||!/^\w{5,32}$/.test(a.botUsername??'')||(a.telegramTokenFile&&typeof a.telegramTokenFile!=='string')||(a.telegramIngressSecret&&a.telegramIngressSecret.length<32)))throw Error('Invalid alerts configuration');
const alerts=a?createAlerts({pool,publicKey:a.vapid?.publicKey,botUsername:a.botUsername,pushEnabled:a.enabled&&!!a.vapid,telegramEnabled:a.enabled&&!!a.telegramTokenFile}):null;
const telegramToken=a?.telegramTokenFile?await privateText(a.telegramTokenFile):null;
const transport=a?transports({...a,telegramToken,origin:c.origin}):null;
const server=billingHttp({billing,origin:c.origin,owner:c.operatorWallet,secure:true,alerts,telegramIngressSecret:a?.telegramIngressSecret});
let alertsBusy=false;
const alertsTimer=a?.enabled?setInterval(async()=>{if(alertsBusy)return;alertsBusy=true;try{
 if(a.walletSignalsEnabled===true)await ingest(pool,async after=>{const r=await fetch('http://127.0.0.1:4196/api/observed-trades'+(after===null?'':'?after='+after),{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Feed unavailable');return r.json()});
 await deliver(pool,{...transport,access:async w=>w===c.operatorWallet?.toLowerCase()||(await billing.access(w)).active});
 await pool.query('DELETE FROM monitor_alerts.outbox WHERE created_at<$1',[Math.floor(Date.now()/1000)-28*86400]);
 await pool.query('DELETE FROM monitor_alerts.links WHERE expires<$1',[Math.floor(Date.now()/1000)]);
}catch{console.error('Alert worker unavailable; will retry')}finally{alertsBusy=false}},15000):null;
server.requestTimeout=45000;server.headersTimeout=10000;
await new Promise(r=>server.listen(c.port,'127.0.0.1',r));
console.log('Monitor billing listening on loopback; payments '+(c.paymentsEnabled?'enabled':'disabled'));
let running=false;
const timer=setInterval(async()=>{if(running)return;running=true;try{
 const at=Math.floor(Date.now()/1000);
 const {rows}=await pool.query("SELECT id,wallet,tx_hash FROM monitor_billing.invoices WHERE state='pending' AND created_at>$1 AND last_check_at<$2 ORDER BY last_check_at LIMIT 5",[at-86400,at-300]);
 for(const r of rows){await pool.query('UPDATE monitor_billing.invoices SET last_check_at=$2 WHERE id=$1',[r.id,at]);try{await billing.confirm(r.wallet,r.id,r.tx_hash)}catch{/* bounded retries, no sensitive errors */}}
}catch{console.error('Pending-payment reconciliation unavailable; will retry')}finally{running=false}},60000);
async function stop(){clearInterval(timer);clearInterval(alertsTimer);while(alertsBusy)await new Promise(r=>setTimeout(r,50));server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();provider.destroy()}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
