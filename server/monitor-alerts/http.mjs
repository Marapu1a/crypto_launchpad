import {createServer} from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {fail} from '../monitor-billing/core.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export function monitorHttp({pool,alerts,origin,monitor='http://127.0.0.1:4196',fetcher=fetch,secure=true,telegramIngressSecret=null}){
 const host=new URL(origin).host,name=secure?'__Host-pw_notify':'pw_notify',rates=new Map();
 return createServer(async(req,res)=>{
  const reply=(code,data)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))};
  try{
   if(req.headers.host!==host)fail('INVALID_HOST',400);
   const u=new URL(req.url,origin),path=u.pathname,now=Math.floor(Date.now()/1000);
   if(!['GET','POST'].includes(req.method))fail('METHOD_NOT_ALLOWED',405);
   const key=req.socket.remoteAddress,rate=rates.get(key);if(!rate||now-rate.at>=60)rates.set(key,{at:now,n:1});else if(++rate.n>120)fail('TOO_MANY_REQUESTS',429);
   if(rates.size>5000)for(const [k,v] of rates)if(now-v.at>60)rates.delete(k);
   let body={};if(req.method==='POST'){
    if(path==='/api/alerts/telegram-update'){
     const supplied=String(req.headers['x-telegram-bot-api-secret-token']??'');
     if(!telegramIngressSecret||!timingSafeEqual(Buffer.from(hash(supplied)),Buffer.from(hash(telegramIngressSecret))))fail('FORBIDDEN',403);
    }else if(req.headers.origin!==origin||!String(req.headers['content-type']).startsWith('application/json'))fail('INVALID_ORIGIN',403);
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)fail('BODY_TOO_LARGE',413)}try{body=JSON.parse(raw)}catch{fail('INVALID_JSON',400)}
   }
   if(path==='/api/alerts/telegram-update'&&req.method==='POST'){await alerts.telegramUpdate(body);return reply(200,{ok:true})}
   if(req.method==='GET'&&['/api/status','/api/wallet','/api/active-wallets','/api/interval'].includes(path)){
    let query='';if(path==='/api/wallet'){const a=u.searchParams.get('address');if(!/^0x[0-9a-f]{40}$/i.test(a??''))fail('INVALID_WALLET',400);query='?address='+a}
    if(path==='/api/active-wallets'){const m=Number(u.searchParams.get('minutes')??5);if(![5,30,60].includes(m))fail('INVALID_PERIOD',400);query='?minutes='+m}
    if(path==='/api/interval'){const end=Number(u.searchParams.get('end'));if(!Number.isSafeInteger(end)||end<=0||end%300)fail('INVALID_INTERVAL',400);query='?end='+end}
    const r=await fetcher(monitor+path+query,{signal:AbortSignal.timeout(40000)});if(!r.ok)fail(r.status===404?'INTERVAL_NOT_FOUND':'MONITOR_UNAVAILABLE',r.status===404?404:503);const d=await r.json();if(path==='/api/status'||path==='/api/interval'){delete d.walletActivity;for(const x of d.intervals??[])delete x.walletActivity}return reply(200,d);
   }
   if(!path.startsWith('/api/alerts'))fail('NOT_FOUND',404);
   const cookie=String(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
   let owner;if(cookie&&/^[a-f0-9]{64}$/.test(cookie)){const {rows:[s]}=await pool.query('SELECT owner FROM monitor_alerts.sessions WHERE digest=$1 AND expires>$2',[hash(cookie),now]);owner=s?.owner}
   if(path==='/api/alerts/session'&&req.method==='POST'){
    if(!owner){const token=randomBytes(32).toString('hex');owner='browser:'+randomBytes(20).toString('hex');await pool.query('INSERT INTO monitor_alerts.sessions VALUES($1,$2,$3)',[hash(token),owner,now+365*86400]);res.setHeader('set-cookie',`${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure?'; Secure':''}`)}return reply(200,{ok:true});
   }
   if(path==='/api/alerts'&&req.method==='GET')return reply(200,owner?await alerts.state(owner):{rules:[],devices:[],telegramLinked:false,publicKey:alerts.publicKey,pushEnabled:alerts.pushEnabled,telegramEnabled:alerts.telegramEnabled});
   if(!owner)fail('SESSION_REQUIRED',401);
   if(path==='/api/alerts/preferences'&&req.method==='POST'){
    if(typeof body.push!=='boolean'||typeof body.telegram!=='boolean')fail('INVALID_PREFERENCES',400);
    const state=await alerts.state(owner);
    if(body.push&&(!state.pushEnabled||!state.devices.length)||body.telegram&&(!state.telegramEnabled||!state.telegramLinked))fail('CHANNEL_NOT_CONNECTED',400);
    await pool.query("INSERT INTO monitor_alerts.rules VALUES($1,'market',0,false,$2,$3,$4) ON CONFLICT(owner,target) DO UPDATE SET push=$2,telegram=$3,created_at=$4",[owner,body.push,body.telegram,now]);
    await pool.query("UPDATE monitor_alerts.outbox SET state='cancelled' WHERE owner=$1 AND target='market' AND state='pending' AND ((channel='push' AND NOT $2) OR (channel='telegram' AND NOT $3))",[owner,body.push,body.telegram]);return reply(200,{ok:true});
   }
   const action={'/api/alerts/device':'device','/api/alerts/telegram-link':'link','/api/alerts/telegram-unlink':'unlink','/api/alerts/test':'test'}[path];
   if(action&&req.method==='POST')return reply(200,await alerts[action](owner,body));fail('NOT_FOUND',404);
  }catch(e){reply(e.status??503,{error:e.status?e.code:'SERVICE_UNAVAILABLE'})}
 });
}
