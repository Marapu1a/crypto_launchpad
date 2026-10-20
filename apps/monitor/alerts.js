// Retired subscription/wallet-alert prototype. Not part of the free monitor deployment.
window.WalletAlerts=(()=>{
 const copy={
 title:['Notifications','通知','Оповещения'],push:['On this device','此设备','На это устройство'],telegram:['Telegram','Telegram','Telegram'],
 connectPush:['Enable Web Push','启用推送','Включить Web Push'],disconnectPush:['Disconnect this device','断开此设备','Отключить это устройство'],connectTelegram:['Connect Telegram','连接 Telegram','Подключить Telegram'],disconnectTelegram:['Disconnect Telegram','断开 Telegram','Отключить Telegram'],
 min:['Purchase from ≈ $','买入金额至少 ≈ $','Покупка от ≈ $'],newToken:['First observed new token','首次观测到新代币','Первый замеченный новый токен'],save:['Save rule','保存规则','Сохранить правило'],remove:['Stop watching','停止关注','Выключить слежение'],test:['Test','测试','Проверить'],refresh:['Check connection','检查连接','Проверить подключение'],
 unavailable:['Delivery is not configured yet.','尚未配置通知投递。','Доставка пока не настроена.'],saved:['Rule saved.','规则已保存。','Правило сохранено.'],queued:['Test queued for delivery.','测试通知已排队。','Тест поставлен в очередь отправки.'],failed:['Could not complete. Check connection and notification permission.','操作失败，请检查连接及通知权限。','Не получилось. Проверь подключение и разрешение на уведомления.'],
 help:['Observed Pons buys only. The new-token rule starts when watching is enabled; this is not lifetime history. At most one alert per wallet per minute.','仅限已观测到的 Pons 买入。新代币规则从开始关注时生效，并非完整历史。每个钱包每分钟最多一条通知。','Только покупки, замеченные в Pons. Новый токен — с момента включения слежения, не за всю историю кошелька. Не чаще одного уведомления по кошельку в минуту.'],
 denied:['Notifications are blocked in browser settings.','通知已被浏览器设置阻止。','Уведомления запрещены в настройках браузера.'],linked:['Connected','已连接','Подключено'],notLinked:['Not connected','未连接','Не подключено']};
 const t=k=>copy[k][U.locale().startsWith('ru')?2:U.locale().startsWith('zh')?1:0];
 const root=document.getElementById('wallet-alerts');let target=null,generation=0;
 async function api(path,body){const r=await fetch('/api/alerts'+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok)throw Error(d.error);return d}
 async function subscription(){if(!('serviceWorker' in navigator))return null;const r=await navigator.serviceWorker.getRegistration('/');return r?await r.pushManager.getSubscription():null}
 async function show(address){target=address;const current=++generation;root.replaceChildren(U.node('h2',t('title')));let state;try{state=await api('')}catch{if(current===generation)root.append(U.node('p',t('unavailable')));return}if(current!==generation)return;
  if(!state.pushEnabled&&!state.telegramEnabled)root.append(U.node('p',t('unavailable')));
  const row=state.rules.find(x=>x.target===address),controls=U.node('div','','alert-controls'),message=U.node('p','','alert-message');message.setAttribute('role','status');
  const run=fn=>async()=>{const buttons=[...root.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await fn()}catch{message.textContent=t('failed')}finally{buttons.forEach(b=>b.disabled=b.dataset.unavailable==='true')}};
  function button(label,fn,enabled=true){const b=U.node('button',label);b.type='button';b.disabled=!enabled;b.dataset.unavailable=String(!enabled);b.onclick=run(fn);return b}
  const channels=U.node('div','','alert-controls');
  let sub=null;try{sub=await subscription()}catch{}if(current!==generation)return;
  channels.append(button(t(sub?'disconnectPush':'connectPush'),async()=>{
   if(sub){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint));const id=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');await api('/device',{remove:true,id});await sub.unsubscribe();await show(address);return}
   if(!('Notification' in window)||!('PushManager' in window))throw Error();const permission=await Notification.requestPermission();if(permission!=='granted'){message.textContent=t('denied');return}
   await navigator.serviceWorker.register('/sw.js',{scope:'/'});const registration=await navigator.serviceWorker.ready;
   const key=Uint8Array.from(atob(state.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
   const created=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});try{await api('/device',{subscription:created.toJSON()})}catch(e){await created.unsubscribe();throw e}await show(address);
  },!!state.pushEnabled&&!!state.publicKey));
  channels.append(button(t('connectTelegram'),async()=>{const d=await api('/telegram-link',{});const link=U.node('a',t('connectTelegram'));link.href=d.url;link.target='_blank';link.rel='noopener noreferrer';message.replaceChildren(link)},!!state.telegramEnabled));
  if(state.telegramLinked)channels.append(button(t('disconnectTelegram'),async()=>{await api('/telegram-unlink',{});await show(address)}));
  channels.append(button(t('refresh'),()=>show(address)));root.append(channels,U.node('p','Telegram: '+t(state.telegramLinked?'linked':'notLinked')));
  const minimum=U.node('input','');minimum.type='number';minimum.min='0';minimum.max='999999999';minimum.step='0.01';minimum.value=row?.minimum??'100';const label=U.node('label',t('min'));label.append(minimum);controls.append(label);
  const checks={};for(const key of ['newToken','push','telegram']){const l=U.node('label',t(key)),input=U.node('input','');input.type='checkbox';input.checked=!!row?.[key];l.prepend(input);controls.append(l);checks[key]=input}
  controls.append(button(t('save'),async()=>{await api('/rule',{target:address,minimum:minimum.value,newToken:checks.newToken.checked,push:checks.push.checked,telegram:checks.telegram.checked});message.textContent=t('saved')},state.pushEnabled||state.telegramEnabled));
  if(row)controls.append(button(t('remove'),async()=>{await api('/rule',{target:address,remove:true});await show(address)}));root.append(controls);
  const tests=U.node('div','','alert-controls');for(const channel of ['push','telegram'])tests.append(button(t('test')+' '+t(channel),async()=>{await api('/test',{channel});message.textContent=t('queued')},channel==='push'?state.pushEnabled&&state.devices.length>0:state.telegramEnabled&&state.telegramLinked));root.append(tests,U.node('p',t('help'),'section-help'),message);
 }
 return {show};
})();
