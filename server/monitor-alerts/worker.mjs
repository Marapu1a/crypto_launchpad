import {localized,recipientLanguage} from './language.mjs';
// Internal observed-trade feed only. This worker never reads blockchain RPC.
export async function ingest(pool,feed,{now=Math.floor(Date.now()/1000)}={}){
 const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('pw-alert-ingest'))");
 const {rows:[cursor]}=await c.query("SELECT value FROM monitor_alerts.cursor WHERE name='trades'");
 if(!cursor){const d=await feed(null);await c.query("INSERT INTO monitor_alerts.cursor VALUES('trades',$1)",[d.cursor]);await c.query('COMMIT');return}
 const data=await feed(Number(cursor.value));let next=Number(cursor.value);
 for(const e of data.events){if(!Number.isSafeInteger(e.seq)||e.seq<=next)throw Error('Invalid event order');next=e.seq;if(e.side!=='buy'||!/^0x[0-9a-f]{40}$/i.test(e.trader)||!/^0x[0-9a-f]{40}$/i.test(e.token))continue;
  const {rows:rules}=await c.query('SELECT * FROM monitor_alerts.rules WHERE target=$1',[e.trader.toLowerCase()]);
  for(const r of rules){
   const {rowCount:fresh}=await c.query('INSERT INTO monitor_alerts.seen VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[r.owner,r.target,e.token.toLowerCase()]);
   // Seed knowledge from old observations, but never replay historical notifications.
   if(e.timestamp<Number(r.created_at)||now-e.timestamp>900||e.timestamp>now)continue;
   const amount=Number(e.quoteAmount),rate=Number(e.quoteUsd),usd=e.quoteAmount!=null&&e.quoteUsd!=null&&Number.isFinite(amount)&&amount>=0&&Number.isFinite(rate)&&rate>0?amount*rate:null;
   const large=usd!==null&&Number.isFinite(usd)&&usd>=Number(r.minimum),newToken=r.new_token&&!!fresh;if(!large&&!newToken)continue;
   const {rowCount:recent}=await c.query('SELECT 1 FROM monitor_alerts.outbox WHERE owner=$1 AND target=$2 AND created_at>$3 LIMIT 1',[r.owner,r.target,now-60]);if(recent)continue;
   const token=String(e.symbol||e.token).slice(0,50);
   const destinations=[];
   if(r.push){const {rows}=await c.query('SELECT id FROM monitor_alerts.devices WHERE owner=$1',[r.owner]);for(const x of rows)destinations.push(['push',x.id])}
   if(r.telegram){const {rows}=await c.query('SELECT chat FROM monitor_alerts.chats WHERE owner=$1',[r.owner]);for(const x of rows)destinations.push(['telegram',x.chat])}
   for(const [channel,destination] of destinations){
    const lang=await recipientLanguage(c,r.owner,channel),reason=newToken?localized(lang,'First observed token','Первый замеченный токен','首次观察到的代币'):localized(lang,'Purchase','Покупка','买入');
    const payload={title:'Pattern Watcher',language:lang,body:`${r.target.slice(0,8)}…${r.target.slice(-6)} · ${reason}: ${token}${usd===null||!Number.isFinite(usd)?'':` · ≈ $${usd.toFixed(2)}`}`,url:'/wallets?address='+r.target,tag:'pw-'+e.seq};
    await c.query('INSERT INTO monitor_alerts.outbox(event_key,owner,target,channel,destination,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',[String(e.seq),r.owner,r.target,channel,destination,payload,now]);}
  }
 }
 await c.query("UPDATE monitor_alerts.cursor SET value=$1 WHERE name='trades'",[next]);await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}

export async function deliver(pool,{sendPush,sendTelegram,access,now=Math.floor(Date.now()/1000)}){
 // One transaction claims each job. Another worker skips it while delivery is in flight.
 for(let i=0;i<25;i++){
  const c=await pool.connect();try{await c.query('BEGIN');const {rows:[job]}=await c.query("SELECT * FROM monitor_alerts.outbox WHERE state='pending' AND retry_at<=$1 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1",[now]);if(!job){await c.query('COMMIT');return}
   const allowed=await access(job.owner);
   let destination;if(job.channel==='push'){const {rows:[d]}=await c.query('SELECT subscription FROM monitor_alerts.devices WHERE id=$1 AND owner=$2',[job.destination,job.owner]);destination=d?.subscription}else{const {rows:[d]}=await c.query('SELECT chat FROM monitor_alerts.chats WHERE owner=$1 AND chat=$2',[job.owner,job.destination]);destination=d?.chat}
   const {rows:[rule]}=await c.query('SELECT push,telegram FROM monitor_alerts.rules WHERE owner=$1 AND target=$2',[job.owner,job.target]);
   if(!allowed||!destination||(job.target!=='test'&&!rule?.[job.channel])||now-Number(job.created_at)>900){await c.query("UPDATE monitor_alerts.outbox SET state='cancelled' WHERE id=$1",[job.id]);await c.query('COMMIT');continue}
   if(job.target==='market'){await c.query("UPDATE monitor_alerts.outbox SET state='sending' WHERE id=$1",[job.id]);await c.query('COMMIT');await c.query('BEGIN')}
   try{await (job.channel==='push'?sendPush(destination,job.payload):sendTelegram(destination,job.payload));await c.query("UPDATE monitor_alerts.outbox SET state='sent',attempts=attempts+1 WHERE id=$1",[job.id])}
   catch(e){const permanent=[400,401,403,404,410].includes(e.statusCode??e.status);if(job.channel==='push'&&[404,410].includes(e.statusCode))await c.query('DELETE FROM monitor_alerts.devices WHERE id=$1',[job.destination]);if(job.channel==='telegram'&&(e.status===403))await c.query('DELETE FROM monitor_alerts.chats WHERE owner=$1 AND chat=$2',[job.owner,job.destination]);const attempts=job.attempts+1;await c.query('UPDATE monitor_alerts.outbox SET attempts=$2,state=$3,retry_at=$4 WHERE id=$1',[job.id,attempts,permanent||attempts>=5||(job.target==='market'&&(e.statusCode??e.status)!==429)?'failed':'pending',now+Math.min(600,Math.max(Number(e.retryAfter)||0,30*2**attempts))])}
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }
}
