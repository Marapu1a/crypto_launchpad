import {randomBytes,createHash} from 'node:crypto';
import {fail,wallet} from '../monitor-billing/core.mjs';
const digest=s=>createHash('sha256').update(s).digest('hex');
export function validateSubscription(s){
 let u;try{u=new URL(s?.endpoint)}catch{fail('INVALID_PUSH')}
 const hosts=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'];
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||(!hosts.includes(u.hostname)&&!(/^[a-z0-9-]+\.notify\.windows\.com$/).test(u.hostname))||s.endpoint.length>2048)fail('INVALID_PUSH');
 for(const [key,size] of [['p256dh',65],['auth',16]])if(typeof s.keys?.[key]!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(s.keys[key])||Buffer.from(s.keys[key],'base64url').length!==size)fail('INVALID_PUSH');
 return {endpoint:s.endpoint,keys:{p256dh:s.keys.p256dh,auth:s.keys.auth}};
}
export function createAlerts({pool,publicKey=null,botUsername=null,pushEnabled=false,telegramEnabled=false,now=()=>Math.floor(Date.now()/1000)}){
 const api={
  async state(owner){const {rows:rules}=await pool.query('SELECT target,minimum,new_token AS "newToken",push,telegram FROM monitor_alerts.rules WHERE owner=$1 ORDER BY target',[owner]);const {rows:devices}=await pool.query('SELECT id FROM monitor_alerts.devices WHERE owner=$1',[owner]);const {rowCount}=await pool.query('SELECT owner FROM monitor_alerts.chats WHERE owner=$1',[owner]);return {rules,devices,telegramLinked:!!rowCount,publicKey,pushEnabled,telegramEnabled}},
  async rule(owner,b){const target=wallet(b.target);if(b.remove===true){await pool.query('DELETE FROM monitor_alerts.rules WHERE owner=$1 AND target=$2',[owner,target]);await pool.query('DELETE FROM monitor_alerts.seen WHERE owner=$1 AND target=$2',[owner,target]);await pool.query("UPDATE monitor_alerts.outbox SET state='cancelled' WHERE owner=$1 AND target=$2 AND state='pending'",[owner,target]);return {ok:true}}
   if(!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(b.minimum))||!['push','telegram','newToken'].every(k=>typeof b[k]==='boolean')||!(b.push||b.telegram))fail('INVALID_RULE');
   if((b.push&&!pushEnabled)||(b.telegram&&!telegramEnabled))fail('CHANNEL_NOT_CONFIGURED',503);
   const state=await api.state(owner);if(b.push&&!state.devices.length||b.telegram&&!state.telegramLinked)fail('CHANNEL_NOT_CONNECTED');
   const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['alerts:'+owner]);const {rows:[r]}=await c.query('SELECT count(*)::int AS n FROM monitor_alerts.rules WHERE owner=$1',[owner]);const {rowCount}=await c.query('SELECT 1 FROM monitor_alerts.rules WHERE owner=$1 AND target=$2',[owner,target]);if(r.n>=50&&!rowCount)fail('RULE_LIMIT');
    await c.query('INSERT INTO monitor_alerts.rules VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner,target) DO UPDATE SET minimum=$3,new_token=$4,push=$5,telegram=$6',[owner,target,b.minimum,b.newToken,b.push,b.telegram,now()]);await c.query('COMMIT');return {ok:true};
   }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  },
  async device(owner,b){if(b.remove){await pool.query('DELETE FROM monitor_alerts.devices WHERE owner=$1 AND id=$2',[owner,String(b.id)]);await pool.query("UPDATE monitor_alerts.outbox SET state='cancelled' WHERE owner=$1 AND channel='push' AND destination=$2 AND state='pending'",[owner,String(b.id)]);return {ok:true}}if(!pushEnabled)fail('CHANNEL_NOT_CONFIGURED',503);const s=validateSubscription(b.subscription),id=digest(s.endpoint);
   const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['alerts:'+owner]);const {rows:[n]}=await c.query('SELECT count(*)::int AS n FROM monitor_alerts.devices WHERE owner=$1',[owner]);const {rows:[old]}=await c.query('SELECT owner FROM monitor_alerts.devices WHERE id=$1',[id]);if(old&&old.owner!==owner)fail('DEVICE_ALREADY_LINKED',409);if(!old&&n.n>=5)fail('DEVICE_LIMIT');await c.query('INSERT INTO monitor_alerts.devices VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET subscription=$3',[id,owner,s]);await c.query('COMMIT');return {id}}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  },
  async link(owner){if(!telegramEnabled||!botUsername)fail('CHANNEL_NOT_CONFIGURED',503);const code=randomBytes(24).toString('base64url');await pool.query('INSERT INTO monitor_alerts.links VALUES($1,$2,$3) ON CONFLICT(owner) DO UPDATE SET digest=$1,expires=$3',[digest(code),owner,now()+600]);return {url:`https://t.me/${botUsername}?start=pw_${code}`}},
  async unlink(owner){await pool.query('DELETE FROM monitor_alerts.chats WHERE owner=$1',[owner]);await pool.query("UPDATE monitor_alerts.outbox SET state='cancelled' WHERE owner=$1 AND channel='telegram' AND state='pending'",[owner]);return {ok:true}},
  async telegramUpdate(update){const m=update.message;if(m?.chat?.type!=='private'||String(m.from?.id)!==String(m.chat.id))return;
   if(m.text==='/stop'){const {rows}=await pool.query('SELECT owner FROM monitor_alerts.chats WHERE chat=$1',[String(m.chat.id)]);for(const r of rows)await api.unlink(r.owner);return}
   const code=/^\/start pw_([A-Za-z0-9_-]{32})$/.exec(m.text??'')?.[1];if(!code)return;
   const c=await pool.connect();try{await c.query('BEGIN');const {rows:[link]}=await c.query('DELETE FROM monitor_alerts.links WHERE digest=$1 AND expires>$2 RETURNING owner',[digest(code),now()]);if(link){await c.query('DELETE FROM monitor_alerts.chats WHERE chat=$1',[String(m.chat.id)]);await c.query('INSERT INTO monitor_alerts.chats VALUES($1,$2) ON CONFLICT(owner) DO UPDATE SET chat=$2',[link.owner,String(m.chat.id)])}await c.query('COMMIT')}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
  },
  async test(owner,b){const state=await api.state(owner),payload={title:'Pattern Watcher',body:'РўРµСЃС‚РѕРІРѕРµ СѓРІРµРґРѕРјР»РµРЅРёРµ. РљР°РЅР°Р» РїРѕРґРєР»СЋС‡С‘РЅ.',url:'/wallets',tag:'pw-test'};const at=now();const {rows:[r]}=await pool.query('SELECT max(created_at) AS last FROM monitor_alerts.outbox WHERE owner=$1 AND target=$2',[owner,'test']);if(r.last&&at-Number(r.last)<60)fail('TEST_COOLDOWN',429);
   let destinations=[];if(b.channel==='push'&&pushEnabled)destinations=state.devices.map(x=>x.id);else if(b.channel==='telegram'&&telegramEnabled){const {rows}=await pool.query('SELECT chat FROM monitor_alerts.chats WHERE owner=$1',[owner]);destinations=rows.map(x=>x.chat)}else fail('CHANNEL_NOT_CONFIGURED',503);if(!destinations.length)fail('CHANNEL_NOT_CONNECTED');for(const d of destinations)await pool.query('INSERT INTO monitor_alerts.outbox(event_key,owner,target,channel,destination,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomBytes(16).toString('hex'),owner,'test',b.channel,d,payload,at]);return {queued:true}}
 };return api;
}
