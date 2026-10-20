import {privateText} from '../server/monitor-alerts/private-file.mjs';
import {createPool} from '../server/shared/store.mjs';
import {createAlerts} from '../server/monitor-alerts/service.mjs';
import {monitorHttp} from '../server/monitor-alerts/http.mjs';
import {ingestMarket} from '../server/monitor-alerts/market.mjs';
import {deliver} from '../server/monitor-alerts/worker.mjs';
import {transports} from '../server/monitor-alerts/transports.mjs';
const c=JSON.parse(await privateText(process.argv[2]));
if(c.schema!=='pw-monitor-web-v1'||!Number.isInteger(c.port)||c.port<1024||c.port>65535)throw Error('Invalid web configuration');
const pool=createPool(await privateText(c.databaseFile));
const a=c.alertsFile?JSON.parse(await privateText(c.alertsFile)):{enabled:false};
if(typeof a.enabled!=='boolean')throw Error('Invalid alert configuration');
const options={pool,publicKey:a.vapid?.publicKey??null,botUsername:a.botUsername,pushEnabled:a.enabled&&!!a.vapid,telegramEnabled:a.enabled&&!!a.telegramTokenFile};
const alerts=Object.assign(createAlerts(options),{publicKey:options.publicKey,pushEnabled:options.pushEnabled,telegramEnabled:options.telegramEnabled});
const transport=a.enabled?transports({...a,telegramToken:a.telegramTokenFile?await privateText(a.telegramTokenFile):null,origin:c.origin}):null;
await pool.query("UPDATE monitor_alerts.outbox SET state='cancelled' WHERE state='pending' AND target NOT IN ('market','test')");
const server=monitorHttp({pool,alerts,origin:c.origin,telegramIngressSecret:a.telegramIngressSecret});
server.requestTimeout=45000;server.headersTimeout=10000;
await new Promise(r=>server.listen(c.port,'127.0.0.1',r));
let busy=false;const timer=a.enabled?setInterval(async()=>{if(busy)return;busy=true;try{
 await ingestMarket(pool,async()=>{const r=await fetch('http://127.0.0.1:4196/api/activity-events',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Feed unavailable');return r.json()});
 await deliver(pool,{...transport,access:async()=>true});
 await pool.query('DELETE FROM monitor_alerts.outbox WHERE created_at<$1',[Math.floor(Date.now()/1000)-28*86400]);
 await pool.query('DELETE FROM monitor_alerts.links WHERE expires<$1',[Math.floor(Date.now()/1000)]);
}catch{console.error('Notification processing unavailable; will retry')}finally{busy=false}},15000):null;
console.log('Free monitor gateway listening on loopback; notifications '+(a.enabled?'enabled':'disabled'));
async function stop(){clearInterval(timer);while(busy)await new Promise(r=>setTimeout(r,50));server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end()}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
