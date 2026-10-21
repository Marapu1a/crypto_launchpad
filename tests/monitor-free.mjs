import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTestPostgres} from './contracts/production-postgres.mjs';
import {createPool} from '../server/shared/store.mjs';
import {createAlerts} from '../server/monitor-alerts/service.mjs';
import {monitorHttp} from '../server/monitor-alerts/http.mjs';
import {ingestMarket,message} from '../server/monitor-alerts/market.mjs';
import {deliver} from '../server/monitor-alerts/worker.mjs';
const db=await createTestPostgres('.local/test-results/free-monitor-'+Date.now()),pool=createPool(db.url('postgres'));
let server;try{
 await pool.query(await readFile('server/monitor-alerts/schema.sql','utf8'));
 const now=Math.floor(Date.now()/1000),end=Math.floor(now/300)*300;
 const alerts=Object.assign(createAlerts({pool,pushEnabled:true,telegramEnabled:true,botUsername:'example_bot'}),{pushEnabled:true,telegramEnabled:true});
 const origin='http://127.0.0.1:4446';let upstream='';
 server=monitorHttp({pool,alerts,origin,secure:false,fetcher:async url=>{upstream=url;return {ok:true,json:async()=>({windowEnd:end,walletActivity:[],intervals:[]})}}});
 await new Promise(r=>server.listen(4446,'127.0.0.1',r));
 const get=path=>fetch(origin+path);
 assert.equal((await get('/api/active-wallets?minutes=30')).status,200);assert.match(upstream,/minutes=30/);
 assert.equal((await get('/api/wallet?address=0x'+'1'.repeat(40))).status,200);
 assert.equal((await get('/api/billing/quote')).status,404);
 assert.equal((await get('/api/interval?end=oops')).status,400);
 const post=(path,body={},cookie='',from=origin)=>fetch(origin+path,{method:'POST',headers:{origin:from,'content-type':'application/json',cookie},body:JSON.stringify(body)});
 assert.equal((await post('/api/alerts/session',{},'','https://evil.test')).status,403);
 const response=await post('/api/alerts/session');assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];assert.ok(cookie.startsWith('pw_notify='));
 const {rows:[session]}=await pool.query('SELECT owner FROM monitor_alerts.sessions');
 assert.equal((await post('/api/alerts/preferences',{push:true,telegram:false},cookie)).status,400);
 assert.equal((await post('/api/alerts/language',{language:'zh'},cookie)).status,200);
 assert.equal((await post('/api/alerts/language',{language:'xx'},cookie)).status,400);
 const link=await (await post('/api/alerts/telegram-link',{language:'en'},cookie)).json();
 const code=new URL(link.url).searchParams.get('start');
 const linked=await alerts.telegramUpdate({message:{chat:{id:55,type:'private'},from:{id:55,language_code:'ru'},text:'/start '+code}});assert.equal(linked.language,'en');assert.equal(linked.status,'linked');
 const changed=await alerts.telegramUpdate({callback_query:{from:{id:55},message:{chat:{id:55,type:'private'}},data:'lang:zh'}});assert.equal(changed.language,'zh');
 assert.equal((await alerts.telegramUpdate({message:{chat:{id:55,type:'private'},from:{id:55,language_code:'en'},text:'/projects'}})).language,'zh');
 assert.equal((await alerts.telegramUpdate({message:{chat:{id:99,type:'private'},from:{id:99},text:'/start '+code}})).status,'expired');
 await alerts.telegramUpdate({callback_query:{from:{id:99},message:{chat:{id:55,type:'private'}},data:'lang:en'}});
 assert.equal((await pool.query('SELECT language FROM monitor_alerts.chat_languages WHERE chat=$1',['55'])).rows[0].language,'zh');
 await pool.query(await readFile('server/monitor-alerts/schema.sql','utf8')); // upgrade is repeatable, preferences survive

 assert.equal((await post('/api/alerts/preferences',{push:false,telegram:true},cookie)).status,200);
 await pool.query('UPDATE monitor_alerts.rules SET created_at=$1',[end-600]);
 const event={windowEnd:end,current:{buyers:152,buys:268,tokens:19},baseline:{buyers:34,buys:54},snapshot:{board:[{symbol:'Example',recent:{buyers:93}}]}};
 assert.equal(message(event).url,'/?interval='+end);
 await ingestMarket(pool,async()=>({events:[event]}),{now});await ingestMarket(pool,async()=>({events:[event]}),{now});
 assert.equal((await pool.query('SELECT * FROM monitor_alerts.outbox')).rowCount,1);
 let sent=0;await deliver(pool,{now,access:async()=>true,sendTelegram:async(chat,payload)=>{sent++;assert.equal(payload.language,'zh');assert.match(payload.body,/买入/);},sendPush:async()=>{throw Error()}});assert.equal(sent,1);
 await deliver(pool,{now,access:async()=>true,sendTelegram:async()=>{sent++}});assert.equal(sent,1);
 // Turning the channel off cancels queued market notifications.
 await pool.query("INSERT INTO monitor_alerts.outbox(event_key,owner,target,channel,destination,payload,created_at) VALUES('cancel',$1,'market','telegram','55',$2,$3)",[session.owner,message(event),now]);
 assert.equal((await post('/api/alerts/preferences',{push:false,telegram:false},cookie)).status,200);
 assert.equal((await pool.query("SELECT state FROM monitor_alerts.outbox WHERE event_key='cancel'")).rows[0].state,'cancelled');
 await alerts.device(session.owner,{subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/language-test',keys:{p256dh:Buffer.alloc(65,1).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}}});
 await alerts.test(session.owner,{channel:'push'});
 const testPayload=(await pool.query("SELECT payload FROM monitor_alerts.outbox WHERE target='test' ORDER BY id DESC LIMIT 1")).rows[0].payload;
 assert.equal(testPayload.language,'zh');assert.equal(testPayload.body,'测试通知。已连接。');
 await alerts.setLanguage(session.owner,{language:'en'});
 assert.equal((await alerts.telegramUpdate({message:{chat:{id:55,type:'private'},from:{id:55,language_code:'en'},text:'/projects'}})).language,'zh');
 const stopped=await alerts.telegramUpdate({message:{chat:{id:55,type:'private'},from:{id:55},text:'/stop'}});assert.equal(stopped.language,'zh');assert.equal(stopped.status,'stopped');assert.equal((await alerts.state(session.owner)).telegramLinked,false);
 console.log('PASS free access, no billing routes, anonymous session, CSRF, preferences, market dedup, delivery and cancellation');
}finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}await pool.end();await db.close()}
