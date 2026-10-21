import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTestPostgres} from './contracts/production-postgres.mjs';
import {createPool} from '../server/shared/store.mjs';
import {createAlerts,validateSubscription} from '../server/monitor-alerts/service.mjs';
import {ingest,deliver} from '../server/monitor-alerts/worker.mjs';
import {billingHttp} from '../server/monitor-billing/http.mjs';
const db=await createTestPostgres('.local/test-results/alerts-'+Date.now()),pool=createPool(db.url('postgres'));
let server;try{
 await pool.query(await readFile('server/monitor-alerts/schema.sql','utf8'));
 let now=1800000000;const owner='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40),target='0x'+'3'.repeat(40),token='0x'+'4'.repeat(40);
 const alerts=createAlerts({pool,publicKey:'test',pushEnabled:true,telegramEnabled:true,botUsername:'example_bot',now:()=>now});
 const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:Buffer.alloc(65,1).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}};
 assert.throws(()=>validateSubscription({...subscription,endpoint:'http://127.0.0.1/private'}),/INVALID_PUSH/);
 assert.throws(()=>validateSubscription({...subscription,endpoint:'https://fcm.googleapis.com.attacker.test/test'}),/INVALID_PUSH/);
 const device=await alerts.device(owner,{subscription});await assert.rejects(alerts.device(other,{subscription}),/DEVICE_ALREADY_LINKED/);
 const link=await alerts.link(owner,{language:'ru'}),code=new URL(link.url).searchParams.get('start');
 await alerts.telegramUpdate({message:{chat:{id:5,type:'group'},from:{id:5},text:'/start '+code}});assert.equal((await alerts.state(owner)).telegramLinked,false);
 await alerts.telegramUpdate({message:{chat:{id:5,type:'private'},from:{id:5},text:'/start '+code}});assert.equal((await alerts.state(owner)).telegramLinked,true);
 await alerts.telegramUpdate({message:{chat:{id:6,type:'private'},from:{id:6},text:'/start '+code}});assert.equal((await pool.query('SELECT chat FROM monitor_alerts.chats')).rows[0].chat,'5');
 await alerts.rule(owner,{target,minimum:'100',newToken:true,push:true,telegram:true});
 const events=[];const feed=async after=>({cursor:events.length,events:after===null?[]:events.filter(e=>e.seq>after)});
 events.push({seq:1,side:'buy',trader:target,token,quoteAmount:1,quoteUsd:2000,timestamp:now-10});await ingest(pool,feed,{now});assert.equal((await pool.query('SELECT * FROM monitor_alerts.outbox')).rowCount,0);
 events.push({...events[0],seq:2,timestamp:now+1});now+=2;await ingest(pool,feed,{now});await ingest(pool,feed,{now});assert.equal((await pool.query('SELECT * FROM monitor_alerts.outbox')).rowCount,2);
 let push=0,tg=0;const senders={sendPush:async()=>{push++},sendTelegram:async()=>{tg++},access:async()=>true,now};
 await Promise.all([deliver(pool,senders),deliver(pool,senders)]);assert.equal(push,1);assert.equal(tg,1);
 events.push({...events[0],seq:3,timestamp:now});await ingest(pool,feed,{now});assert.equal((await pool.query('SELECT * FROM monitor_alerts.outbox')).rowCount,2); // cooldown
 now+=61;events.push({...events[0],seq:4,token:'0x'+'5'.repeat(40),quoteUsd:null,timestamp:now});await ingest(pool,feed,{now});const jobs=await pool.query("SELECT * FROM monitor_alerts.outbox WHERE state='pending'");assert.equal(jobs.rowCount,2);assert.ok(!jobs.rows[0].payload.body.includes('$0'));
 await deliver(pool,{...senders,now,sendPush:async()=>{throw Object.assign(Error('expired'),{statusCode:410})}});assert.equal((await alerts.state(owner)).devices.length,0);
 await alerts.test(owner,{channel:'telegram'});assert.equal((await pool.query("SELECT payload FROM monitor_alerts.outbox WHERE target='test' ORDER BY id DESC LIMIT 1")).rows[0].payload.body,'Тестовое уведомление. Канал подключён.');await assert.rejects(alerts.test(owner,{channel:'telegram'}),/TEST_COOLDOWN/);await alerts.unlink(owner);await deliver(pool,{...senders,now});assert.equal((await pool.query("SELECT * FROM monitor_alerts.outbox WHERE target='test' AND state='cancelled'")).rowCount,1);
 // Existing auth/CSRF protects all rule and device mutations.
 const billing={enabled:false,session:async token=>token==='a'.repeat(64)?owner:null,access:async()=>({active:true})};
 server=billingHttp({billing,alerts,origin:'http://127.0.0.1:4445',secure:false,telegramIngressSecret:'test-secret'});await new Promise(r=>server.listen(4445,'127.0.0.1',r));
 assert.equal((await fetch('http://127.0.0.1:4445/api/alerts')).status,401);
 assert.equal((await fetch('http://127.0.0.1:4445/api/alerts/rule',{method:'POST',headers:{cookie:'pw_session='+'a'.repeat(64),origin:'https://evil.test','content-type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch('http://127.0.0.1:4445/api/alerts/telegram-update',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch('http://127.0.0.1:4445/api/alerts/telegram-update',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'test-secret'},body:'{}'})).status,200);
 await alerts.rule(owner,{target,remove:true});assert.equal((await alerts.state(owner)).rules.length,0);
 console.log('PASS alerts: durable cursor/outbox, dedup/concurrency, cooldown, unknown USD, expiry, unsubscribe, one-use Telegram links, device isolation, auth and CSRF. No external sends.');
}finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}await pool.end();await db.close()}
