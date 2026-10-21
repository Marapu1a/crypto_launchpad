import {language,localized,recipientLanguage} from './language.mjs';
// Public aggregate signals only. No RPC, exchange rates or wallet paywall.
export function message(event,lang='ru'){
 lang=language(lang);
 const c=event.current,b=event.baseline;
 const leaders=[...(event.snapshot?.board??[])].filter(x=>x.recent?.buyers>0)
  .sort((a,b)=>b.recent.buyers-a.recent.buyers).slice(0,3);
 const n=x=>new Intl.NumberFormat({ru:'ru-RU',en:'en-US',zh:'zh-CN'}[lang],{maximumFractionDigits:1}).format(x);
 return {language:lang,title:localized(lang,'Buying activity is up on Pons','На Pons заметно выросла активность','Pons 买入活跃度明显上升'),
  body:localized(lang,`In 5 minutes: ${n(c.buyers)} buyer wallets; usually ${n(b.buyers)} per 5 minutes over the previous half hour. ${n(c.buys)} buys · ${n(c.tokens)} tokens.`,`За 5 минут — ${n(c.buyers)} кошельков-покупателей; в предыдущие полчаса обычно ${n(b.buyers)} за 5 минут. ${n(c.buys)} покупок · ${n(c.tokens)} токенов.`,`5 分钟内有 ${n(c.buyers)} 个买家钱包；此前半小时通常每 5 分钟为 ${n(b.buyers)} 个。${n(c.buys)} 次买入 · ${n(c.tokens)} 种代币。`)+
   (leaders.length?' '+localized(lang,'Most buyers: ','Больше всего покупателей: ','买家最多的代币：')+leaders.map(x=>`${String(x.symbol||x.address).replace(/[\r\n\t]/g,' ').slice(0,32)} — ${n(x.recent.buyers)}`).join(', ')+'.':''),
  url:'/?interval='+event.windowEnd,tag:'pw-activity-'+event.windowEnd};
}
export async function ingestMarket(pool,feed,{now=Math.floor(Date.now()/1000)}={}){
 const data=await feed();if(!Array.isArray(data.events))throw Error('Invalid activity feed');
 const events=[...data.events].sort((a,b)=>a.windowEnd-b.windowEnd);
 const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('pw-market-ingest'))");
  const {rows:[cursor]}=await c.query("SELECT value FROM monitor_alerts.cursor WHERE name='market'");
  let end=cursor?Number(cursor.value):0;
  for(const e of events){if(!Number.isSafeInteger(e.windowEnd)||e.windowEnd%300)throw Error('Invalid interval');if(e.windowEnd<=end)continue;
   end=e.windowEnd;if(now-end>900||now<end)continue;

   const {rows:rules}=await c.query("SELECT * FROM monitor_alerts.rules WHERE target='market' AND created_at<=$1",[end-300]);
   for(const r of rules){const destinations=[];
    if(r.push){const {rows}=await c.query('SELECT id FROM monitor_alerts.devices WHERE owner=$1',[r.owner]);destinations.push(...rows.map(x=>['push',x.id]))}
    if(r.telegram){const {rows}=await c.query('SELECT chat FROM monitor_alerts.chats WHERE owner=$1',[r.owner]);destinations.push(...rows.map(x=>['telegram',x.chat]))}
    for(const [channel,destination] of destinations){const payload=message(e,await recipientLanguage(c,r.owner,channel));await c.query('INSERT INTO monitor_alerts.outbox(event_key,owner,target,channel,destination,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',['market:'+end,r.owner,'market',channel,destination,payload,end]);}
   }
  }
  await c.query("INSERT INTO monitor_alerts.cursor VALUES('market',$1) ON CONFLICT(name) DO UPDATE SET value=$1",[end]);await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
