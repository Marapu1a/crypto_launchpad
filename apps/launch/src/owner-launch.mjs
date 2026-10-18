import {drawAsset} from '../../../src/draws/assets.mjs';
import './style.css';
import {formatEther} from 'ethers';
import {initialDraft} from '../../../src/pons/plan.mjs';
import {signReservedOwnerStep} from '../../../src/pons/owner-signing.mjs';
import {publishImageOnServer} from '../../../src/pons/api-client.mjs';
import {readOwnerForm} from '../../../src/launch/owner-form.mjs';
import {ownerWallet} from '../../../src/launch/owner-wallet.mjs';
import {UUID} from '../../../src/launch/template.mjs';

const app=document.querySelector('#app');let key='launchpad:owner-launch:v1';
const isV2=()=>[2,3,4].includes(config?.defaults?.draws?.version);
const complete=()=>['registered','deployed'].includes(state?.stage);
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let config,state,input,handoff,wallet,busy=false,notice='';
function walletPanel(){
 const panel=document.querySelector('#owner-wallet');if(!panel)return;const w=wallet.state();
 panel.innerHTML=`<h2>Кошелёк для запуска</h2><p style="overflow-wrap:anywhere">Аккаунт: ${escape(w.account||'не подключён')}</p><p>Сеть: ${escape(w.chain==='0x1237'?'Robinhood Chain (4663)':w.chain||'не определена')}</p><p role="status">${escape(w.message||(!w.ready?'Выберите аккаунт владельца и сеть Robinhood Chain (4663).':'Кошелёк владельца подключён.'))}</p><button id="connect-owner" type="button" class="button secondary">Подключить кошелёк</button> <button id="switch-owner-chain" type="button" class="button secondary">Переключить на Robinhood Chain</button><p>${config.signingEnabled?'Подписи разрешены. Каждый шаг подтверждается отдельно.':'Подписи выключены на сервере. Подключение доступно, отправка транзакций пока заблокирована.'}</p>`;
 panel.querySelectorAll('button').forEach(b=>b.disabled=busy||w.busy);
 panel.querySelector('#connect-owner').onclick=()=>wallet.connect();panel.querySelector('#switch-owner-chain').onclick=()=>wallet.switchChain();
 for(const id of ['sign','retry']){const button=document.getElementById(id);if(button)button.disabled=busy||w.busy||!w.ready||(config.mode==='production'&&!config.signingEnabled);}
}

const field=(name,label,value)=>`<label class="field"><span>${label}</span><input name="${name}" value="${escape(value)}" ${name==='weights'?'':'required'}></label>`;
async function request(path,body){const response=await fetch('/api/owner-launch/'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;}
function persist(){localStorage.setItem(key,JSON.stringify({id:input.id,input,instanceId:config.instanceId}));}
async function action(kind,body={}){state=await request(input.id+'/'+kind,body);input=state.input;persist();return state;}
function render(){
 const step=state?.pending??state?.candidate;
 app.innerHTML=`<main style="max-width:1050px;margin:32px auto;padding:24px;overflow-wrap:anywhere"><a href="/launch.html">Launchpad</a><p class="eyebrow">ЗАПУСК ЧЕРЕЗ КОШЕЛЁК · ${config.mode==='production'?'ОСНОВНАЯ СЕТЬ':'РЕПЕТИЦИЯ'}</p><h1>Токен и розыгрыши</h1><p>${config.mode==='production'?(config.signingEnabled?'Основная сеть 4663. Каждую реальную транзакцию подтверждает ваш кошелёк.':'Подготовка запуска в основной сети 4663. Подписи выключены; можно проверить и сохранить план.'):'Контракты для сети 4663 проверяются в изолированной копии. Каждую транзакцию подтверждает кошелёк владельца.'}</p>${config.localFixtureWallet?'<p><strong>Локальный тестовый кошелёк.</strong> Каждый шаг отправляется только в копию сети. Это не реальные средства и не подключённое расширение.</p>':''}<p>Владелец: <code>${escape(config.owner)}</code></p>
 ${config.profile?.funding?`<section aria-label="Бюджет запуска"><p>Стартовый ETH: исполнитель ${formatEther(config.profile.funding.executor)}, публикатор ${formatEther(config.profile.funding.publisher)}. Общий лимит запуска: ${formatEther(config.profile.totalNativeLimit)} ETH.</p><p>Это пополнение отдельных кошельков, не комиссия Pons. Последующие пополнения ручные; доля обслуживания поступает в ${escape(input.draws.asset)}.</p></section>`:''}
 ${config.localFixtureWallet?'':'<section id="owner-wallet" aria-label="Подключение кошелька"></section>'}
 <details><summary>Описание и ссылки токена</summary><p>${escape(input.draft.description)}</p>${['twitter','telegram','discord','farcaster'].filter(k=>input.draft[k]).map(k=>`<p>${escape(k)}: ${escape(input.draft[k])}</p>`).join('')}</details>
 <form id="owner-form"><fieldset ${busy||state?'disabled':''} style="border:0;padding:0">${isV2()?`<label class="field"><span>Алгоритм и расписание</span><select name="schedule" ${!!input.draws.schedule?'disabled':''}><option value="legacy" ${!input.draws.schedule?'selected':''}>Прежние режимы Short / Monthly</option><option value="igw-monthly" ${!!input.draws.schedule?'selected':''}>Алгоритм IGW, каждые 30 суток</option></select></label><p id="igw-schedule-help" hidden>Билеты и алгоритм IGW. Первый срок — через 30 суток после запуска токена, следующие — через 30 суток после завершения цикла. Недостаточный фонд задерживает цикл; победитель не гарантирован. Это не прежний алгоритм Monthly.</p>`:''}${isV2()?`<label class="field"><span>Валюта токена и розыгрышей</span><select name="asset"><option value="USDG" ${input.draws.asset==='USDG'?'selected':''}>USDG</option><option value="ETH" ${input.draws.asset==='ETH'?'selected':''}>ETH</option></select></label><p>При смене валюты суммы нужно ввести заново. Это не конвертация по курсу.</p>`:''}<div class="two">${field('name','Название',input.draft.name)}${field('symbol','Тикер',input.draft.symbol)}<label class="field"><span>Адрес сайта</span><input name="website" type="url" placeholder="https://example.com/" value="${escape(input.draft.website)}" ${config.mode==='production'?'required':''}></label>${config.mode==='production'?'':field('slug','Код проекта',input.slug)+field('logo','Картинка IPFS',input.draft.logo)}</div>
 ${config.mode==='production'?`<section style="margin:24px 0"><h2 style="font-size:18px">Логотип проекта</h2>${config.preparedLogo?`<a href="${escape(config.preparedLogo.previewUrl)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:16px;max-width:100%"><img src="${escape(config.preparedLogo.previewUrl)}" alt="Логотип проекта" width="96" height="96" style="object-fit:contain;border-radius:12px;flex-shrink:0"><span style="overflow-wrap:anywhere">${escape(config.preparedLogo.path)}</span></a><p>Согласован и подготовлен для запуска.</p>`:'<p>Логотип ещё не подготовлен. Сначала выберем файл в папке проекта.</p>'}</section>`:'<label class="field"><span>Картинка</span><input id="image-file" type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button" class="button secondary" id="upload">Загрузить через Pons</button>'}<p>Торговая пара: ${escape(input.draws.asset)}</p>
 ${isV2()?'<label class="field"><span>Розыгрыши</span><select name="mode"><option value="short" '+(!input.draws.monthly.enabled?'selected':'')+'>Только Short</option><option value="monthly" '+(!input.draws.short.enabled?'selected':'')+'>Только Monthly</option><option value="both" '+(input.draws.short.enabled&&input.draws.monthly.enabled?'selected':'')+'>Short + Monthly</option></select></label>':''}
 <div class="two">${field('creatorFee','Creator fee, %',input.draft.creatorFee)}${field('openingBuy','Первая покупка, '+input.draws.asset,input.draft.openingBuy??'0')}${field('ticketPurchase','Покупок на билет, '+input.draws.asset,input.draws.ticketPurchase)}${field('minimumFund','Short: фонд от, '+input.draws.asset,input.draws.short.minimumFund)}${field('hours','Short: интервал в часах (до 168)',input.draws.short.intervalSeconds/3600)}${field('count','Призовых мест',input.draws.short.basket.weights.length)}${field('weights','Веса крупных призов',input.draws.short.basket.weights.join(':'))}${field('minimumUnit','Минимальная единица приза',input.draws.short.basket.minimumUnit)}${field('prizes','На призы, %',input.draws.fees.prizesBps/100)}${field('teamShare','Команде, %',input.draws.fees.teamBps/100)}${field('operationsShare','На обслуживание, %',input.draws.fees.operationsBps/100)}${field('team','Кошелёк команды',input.team)}${field('operations','Кошелёк обслуживания',input.operations)}</div>${isV2()?'<div id="monthly-settings" class="two">'+field('monthlyMinimum','Monthly: фонд от, '+input.draws.asset,input.draws.monthly.minimumFund)+field('monthlyNext','Monthly: резерв следующего фонда, '+input.draws.asset,input.draws.monthly.nextReserve)+'</div><label id="allocation-settings" class="field"><span>Доля призовых комиссий Short: <output id="allocation-label">'+input.draws.allocation.shortBps/100+'%</output>; остальное — Monthly</span><input name="shortShare" type="range" min="1" max="9999" step="1" value="'+(input.draws.allocation.shortBps>0&&input.draws.allocation.shortBps<10000?input.draws.allocation.shortBps:5000)+'"></label><p id="legacy-monthly-help">Monthly: 30 дней от завершения предыдущего, одно призовое место. Вероятность выплаты 75%; без победителя фонд переносится. Резерв Next должен быть заполнен.</p>':''}<p>Недостающие веса заполняются единицами. Победителя может не быть; фонд переносится.</p><button class="button primary" type="submit">Проверить и сохранить запуск</button></fieldset></form>
 ${!state?'<details><summary>Продолжить запуск по ID</summary><input id="resume-id" placeholder="ID сохранённого запуска"><button id="resume" type="button" class="button secondary">Загрузить с сервера</button></details>':''}
 <p id="notice" role="status">${escape(notice)}</p>
 ${state?`<section><h2>${state.stage==='deployed'?'Контракты развёрнуты':complete()?'Проект зарегистрирован':'Продолжение запуска'}</h2><p>ID: <code>${state.id}</code></p><p>Потрачено: ${formatEther(state.spent)} ETH. Лимит всего запуска: ${formatEther(state.profile.totalNativeLimit)} ETH.</p><p>Газ для исполнителя: ${formatEther(state.profile.funding.executor)} ETH; для подтверждения покупок: ${formatEther(state.profile.funding.publisher)} ETH.</p><p>План хранится на сервере. После закрытия страницы продолжится этот же запуск. Следующий шаг доступен после успешного включения в блок; окончательное подтверждение проверяется в конце перед обслуживанием.</p>
 ${step?`<div class="result-box"><h3>${escape(step.label??step.kind)}</h3><p>${step.request.to?'Получатель: '+escape(step.request.to):'Создание контракта'}</p><p>Сумма: ${formatEther(step.request.value)} ETH · максимум gas: ${formatEther(BigInt(step.request.gasLimit)*BigInt(step.request.gasPrice))} ETH</p><p>Nonce: ${step.request.nonce}</p>${state.candidate?'<button id="sign" class="button primary">Подтвердить этот шаг в кошельке</button>':`<p>Ожидает ${step.hash?'включения в блок':'результата запроса кошельку'}</p>${step.hash?`<code>${escape(step.hash)}</code>`:'<label class="field"><span>Hash из кошелька</span><input id="recover-hash"></label><button id="attach" class="button secondary">Проверить отправку</button><button id="reprice" class="button secondary">Обновить комиссию</button><p>Обновление комиссии сохраняет действие и nonce. Новую стоимость подтвердите отдельно. Запас цены газа — 2× текущей; это цена отправки, не только верхний предел.</p><button id="retry" class="button secondary">Подтвердить повтор в кошельке</button>'}`}</div>`:''}
 ${state.stage==='awaiting-finality'?`<p role="status">Все транзакции выполнены. Ожидаем окончательного подтверждения перед подготовкой обслуживания. Блок запуска: ${escape(state.finality?.target)}; финализирован: ${escape(state.finality?.finalized??'нет данных')}.</p>`:''}
 <button id="refresh" class="button secondary">Обновить состояние</button><ol>${state.history.map(h=>`<li>${escape(h.label??h.kind)} · <code>${escape(h.hash)}</code> · включён в блок, перепроверен</li>`).join('')}</ol>${state.launch?`<p>Токен: <code>${escape(state.launch.token)}</code></p>`:''}${complete()?`<p>Контракты развёрнуты. Подготовка обслуживания регистрирует проект в общем бэке; запуск выполняется отдельно.</p><button id="handoff" type="button" class="button secondary">Проверить подготовку обслуживания</button>${handoff?`<section id="handoff-result"><h3>Конфигурация: запуск выключен</h3><p>${handoff.prepared?'Ключи проверены. Конфигурация подготовлена.':'Нужны отдельные ключи исполнителя и подтверждения покупок.'}</p><ul>${handoff.credentials.map(c=>`<li>${escape(c.role)}: ${c.ready?'проверен':'не готов'} · <code>${escape(c.address)}</code></li>`).join('')}</ul><p>Планируемый адрес: ${escape(handoff.site.url)}. ${handoff.site.registered?'Домен зарегистрирован в БД; доступность сайта отдельно не проверялась.':'Домен ещё не зарегистрирован.'}</p>${handoff.prepared?'<button id="download-runtime" type="button" class="button secondary">Скачать выключенную конфигурацию</button>':''}<p>Эта проверка не запускает службу, не создаёт домен и не отправляет транзакций.</p></section>`:''}`:''}</section>`:''}
 <details><summary>Параметры стенда и сборки</summary><pre>${escape(JSON.stringify({build:state?.buildHash??config.buildHashes?.[input.draws.asset]??config.buildHash,timing:config.profile.timing,limits:config.profile.limits,instance:config.instanceId},null,2))}</pre></details></main>`;
 app.querySelectorAll('button').forEach(button=>{if(busy||(config.mode==='production'&&!config.signingEnabled&&['sign','retry'].includes(button.id)))button.disabled=true;});
 if(!config.localFixtureWallet)walletPanel();
 const work=async fn=>{if(busy)return;busy=true;render();try{await fn();}catch(e){notice=e.code===4001?'Подпись отклонена. Можно повторить тот же сохранённый запрос.':e.message;}finally{busy=false;render();}};
 document.querySelector('#resume')?.addEventListener('click',()=>{const id=document.querySelector('#resume-id').value.trim();return work(async()=>{if(!UUID.test(id))throw Error('Неверный ID запуска');state=await request(id+'/next',{});input=state.input;persist();notice='Запуск восстановлен из серверного журнала';});});
 document.querySelector('#owner-form').onsubmit=event=>{
  event.preventDefault();const data=new FormData(event.target);
  return work(async()=>{
   input=readOwnerForm(input,data);persist();await action('create',{input});notice='План сохранён. Проверьте шаг перед подписью.';
  });
 };
 const mode=document.querySelector('[name=mode]'),share=document.querySelector('[name=shortShare]');
 const schedule=document.querySelector('[name=schedule]');
 const assetSelect=document.querySelector('[name=asset]');
 if(assetSelect)assetSelect.onchange=()=>{
  const asset=assetSelect.value;if(asset===input.draws.asset)return;
  const edited=new FormData(document.querySelector('#owner-form'));
  for(const name of ['name','symbol','website','logo','creatorFee'])if(edited.has(name))input.draft[name]=String(edited.get(name));
  for(const name of ['slug','team','operations'])if(edited.has(name))input[name]=String(edited.get(name));
  input.draws.asset=asset;input.draws.version=asset==='ETH'?4:(input.draws.schedule?3:2);input.draft.pair=drawAsset(asset).address;input.draft.openingBuy='';
  input.draws.ticketPurchase='';input.draws.short.minimumFund='';input.draws.short.basket.minimumUnit='';input.draws.monthly.minimumFund='';input.draws.monthly.nextReserve='';persist();render();
  // Preserve other unsaved choices while only monetary values are reset.
  const reset=new Set(['asset','openingBuy','ticketPurchase','minimumFund','minimumUnit','monthlyMinimum','monthlyNext']);
  for(const [name,value] of edited)if(!reset.has(name)){const el=document.querySelector(`[name="${name}"]`);if(el)el.value=value;}
  document.querySelector('[name=schedule]')?.dispatchEvent(new Event('change'));
 };

 const visibility=()=>{if(!mode)return;const igw=schedule?.value==='igw-monthly';if(igw)mode.value='short';mode.disabled=igw||busy||!!state;document.querySelector('#igw-schedule-help').hidden=!igw;document.querySelector('#legacy-monthly-help').hidden=igw||mode.value==='short';document.querySelector('#monthly-settings').hidden=mode.value==='short'&&!!document.querySelector('[name=monthlyMinimum]').value&&!!document.querySelector('[name=monthlyNext]').value;document.querySelector('#allocation-settings').hidden=mode.value!=='both';
  for(const name of ['minimumFund','hours','count','weights','minimumUnit']){
   const el=document.querySelector('[name='+name+']');el.closest('label').hidden=mode.value==='monthly'&&!!el.value;el.disabled=mode.value==='monthly'&&!!el.value;
  }
  for(const name of ['monthlyMinimum','monthlyNext']){const el=document.querySelector('[name='+name+']');el.disabled=mode.value==='short'&&!!el.value;}
  const hours=document.querySelector('[name=hours]');hours.disabled=igw||mode.value==='monthly'||busy||!!state;hours.closest('label').hidden=igw||mode.value==='monthly';share.disabled=mode.value!=='both';
  document.querySelector('#allocation-label').textContent=Number(share.value)/100+'%';
 };
 if(schedule)schedule.onchange=visibility;if(mode)mode.onchange=visibility;if(share)share.oninput=visibility;visibility();
 document.querySelector('#upload')?.addEventListener('click',()=>{
  const file=document.querySelector('#image-file').files[0];
  if(!file){notice='Выберите картинку';render();return;}
  // Keep other edited fields while the upload temporarily redraws the form.
  const form=new FormData(document.querySelector('#owner-form'));
  return work(async()=>{const {publication}=await publishImageOnServer(file);input.draft.logo=publication.uri;persist();notice=publication.warning||'Картинка загружена через Pons';}).then(()=>{for(const [k,v] of form)if(k!=='logo'){const el=document.querySelector(`[name="${k}"]`);if(el)el.value=v;}});
 });
 async function sign(kind){
  if(config.mode==='production'&&!config.signingEnabled)throw Error('Боевые подписи ещё не включены');
  if(config.localFixtureWallet){if(!window.confirm('Подтвердить этот шаг в локальной копии сети? Реальные средства не используются.'))return;}
  else{await wallet.requireReady();}
  const step=state.candidate??state.pending;
  await action(kind,{requestId:step.id,revision:state.revision});
  const hash=config.localFixtureWallet?(await request(input.id+'/rehearsal-sign',{requestId:state.pending.id})).hash:await signReservedOwnerStep(window.ethereum,state);
  // Save returned hash locally too if the acknowledgement cannot reach backend.
  localStorage.setItem(key+':hash:'+input.id,JSON.stringify({requestId:state.pending.id,hash}));
  await action('attach',{requestId:state.pending.id,hash});notice='Отправка сохранена. После успешного включения в блок нажмите «Обновить состояние» для следующего шага.';
 }
 document.querySelector('#handoff')?.addEventListener('click',()=>work(async()=>{handoff=undefined;handoff=await request(input.id+'/handoff',{});notice='Подготовка проверена. В конфигурации отправки выключены.';}));
 document.querySelector('#download-runtime')?.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(handoff.config,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=input.slug+'-runtime-disabled.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 document.querySelector('#sign')?.addEventListener('click',()=>work(()=>sign('arm')));
 document.querySelector('#reprice')?.addEventListener('click',()=>work(async()=>{await action('reprice',{requestId:state.pending.id,revision:state.revision});notice='Комиссия обновлена. Проверьте новую стоимость выше, затем подтвердите повтор в кошельке.';}));
 document.querySelector('#retry')?.addEventListener('click',()=>work(()=>sign('retry')));
 document.querySelector('#attach')?.addEventListener('click',()=>{const hash=document.querySelector('#recover-hash').value.trim();return work(async()=>{await action('attach',{requestId:state.pending.id,hash});notice='Отправка проверена';});});
 document.querySelector('#refresh')?.addEventListener('click',()=>work(async()=>{
  const saved=JSON.parse(localStorage.getItem(key+':hash:'+input.id)||'null');
  if(saved&&state.pending?.id===saved.requestId&&!state.pending.hash)await action('attach',saved);
  else await action('next');notice='Состояние обновлено';
 }));
}
async function boot(){
 try{
  config=await request('config');key=isV2()?'launchpad:owner-launch:v2':'launchpad:owner-launch:v1';if(config.mode==='production')key+=':production';const saved=JSON.parse(localStorage.getItem(key)||'null');
  if(saved&&saved.instanceId!==config.instanceId){
   app.innerHTML=`<main style="padding:40px"><h1>Открыта другая среда запуска</h1><p>Сохраните ID прежнего запуска: <code>${escape(saved.id)}</code>. Его серверный журнал остаётся в прежней среде.</p><button id="new-stand" class="button secondary">Начать черновик на новом стенде</button></main>`;
   document.querySelector('#new-stand').onclick=()=>{localStorage.removeItem(key);void boot();};return;
  }
  if(saved){if(saved.instanceId!==config.instanceId)throw Error('Сохранённый запуск относится к другому стенду. Сохраните его ID перед созданием нового.');input=saved.input;try{await action('next');}catch(e){notice=e.message;}}
  else input={id:crypto.randomUUID(),slug:config.defaults.slug??('token-'+Date.now().toString().slice(-6)),draft:{...initialDraft(),...config.defaults.draft},draws:structuredClone(config.defaults.draws),team:config.defaults.team,operations:config.defaults.operations};
  wallet=ownerWallet({owner:config.owner,changed:walletPanel});render();if(!config.localFixtureWallet)void wallet.restore();
 }catch(e){app.innerHTML=`<main style="padding:40px"><h1>Запуск через кошелёк</h1><p>${escape(e.message)}</p><p>Нужна подготовленная среда запуска. Проверьте локальный сервер конфигурации.</p></main>`;}
}
boot();
