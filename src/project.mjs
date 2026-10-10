import './style.css';
import './project.css';
import {formatUnits} from 'ethers';
import {ipfsUri} from './pons/validation.mjs';
const app=document.querySelector('#app');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=value=>{try{return formatUnits(BigInt(value),6).replace(/\.0$/,'');}catch{return '—';}};
const time=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('ru-RU'):'—';};
let saved,offline=false,busy=false;
const statusText={paused:'Обслуживание приостановлено',blocked:'Обслуживание требует проверки',busy:'Исполнитель занят',waiting:'Ожидание условий или подтверждения',confirmed:'Операция подтверждена','already-confirmed':'Операция подтверждена',idle:'Обслуживание работает',unavailable:'Обслуживание ещё не подключено'};
function render(){
 if(!saved){app.innerHTML='<main class="token-page"><h1>Проект недоступен</h1><p>Проверьте адрес сайта или повторите позже.</p><button id="retry" class="button secondary">Повторить</button></main>';document.querySelector('#retry').onclick=refresh;return;}
 const {project,modules}=saved;document.title=project.display_name+' · Launchpad';
 const first=modules.find(m=>m.snapshot)?.snapshot;let image='';
 try{const uri=ipfsUri(first?.metadata.logo??'');image=`<img class="token-logo" src="https://dbk-vercel.vercel.app/api/ipfs/content/${escape(uri.slice(7))}" alt="" referrerpolicy="no-referrer">`;}catch{}
 app.innerHTML=`<main class="token-page"><header class="token-heading">${image}<div><p class="eyebrow">${escape(project.slug)} · USDG</p><h1>${escape(project.display_name)}</h1><p>${escape(first?.metadata.symbol??'')}</p></div></header>
 <p>${escape(first?.metadata.description??'')}</p><div class="token-address"><span>Контракт токена · сеть ${escape(project.chain_id)}</span><code>${escape(project.token_address)}</code></div>
 <p class="token-notice" ${offline?'role="alert"':''}>${offline?'Не удалось обновить данные. Ниже — последний полученный снимок.':'Данные обновляются после окончательного подтверждения блоков. Покупка может получить билеты с задержкой.'}</p>
 ${modules.length?modules.map(module).join(''):'<section class="result-box"><h2>Программа готовится</h2><p>Публичные данные розыгрыша пока не подключены.</p></section>'}
 <footer><button id="refresh" class="button secondary">Обновить</button><p>Розыгрыш проводится при выполнении условий. Победителя может не быть; неразыгранные средства остаются в фонде.</p></footer></main>`;
 document.querySelector('#refresh').onclick=refresh;
}
function module(m){
 const s=m.snapshot,problem=offline||m.stale||m.service.stale||m.service.projectionFailed||['blocked','paused','unavailable'].includes(m.service.status);
 const service=statusText[m.service.status]??'Состояние уточняется';
 if(!s)return `<section class="result-box"><h2>Розыгрыш готовится</h2><p>${escape(service)}</p><p>Первого подтверждённого снимка ещё нет.</p></section>`;
 const due=Number(s.nextEligibleAt)*1000,remaining=Math.max(0,Math.ceil((due-Date.now())/60000));
 const draw=s.draw?(s.draw.settled?(BigInt(s.draw.awardedRaw)>0n?`Разыграно ${amount(s.draw.awardedRaw)} USDG`:'Завершён без победителя'):'Результат ещё определяется'):'Первый розыгрыш ещё не проводился';
 return `<section class="token-module"><p class="token-status ${problem?'is-warning':''}">${problem?'Данные требуют внимания · ':''}${escape(service)}</p>
 <div class="token-metrics"><article><span>Свободный призовой фонд</span><strong>${amount(s.fundRaw)} <small>USDG</small></strong><p>Для розыгрыша нужно от ${amount(s.settings.minimumFundRaw)} USDG</p></article>
 <article><span>Ближайшее время допуска</span><strong>${m.stale||offline?'Снимок устарел':remaining?`Через ≈ ${Math.floor(remaining/60)} ч ${remaining%60} мин`:s.checkpoint.timestamp*1000<due?'Ожидаем подтверждения времени':'Интервал выдержан'}</strong><p>${time(due)} · остальные условия тоже должны выполняться</p></article>
 <article><span>Последний розыгрыш ${s.draw?'№ '+escape(s.draw.cycle):''}</span><strong class="token-result">${escape(draw)}</strong><p>${s.draw?`Фонд розыгрыша: ${amount(s.draw.budgetRaw)} USDG · `:''}Обязательства к выплате: ${amount(s.liabilitiesRaw)} USDG</p></article></div>
 <div class="token-columns"><section class="result-box"><h2>Условия участия</h2><dl><dt>Один билет</dt><dd>За ${amount(s.settings.thresholdRaw)} USDG подтверждённых покупок</dd><dt>Интервал</dt><dd>${escape(s.settings.intervalSeconds/3600)} ч от завершения предыдущего розыгрыша</dd><dt>Призовых мест</dt><dd>${s.settings.weights.length}</dd><dt>Веса призов</dt><dd>${escape(s.settings.weights.join(' : '))}</dd><dt>Creator fee</dt><dd>${escape(s.settings.creatorFeeBps/100)}%</dd><dt>Распределение дохода</dt><dd>${s.settings.splitBps.map(x=>escape(x/100)+'%').join(' / ')} — фонд / команда / обслуживание</dd></dl></section>
 <section class="result-box"><h2>Подтверждённые билеты</h2><dl><dt>Начислено за всё время</dt><dd>${escape(s.tickets.totalIssued)}</dd><dt>Адресов с подтверждёнными покупками</dt><dd>${escape(s.tickets.wallets)}</dd><dt>Распознанных покупок ждут регистрации</dt><dd>${escape(s.tickets.awaitingRecognition)}</dd></dl><p>Это общие начисления, включая использованные билеты. Поздние подтверждения не меняют состав уже начатого розыгрыша.</p></section></div>
 <p class="token-checkpoint">Снимок: ${time(m.observedAt)} · блок ${escape(s.checkpoint.number)} от ${time(s.checkpoint.timestamp*1000)}. Отставание индекса от finalized: ${Math.max(0,s.finalized.number-s.checkpoint.number)} блоков.</p><details><summary>Контракт программы</summary><code>${escape(m.program)}</code></details></section>`;
}
async function refresh(){
 if(busy)return;busy=true;
 try{
  const [p,v]=await Promise.all([fetch('/api/project',{cache:'no-store'}),fetch('/api/short',{cache:'no-store'})]);if(!p.ok||(!v.ok&&v.status!==404))throw Error();
  const {project}=await p.json(),view=v.status===404?{modules:[]}:await v.json();saved={project,modules:view.modules};offline=false;
 }catch{offline=true;}finally{busy=false;render();}
}
refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);
