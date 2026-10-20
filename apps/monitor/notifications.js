(()=>{
 const words={title:['Activity notifications','活跃通知','Оповещения об оживлении'],help:['A short message when buying activity rises noticeably. No repeated alerts while it stays high. Free, no wallet required.','买入活动明显增加时发送简短通知，持续活跃期间不重复发送。免费，无需钱包。','Короткое сообщение, когда покупок и покупателей заметно больше обычного. Пока оживление продолжается, не повторяем. Бесплатно, без подключения кошелька.'],off:['Delivery is not enabled yet.','通知尚未启用。','Отправка пока не включена.'],push:['Enable on this device','在此设备启用','Включить на этом устройстве'],stopPush:['Disable on this device','在此设备关闭','Выключить на этом устройстве'],tg:['Connect Telegram','连接 Telegram','Подключить Telegram'],stopTg:['Disconnect Telegram','断开 Telegram','Отключить Telegram'],refresh:['Check connection','检查连接','Проверить подключение'],test:['Send a test','发送测试','Отправить проверку'],failed:['Could not complete. Check browser permissions or try again.','操作失败，请检查浏览器权限或重试。','Не получилось. Проверь разрешения браузера или попробуй ещё раз.'],queued:['Test queued.','测试已排队。','Проверка поставлена в очередь.'],continue:['Open the bot and press Start, then check connection here.','打开机器人并点击开始，然后返回检查连接。','Открой бота и нажми «Запустить», затем проверь подключение здесь.'],on:['Connected','已连接','Подключено'],identity:['Settings belong to this browser. Telegram can also be stopped with /stop in the bot.','设置属于此浏览器。也可在机器人中发送 /stop 停止 Telegram 通知。','Настройки привязаны к этому браузеру. Telegram также можно отключить командой /stop в боте.']};
 const t=k=>words[k][U.locale().startsWith('ru')?2:U.locale().startsWith('zh')?1:0],n=U.node;
 const root=n('details','','notification-panel'),summary=n('summary',''),body=n('div','','notification-body');root.append(summary,body);document.querySelector('.page-head').after(root);
 let state=null,busy=false,message='',sub=null,link=null;
 async function api(path='',payload){const r=await fetch('/api/alerts'+path,{method:payload===undefined?'GET':'POST',headers:payload===undefined?{}:{'content-type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();return r.json()}
 async function session(){await api('/session',{})}
 async function prefs(push,telegram){await api('/preferences',{push,telegram})}
 async function refresh(){state=await api();sub=null;if('serviceWorker' in navigator){const registration=await navigator.serviceWorker.getRegistration('/');sub=await registration?.pushManager.getSubscription()??null}}
 async function run(fn){if(busy)return;busy=true;message='';draw();try{await fn();await refresh()}catch{message='failed'}finally{busy=false;draw()}}
 function button(label,fn,enabled=true){const b=n('button',label);b.type='button';b.disabled=busy||!enabled;b.onclick=()=>run(fn);return b}
 function draw(){summary.textContent=t('title');body.replaceChildren(n('p',t('help')));const rule=state?.rules?.find(x=>x.target==='market');
  if(!state?.pushEnabled&&!state?.telegramEnabled)body.append(n('p',t('off'),'quality'));
  const controls=n('div','','alert-controls');
  controls.append(button(t(sub?'stopPush':'push'),async()=>{await session();if(sub){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint));await api('/device',{remove:true,id:[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('')});await sub.unsubscribe();return}
   if(!('Notification' in window)||!('PushManager' in window)||await Notification.requestPermission()!=='granted')throw Error();
   await navigator.serviceWorker.register('/sw.js',{scope:'/'});const registration=await navigator.serviceWorker.ready;
   const key=Uint8Array.from(atob(state.publicKey.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
   const created=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});try{await api('/device',{subscription:created.toJSON()});await prefs(true,!!rule?.telegram)}catch(e){await created.unsubscribe();throw e}
  },!!state?.pushEnabled||!!sub));
  controls.append(button(t(state?.telegramLinked?'stopTg':'tg'),async()=>{await session();if(state?.telegramLinked){await api('/telegram-unlink',{});await prefs(!!rule?.push,false);link=null}else{link=(await api('/telegram-link',{})).url;message='continue'}},!!state?.telegramEnabled||!!state?.telegramLinked));
  controls.append(button(t('refresh'),async()=>{await refresh();if(state.telegramLinked&&!state.rules.some(x=>x.target==='market'&&x.telegram))await prefs(!!state.rules.find(x=>x.target==='market')?.push,true)}));body.append(controls);
  if(state?.telegramLinked)body.append(n('p','Telegram: '+t('on')));
  if(link){const a=n('a','Telegram →');a.href=link;a.target='_blank';a.rel='noopener noreferrer';body.append(a)}
  const tests=n('div','','alert-controls');for(const channel of ['push','telegram']){if(channel==='push'?sub:state?.telegramLinked)tests.append(button(t('test')+' · '+channel,async()=>{await session();await api('/test',{channel});message='queued'}))}body.append(tests);
  const status=n('p',message?t(message):'');status.setAttribute('role','status');body.append(status,n('small',t('identity')));
 }
 root.addEventListener('toggle',()=>{if(root.open&&!state&&!busy)void run(refresh)});document.addEventListener('languagechange',draw);draw();
})();
