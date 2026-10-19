import './pw-owner.css';
import {formatEther} from 'ethers';
const app=document.querySelector('#app');
const labels={vault:'Фонд холдеров',draw:'Розыгрыш',splitter:'Распределение комиссий',collector:'Сбор комиссий',launch:'Токен в Pons',bindCollector:'Подключение токена',bindVault:'Подключение фонда',bindSplitter:'Подключение комиссий',bindSchedule:'Начало периода'};
const stages={'not-prepared':'План ещё не подготовлен',prepared:'Готов к следующему шагу',pending:'Транзакция сохранена',failed:'Нужен разбор неудачной транзакции','awaiting-finality':'Ожидаем финализацию',deployed:'Запуск завершён'};
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let config,state,quote,busy=false,notice='';
async function api(action,body={}){
 const r=await fetch('/api/pw-owner/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const v=await r.json();if(!r.ok)throw Error(v.error);return v;
}
const eth=x=>formatEther(x??'0')+' ETH';
function render(){
 if(!config){app.textContent=notice||'Загрузка…';return;}
 const s=state??{stage:'not-prepared',steps:[],history:[]},done=s.history.length,pending=s.pending;
 app.innerHTML=`<main><header><div><p class="eyebrow">Платформа · Запуск</p><h1>${escape(config.name)}</h1><p>${escape(config.symbol||'Тикер не задан')} · ETH · Robinhood Chain</p></div><span class="badge">${config.mode==='preview'?'Демонстрация':config.sendEnabled?'Отправка включена':'Подготовка'}</span></header>
 <section class="summary"><div><small>Комиссия создателя</small><strong>3%</strong></div><div><small>Холдеры / розыгрыш / проект</small><strong>60 / 20 / 20</strong></div><div><small>Период</small><strong>30 дней</strong></div></section>
 <section><h2>${escape(stages[s.stage]||s.stage)}</h2><p class="address">Владелец <code>${escape(config.owner)}</code></p>${s.token?`<p class="address">Токен <code>${escape(s.token)}</code></p>`:''}
 <ol class="steps">${Object.entries(labels).map(([kind,label],i)=>`<li class="${i<done?'done':i===done?'current':''}"><span>${i+1}</span><div>${label}<small>${i<done?'Подтверждено':pending?.kind===kind?'Сохранено, проверьте отправку':i===done?'Следующий шаг':'Ожидает'}</small></div></li>`).join('')}</ol>
 ${s.stage==='not-prepared'?'<button data-action="prepare">Подготовить план</button>':''}
 ${s.stage==='prepared'?'<button data-action="quote">Рассчитать следующий шаг</button>':''}
 ${pending?`<div class="review"><h3>${escape(labels[pending.kind])}</h3><p>Подписанная транзакция сохранена. При повторе используются те же байты.</p><code>${escape(pending.hash)}</code><div class="actions"><button data-action="broadcast" ${!config.sendEnabled?'disabled':''}>Отправить сохранённую</button><button data-action="resolve" class="secondary">Проверить результат</button></div></div>`:''}
 ${s.stage==='awaiting-finality'?'<button data-action="resolve">Проверить финализацию</button>':''}
 ${s.stage==='deployed'?'<p>Токен создан. Регистрация и включение обслуживания выполняются отдельно через оператор.</p>':''}
 ${quote?`<div class="review"><h3>${escape(labels[quote.kind])}</h3><dl><dt>Максимум за этот шаг</dt><dd>${eth(quote.maximumNativeCost)}</dd><dt>Лимит всего запуска</dt><dd>${eth(quote.totalNativeLimit)}</dd><dt>Номер транзакции</dt><dd>${quote.request.nonce}</dd></dl><p>Подпись сохранит транзакцию в журнале. Отправка — отдельной кнопкой.</p><label><input id="confirm" type="checkbox"> Подтверждаю этот шаг и указанную стоимость</label><button id="sign" data-action="sign" disabled>Подписать и сохранить</button>${!config.signingEnabled?'<p>Подпись выключена или keystore владельца не подключён.</p>':''}</div>`:''}
 <div class="actions"><button data-action="status" class="secondary">Обновить журнал</button></div>
 ${s.rpcBudget?.used!==undefined?`<p class="muted">RPC: использовано ${s.rpcBudget.used} из ${s.rpcBudget.maxRequests}. Последнее наблюдение; обновление журнала не опрашивает сеть.</p>`:''}
 <p id="notice" role="status">${escape(notice)}</p></section>
 <details><summary>История транзакций · ${done}</summary>${s.history.map(h=>`<p>${escape(labels[h.kind])} · блок ${h.blockNumber}<code>${escape(h.hash)}</code></p>`).join('')||'<p>Пока пусто.</p>'}</details></main>`;
 app.querySelectorAll('button').forEach(b=>{if(busy)b.disabled=true;b.onclick=()=>act(b.dataset.action);});
 app.querySelector('#confirm')?.addEventListener('change',e=>{app.querySelector('#sign').disabled=busy||!e.target.checked||!config.signingEnabled;});
}
async function act(action){
 if(busy)return;busy=true;notice='Выполняется…';render();
 try{
  const value=await api(action,action==='sign'?{reviewId:quote.reviewId}:action==='broadcast'?{hash:state.pending.hash}:{});
  if(action==='quote')quote=value;else{state=value;quote=null;}
  notice=action==='sign'?'Подпись сохранена. Отправка ещё не выполнена.':action==='broadcast'?'Запрос отправлен. Проверьте результат.':'Готово.';
 }catch(e){notice=e.message;quote=null;}finally{busy=false;render();}
}
async function boot(){try{const r=await fetch('/api/pw-owner/config');if(!r.ok)throw Error('Локальный сервер PW недоступен.');config=await r.json();state=await api('status');render();}catch(e){notice=e.message;render();}}
void boot();
