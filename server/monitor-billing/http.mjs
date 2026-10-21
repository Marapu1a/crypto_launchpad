import {timingSafeEqual,createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {fail,PLANS} from './core.mjs';

export function billingHttp({billing,origin,monitor='http://127.0.0.1:4196',owner=null,fetcher=fetch,secure=true,alerts=null,telegramIngressSecret=null}){
 const expectedHost=new URL(origin).host,cookieName=secure?'__Host-pw_session':'pw_session';
 const cookie=token=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token?604800:0}${secure?'; Secure':''}`;
 const token=req=>String(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 const rates=new Map();
 function throttle(req,path){const key=(req.socket.remoteAddress??'unknown')+':'+path;const at=Date.now();let r=rates.get(key);if(!r||at-r.at>60000){r={at,n:0};rates.set(key,r)}if(++r.n>30)fail('TOO_MANY_REQUESTS',429);if(rates.size>5000)for(const [k,v] of rates)if(at-v.at>60000)rates.delete(k)}
 return createServer(async(req,res)=>{
  const reply=(status,data,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(data))};
  try{
   if(req.headers.host!==expectedHost)fail('INVALID_HOST',400);
   const url=new URL(req.url,origin),path=url.pathname;
   if(!path.startsWith('/api/'))fail('NOT_FOUND',404);
   if(path==='/api/alerts/telegram-update'){
    const supplied=String(req.headers['x-telegram-bot-api-secret-token']??'');
    const hash=s=>createHash('sha256').update(s).digest();
    if(req.method!=='POST'||!alerts||!telegramIngressSecret||!timingSafeEqual(hash(supplied),hash(telegramIngressSecret)))fail('FORBIDDEN',403);
    let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)fail('BODY_TOO_LARGE',413)}
    let update;try{update=JSON.parse(raw)}catch{fail('INVALID_JSON')}
    const result=await alerts.telegramUpdate(update);return reply(200,{ok:true,...result});
   }
   let body={};
   if(req.method==='POST'){
    if(req.headers.origin!==origin||!String(req.headers['content-type']).startsWith('application/json'))fail('INVALID_ORIGIN',403);
    throttle(req,path);let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8192)fail('BODY_TOO_LARGE',413)}try{body=JSON.parse(text)}catch{fail('INVALID_JSON')}
   }else if(req.method!=='GET')fail('METHOD_NOT_ALLOWED',405);
   if(path==='/api/auth/challenge'&&req.method==='POST')return reply(200,await billing.challenge(body.wallet));
   if(path==='/api/auth/verify'&&req.method==='POST'){const s=await billing.login(body.id,body.signature);return reply(200,{wallet:s.wallet},{'set-cookie':cookie(s.token)})}
   if(path==='/api/auth/logout'&&req.method==='POST'){await billing.logout(token(req));return reply(200,{ok:true},{'set-cookie':cookie('')})}
   const w=await billing.session(token(req));let access=w?await billing.access(w):{active:false,expiresAt:0,wallet:null};
   if(w&&owner&&w===owner.toLowerCase())access={...access,active:true,operator:true};
   if(path==='/api/access'&&req.method==='GET')return reply(200,{...access,paymentsEnabled:billing.enabled,plans:PLANS,serverTime:Math.floor(Date.now()/1000)});
   if(['/api/market-signals','/api/market-signal'].includes(path)&&req.method==='GET'){
    const id=url.searchParams.get('id');if(path==='/api/market-signal'&&!/^[0-9a-f]{24}$/.test(id??''))fail('INVALID_SIGNAL');
    const r=await fetcher(monitor+path+(id?'?id='+id:''),{signal:AbortSignal.timeout(10000)});if(!r.ok)fail(r.status===404?'SIGNAL_NOT_FOUND':'MONITOR_UNAVAILABLE',r.status===404?404:503);return reply(200,await r.json());
   }
   if(path==='/api/status'&&req.method==='GET'){
    const r=await fetcher(monitor+'/api/status',{signal:AbortSignal.timeout(10000)});if(!r.ok)fail('MONITOR_UNAVAILABLE',503);const d=await r.json();delete d.walletActivity;for(const interval of d.intervals??[])delete interval.walletActivity;return reply(200,d);
   }
   if(path.startsWith('/api/alerts')){
    if(!w||!access.active)fail(w?'SUBSCRIPTION_REQUIRED':'SIGN_IN_REQUIRED',w?402:401);
    if(!alerts)fail('ALERTS_NOT_CONFIGURED',503);
    if(path==='/api/alerts'&&req.method==='GET')return reply(200,await alerts.state(w));
    if(req.method==='POST'){
     const action={'/api/alerts/rule':'rule','/api/alerts/language':'setLanguage','/api/alerts/device':'device','/api/alerts/telegram-link':'link','/api/alerts/telegram-unlink':'unlink','/api/alerts/test':'test'}[path];
     if(action)return reply(200,await alerts[action](w,body));
    }
    fail('NOT_FOUND',404);
   }
   if(path.startsWith('/api/billing/')){
    if(!w)fail('SIGN_IN_REQUIRED',401);
    if(path==='/api/billing/invoices'&&req.method==='GET')return reply(200,{invoices:await billing.invoices(w)});
    if(path==='/api/billing/quote'&&req.method==='POST')return reply(200,await billing.quote(w,body.plan));
    if(path==='/api/billing/confirm'&&req.method==='POST')return reply(200,await billing.confirm(w,body.invoiceId,body.txHash));
   }
   if(['/api/wallet','/api/active-wallets'].includes(path)&&req.method==='GET'){
    if(!access.active)fail(w?'SUBSCRIPTION_REQUIRED':'SIGN_IN_REQUIRED',w?402:401);
    if(path==='/api/wallet'&&!/^0x[0-9a-f]{40}$/i.test(url.searchParams.get('address')??''))fail('INVALID_WALLET');
    const minutes=Number(url.searchParams.get('minutes')??5);if(path==='/api/active-wallets'&&![5,30,60].includes(minutes))fail('INVALID_PERIOD');
    const upstream=path==='/api/active-wallets'?'/api/active-wallets?minutes='+minutes:'/api/wallet?address='+url.searchParams.get('address');
    const r=await fetcher(monitor+upstream,{signal:AbortSignal.timeout(40000)});if(!r.ok)fail('MONITOR_UNAVAILABLE',503);const d=await r.json();return reply(200,path==='/api/active-wallets'?{windowEnd:d.windowEnd,minutes:d.minutes??5,complete:d.complete,walletActivity:d.walletActivity??[]}:d);
   }
   fail('NOT_FOUND',404);
  }catch(e){reply(e.status??503,{error:e.status?e.code:'SERVICE_UNAVAILABLE'})}
 });
}
