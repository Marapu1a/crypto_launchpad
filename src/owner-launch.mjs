import './style.css';
import {formatEther} from 'ethers';
import {initialDraft} from './pons/plan.mjs';
import {signReservedOwnerStep} from './pons/owner-signing.mjs';
import {publishImageOnServer} from './pons/api-client.mjs';
import {percentBps} from './pons/validation.mjs';
import {validateLaunch,UUID} from './launch/template.mjs';

const app=document.querySelector('#app'),key='launchpad:owner-launch:v1';
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let config,state,input,busy=false,notice='';
const field=(name,label,value)=>`<label class="field"><span>${label}</span><input name="${name}" value="${escape(value)}" ${name==='weights'?'':'required'}></label>`;
async function request(path,body){const response=await fetch('/api/owner-launch/'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;}
function persist(){localStorage.setItem(key,JSON.stringify({id:input.id,input,instanceId:config.instanceId}));}
async function action(kind,body={}){state=await request(input.id+'/'+kind,body);input=state.input;persist();return state;}
function render(){
 const step=state?.pending??state?.candidate;
 app.innerHTML=`<main style="max-width:1050px;margin:32px auto;padding:24px"><a href="/launch.html">Launchpad</a><p class="eyebrow">ЗАПУСК ЧЕРЕЗ КОШЕЛЁК · РЕПЕТИЦИЯ</p><h1>Токен и ежедневный розыгрыш</h1><p>Контракты для сети 4663 проверяются в изолированной копии. Каждую транзакцию подтверждает кошелёк владельца.</p><p>Владелец: <code>${escape(config.owner)}</code></p>
 <form id="owner-form"><fieldset ${busy||state?'disabled':''} style="border:0;padding:0"><div class="two">${field('name','Название',input.draft.name)}${field('symbol','Тикер',input.draft.symbol)}${field('slug','Поддомен',input.slug)}${field('logo','Картинка IPFS',input.draft.logo)}</div>
 <label class="field"><span>Картинка</span><input id="image-file" type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button" class="button secondary" id="upload">Загрузить через Pons</button><p>Торговая пара: USDG</p>
 <div class="two">${field('creatorFee','Creator fee, %',input.draft.creatorFee)}${field('openingBuy','Первая покупка, USDG',input.draft.openingBuy||'0')}${field('ticketPurchase','Покупок на билет, USDG',input.draws.ticketPurchase)}${field('minimumFund','Фонд от, USDG',input.draws.short.minimumFund)}${field('hours','Часов между розыгрышами',input.draws.short.intervalSeconds/3600)}${field('count','Призовых мест',input.draws.short.basket.weights.length)}${field('weights','Веса крупных призов',input.draws.short.basket.weights.join(':'))}${field('minimumUnit','Минимальная единица приза',input.draws.short.basket.minimumUnit)}${field('prizes','На призы, %',input.draws.fees.prizesBps/100)}${field('teamShare','Команде, %',input.draws.fees.teamBps/100)}${field('operationsShare','На обслуживание, %',input.draws.fees.operationsBps/100)}${field('team','Кошелёк команды',input.team)}${field('operations','Кошелёк обслуживания',input.operations)}</div><p>Недостающие веса заполняются единицами. Победителя может не быть; фонд переносится.</p><button class="button primary" type="submit">Проверить и сохранить запуск</button></fieldset></form>
 ${!state?'<details><summary>Продолжить запуск по ID</summary><input id="resume-id" placeholder="ID сохранённого запуска"><button id="resume" type="button" class="button secondary">Загрузить с сервера</button></details>':''}
 <p id="notice" role="status">${escape(notice)}</p>
 ${state?`<section><h2>${state.stage==='registered'?'Проект зарегистрирован':'Продолжение запуска'}</h2><p>ID: <code>${state.id}</code></p><p>Потрачено: ${formatEther(state.spent)} ETH. Лимит всего запуска: ${formatEther(state.profile.totalNativeLimit)} ETH.</p><p>Газ для исполнителя: ${formatEther(state.profile.funding.executor)} ETH; для подтверждения покупок: ${formatEther(state.profile.funding.publisher)} ETH.</p><p>План хранится на сервере. После закрытия страницы продолжится этот же запуск.</p>
 ${step?`<div class="result-box"><h3>${escape(step.label??step.kind)}</h3><p>${step.request.to?'Получатель: '+escape(step.request.to):'Создание контракта'}</p><p>Сумма: ${formatEther(step.request.value)} ETH · максимум gas: ${formatEther(BigInt(step.request.gasLimit)*BigInt(step.request.gasPrice))} ETH</p><p>Nonce: ${step.request.nonce}</p>${state.candidate?'<button id="sign" class="button primary">Подтвердить этот шаг в кошельке</button>':`<p>Ожидает ${step.hash?'окончательного подтверждения':'результата запроса кошельку'}</p>${step.hash?`<code>${escape(step.hash)}</code>`:'<label class="field"><span>Hash из кошелька</span><input id="recover-hash"></label><button id="attach" class="button secondary">Проверить отправку</button><button id="retry" class="button secondary">Повторить тот же запрос подписи</button>'}`}</div>`:''}
 <button id="refresh" class="button secondary">Обновить состояние</button><ol>${state.history.map(h=>`<li>${escape(h.label??h.kind)} · <code>${escape(h.hash)}</code> · подтверждён</li>`).join('')}</ol>${state.launch?`<p>Токен: <code>${escape(state.launch.token)}</code></p>`:''}${state.stage==='registered'?'<p>Проект подключён к журналу исполнителя. Постоянное обслуживание и публичный сайт включаются отдельно.</p>':''}</section>`:''}
 <details><summary>Параметры стенда и сборки</summary><pre>${escape(JSON.stringify({build:config.buildHash,timing:config.profile.timing,limits:config.profile.limits,instance:config.instanceId},null,2))}</pre></details></main>`;
 app.querySelectorAll('button').forEach(button=>{if(busy)button.disabled=true;});
 const work=async fn=>{if(busy)return;busy=true;render();try{await fn();}catch(e){notice=e.code===4001?'Подпись отклонена. Можно повторить тот же сохранённый запрос.':e.message;}finally{busy=false;render();}};
 document.querySelector('#resume')?.addEventListener('click',()=>{const id=document.querySelector('#resume-id').value.trim();return work(async()=>{if(!UUID.test(id))throw Error('Неверный ID запуска');state=await request(id+'/next',{});input=state.input;persist();notice='Запуск восстановлен из серверного журнала';});});
 document.querySelector('#owner-form').onsubmit=event=>{
  event.preventDefault();const data=new FormData(event.target),v=n=>String(data.get(n));
  return work(async()=>{
   for(const k of ['name','symbol','logo','creatorFee','openingBuy'])input.draft[k]=v(k);input.slug=v('slug');input.team=v('team');input.operations=v('operations');
   input.draws.ticketPurchase=v('ticketPurchase');const short=input.draws.short;short.minimumFund=v('minimumFund');short.intervalSeconds=Number(v('hours'))*3600;short.basket.minimumUnit=v('minimumUnit');
   const count=Number(v('count')),weights=v('weights').trim()?v('weights').split(':').map(Number):[];
   if(!Number.isInteger(count)||count<1||count>64||weights.length>count)throw Error('Нужно 1–64 места, весов не больше числа мест');
   short.basket.weights=[...weights,...Array(count-weights.length).fill(1)];input.draws.fees={prizesBps:percentBps(v('prizes')),teamBps:percentBps(v('teamShare')),operationsBps:percentBps(v('operationsShare'))};
   input=validateLaunch(input);persist();await action('create',{input});notice='План сохранён. Проверьте шаг перед подписью.';
  });
 };
 document.querySelector('#upload').onclick=()=>{
  const file=document.querySelector('#image-file').files[0];
  if(!file){notice='Выберите картинку';render();return;}
  // Keep other edited fields while the upload temporarily redraws the form.
  const form=new FormData(document.querySelector('#owner-form'));
  return work(async()=>{const {publication}=await publishImageOnServer(file);input.draft.logo=publication.uri;persist();notice=publication.warning||'Картинка загружена через Pons';}).then(()=>{for(const [k,v] of form)if(k!=='logo'){const el=document.querySelector(`[name="${k}"]`);if(el)el.value=v;}});
 };
 async function sign(kind){
  if(!window.ethereum)throw Error('Подключите кошелёк');
  await window.ethereum.request({method:'eth_requestAccounts'});
  const step=state.candidate??state.pending;
  await action(kind,{requestId:step.id,...(kind==='arm'?{revision:state.revision}:{})});
  const hash=await signReservedOwnerStep(window.ethereum,state);
  // Save returned hash locally too if the acknowledgement cannot reach backend.
  localStorage.setItem(key+':hash:'+input.id,JSON.stringify({requestId:state.pending.id,hash}));
  await action('attach',{requestId:state.pending.id,hash});notice='Отправка сохранена. Следующий шаг откроется после окончательного подтверждения.';
 }
 document.querySelector('#sign')?.addEventListener('click',()=>work(()=>sign('arm')));
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
  config=await request('config');const saved=JSON.parse(localStorage.getItem(key)||'null');
  if(saved){if(saved.instanceId!==config.instanceId)throw Error('Сохранённый запуск относится к другому стенду. Сохраните его ID перед созданием нового.');input=saved.input;try{await action('next');}catch(e){notice=e.message;}}
  else input={id:crypto.randomUUID(),slug:'token-'+Date.now().toString().slice(-6),draft:{...initialDraft(),...config.defaults.draft},draws:structuredClone(config.defaults.draws),team:config.defaults.team,operations:config.defaults.operations};
  render();
 }catch(e){app.innerHTML=`<main style="padding:40px"><h1>Запуск через кошелёк</h1><p>${escape(e.message)}</p><p>Нужна подготовленная среда репетиции. Публичные отправки не включены.</p></main>`;}
}
boot();
