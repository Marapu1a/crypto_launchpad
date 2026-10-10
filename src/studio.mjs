import './style.css';
import './draws/editor.css';
import {initialDraft} from './pons/plan.mjs';
import {validateConfig} from './draws/config.mjs';
import {validateDraft,percentBps} from './pons/validation.mjs';
import {getAddress,ZeroAddress,formatUnits} from 'ethers';
const key='launchpad:studio:v1',app=document.querySelector('#app');
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let defaults,input,locked=false,completed=false;
const request=async(url,body)=>{
 const r=await fetch('/api/studio/'+url,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});
 const value=await r.json();if(!r.ok)throw Error(value.error);return value;
};
function fresh(){return {id:crypto.randomUUID(),slug:'token',draft:{...initialDraft(),name:defaults.config.name,symbol:defaults.config.symbol,logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee',pair:'0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',creatorFee:defaults.config.creatorFee,openingBuy:defaults.config.openingBuy},draws:structuredClone(defaults.config.draws),team:defaults.team,operations:defaults.operations};}
const field=(name,label,value,extra='')=>`<label class="field"><span>${label}</span><input name="${name}" value="${escape(value)}" ${extra}></label>`;
function render(){
 app.innerHTML=`<main style="max-width:1050px;margin:40px auto;padding:24px"><a href="/launch.html">Launchpad</a><p class="eyebrow">НОВЫЙ ПРОЕКТ · ЛОКАЛЬНАЯ РЕПЕТИЦИЯ</p><h1>Токен с ежедневным розыгрышем</h1><p>Создание, подключение и обслуживание в одном месте. Используются тестовые средства; основная сеть не затрагивается.</p><form id="launch-form"><fieldset ${locked?'disabled':''} style="border:0;padding:0">
 <div class="two">${field('name','Название',input.draft.name,'maxlength="32" required')}${field('symbol','Тикер',input.draft.symbol,'maxlength="10" required')}</div>
 ${field('slug','Поддомен проекта',input.slug,'pattern="[a-z][a-z0-9-]{1,38}[a-z0-9]" required')}<p class="hint">Адрес проекта: имя.localhost. Для публикации нужен отдельный настоящий домен.</p>
 ${field('logo','Картинка IPFS',input.draft.logo,'required')}<p class="hint">Для репетиции подставлен тестовый IPFS-адрес. Загрузка файла в IPFS здесь ещё не подключена.</p>
 <div class="two">${field('creatorFee','Creator fee, %',input.draft.creatorFee,'inputmode="decimal"')}${field('openingBuy','Первая покупка, USDG',input.draft.openingBuy,'inputmode="decimal"')}</div>
 <h2>Условия розыгрыша</h2><div class="two">${field('ticketPurchase','Покупок на билет, USDG',input.draws.ticketPurchase)}${field('minimumFund','Фонд от, USDG',input.draws.short.minimumFund)}${field('hours','Часов после завершения розыгрыша',input.draws.short.intervalSeconds/3600)}${field('count','Количество призовых мест',input.draws.short.basket.weights.length,'type="number" min="1" max="64" step="1"')}${field('weights','Веса крупных призов',input.draws.short.basket.weights.join(':').replace(/(?:^|:)1(?::1)*$/,''))}</div>
 <p class="hint">Первый отсчёт — от создания программы. Неуказанные веса заполняются единицами; пустое поле — поровну. Призовых мест может быть больше, чем победителей; без победителя фонд переносится.</p>
 <div class="two">${field('prizes','На призы, %',input.draws.fees.prizesBps/100)}${field('teamShare','Команде, %',input.draws.fees.teamBps/100)}${field('operationsShare','На обслуживание, %',input.draws.fees.operationsBps/100)}${field('minimumUnit','Минимальная единица приза, USDG',input.draws.short.basket.minimumUnit)}</div>
 <div class="two">${field('team','Кошелёк команды',input.team)}${field('operations','Кошелёк обслуживания',input.operations)}</div></fieldset>
 <button class="button primary" id="create" type="submit">${locked?'Продолжить этот запуск':'Создать тестовый проект'}</button> <button class="button secondary" id="new" type="button">Новый черновик</button></form><p role="status" id="notice"></p><section id="result"></section><h2>Проекты</h2><section id="projects"></section></main>`;
 document.querySelector('#new').onclick=()=>{input=fresh();input.slug='token-'+Date.now().toString().slice(-6);locked=false;completed=false;persist();render();refresh();};
 document.querySelector('#launch-form').onsubmit=async event=>{
  event.preventDefault();const button=document.querySelector('#create'),notice=document.querySelector('#notice');button.disabled=true;
  try{
   if(!locked){
    const data=new FormData(event.target),v=n=>data.get(n);
    input.slug=v('slug');for(const k of ['name','symbol','logo','creatorFee','openingBuy'])input.draft[k]=v(k);
    input.team=v('team');input.operations=v('operations');input.draws.ticketPurchase=v('ticketPurchase');
    if(getAddress(input.team)===ZeroAddress||getAddress(input.operations)===ZeroAddress)throw Error('Укажите кошельки команды и обслуживания');
    input.draws.short.minimumFund=v('minimumFund');input.draws.short.intervalSeconds=Number(v('hours'))*3600;
    const count=Number(v('count')),weights=v('weights').trim()?v('weights').split(':').map(Number):[];
    if(!Number.isInteger(count)||count<1||count>64||weights.length>count)throw Error('Нужно от 1 до 64 мест; весов не больше, чем мест');
    input.draws.short.basket={weights:[...weights,...Array(count-weights.length).fill(1)],minimumUnit:v('minimumUnit')};
    input.draws.fees={prizesBps:percentBps(v('prizes')),teamBps:percentBps(v('teamShare')),operationsBps:percentBps(v('operationsShare'))};
    validateConfig(input.draws);const check=validateDraft(input.draft,{account:input.team,requireAccount:true});if(!check.valid)throw Error(Object.values(check.errors).join('; '));
    locked=true;persist();document.querySelector('fieldset').disabled=true;
   }
   notice.textContent='Создаём и подключаем проект. Можно продолжить после перезапуска страницы.';
   const result=await request('projects',input);show(result);notice.textContent='Проект подключён. Обслуживание запущено на стенде.';refresh();
  }catch(e){notice.textContent=e.message;}
  finally{button.disabled=completed;button.textContent=completed?'Проект создан':locked?'Продолжить этот запуск':'Создать тестовый проект';}
 };
}
function persist(){localStorage.setItem(key,JSON.stringify({input,locked}));}
function show(p){
 completed=p.stage==='ready';if(completed){document.querySelector('#create').disabled=true;document.querySelector('#create').textContent='Проект создан';}
 document.querySelector('#result').innerHTML=`<div class="result-box"><strong>${escape(p.name)}</strong><p>${escape(p.stage==='ready'?'Подключён к общему бэку':p.stage)}</p><code>${escape(p.token||'Создание продолжается')}</code><p><a href="http://${escape(p.hostname)}:${location.port}/" target="_blank" rel="noopener">Открыть сайт проекта</a></p><p>Подтверждённых шагов: ${p.steps.filter(s=>s.confirmed).length}</p>${p.stage==='ready'?'<button type="button" class="button secondary" id="exercise">Проверить покупку и розыгрыш</button><p class="hint">Одна тестовая покупка на 3 119 USDG. Часы исторической копии переводятся к текущему времени. Дальше работает автоматическое обслуживание; drand может потребовать ожидания. Повтор не создаёт ещё одну покупку.</p>':''}</div>`;
 const button=document.querySelector('#exercise');if(button)button.onclick=async()=>{button.disabled=true;try{await request('projects/'+p.id+'/exercise',{});document.querySelector('#notice').textContent='Тестовая покупка выполнена. Следите за проходами обслуживания ниже.';}catch(e){document.querySelector('#notice').textContent=e.message;}finally{button.disabled=false;}};
}
async function refresh(){
 const {projects}=await request('projects');
 document.querySelector('#projects').innerHTML=projects.map(p=>`<article><strong>${escape(p.name)}</strong> · ${escape(p.stage==='ready'?'Подключён':'Создание продолжается')} · <code>${escape(p.token||'—')}</code><p>${escape(p.lastPass?.action||p.lastPass?.reason||'Ожидает первого прохода')}</p><button class="button secondary" data-project="${escape(p.id)}">Открыть</button></article>`).join('')||'<p>Пока нет проектов.</p>';
 document.querySelectorAll('[data-project]').forEach(button=>button.onclick=async()=>{const detail=await request('projects/'+button.dataset.project);input=detail.input;locked=true;completed=detail.stage==='ready';persist();render();await refresh();});
 const current=projects.find(p=>p.id===input.id);if(current){
  show(current);
  if(current.stage==='ready'){
   const {draw}=await request('projects/'+current.id);
   if(current.id!==input.id)return;
   const money=x=>Number(formatUnits(x,6)).toLocaleString('ru-RU',{maximumFractionDigits:6});
   const div=document.createElement('div');div.className='result-box';
   div.innerHTML=`<h3>${draw.cycle==='0'?'Ожидает первого розыгрыша':`Розыгрыш №${escape(draw.cycle)} · ${draw.settled?'завершён':'в работе'}`}</h3><p>Свободный фонд: ${money(draw.freeFundRaw)} USDG</p>${draw.settled?`<p>Назначено: ${money(draw.awardedRaw)} USDG. ${draw.prizes.length?'':'Победителя нет — фонд перенесён.'}</p>`:''}${draw.prizes.map(p=>`<p><code>${escape(p.wallet)}</code> · ${money(p.amountRaw)} USDG · ${p.paid?'выплачено':'ожидает выплаты'}</p>`).join('')}<p class="hint">Следующий розыгрыш разрешён после ${new Date(draw.nextAt*1000).toLocaleString('ru-RU')} при выполнении условий фонда и участия.</p>`;
   document.querySelector('#result').append(div);
  }
 }
}
async function boot(){try{
 const existing=await request('projects');defaults=existing.defaults;
 try{const saved=JSON.parse(localStorage.getItem(key));if(!saved?.input?.id)throw Error();input=saved.input;locked=saved.locked;}catch{
  if(existing.projects.length){const detail=await request('projects/'+existing.projects.at(-1).id);input=detail.input;locked=true;}else input=fresh();
 }
 render();await refresh();setInterval(()=>refresh().catch(()=>{}),5000);
}catch{app.innerHTML='<main style="padding:40px"><h1>Нужен локальный стенд</h1><p>Запустите npm run studio и откройте адрес из консоли. Эта страница не отправляет транзакции в основную сеть.</p></main>';}}
boot();
