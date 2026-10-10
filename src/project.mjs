import './style.css';
const app=document.querySelector('#app'),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function show(){try{
 const r=await fetch('/api/project');if(!r.ok)throw Error();const {project,modules}=await r.json();
 document.title=project.display_name+' · Launchpad';
 app.innerHTML=`<main style="max-width:900px;margin:70px auto;padding:30px"><p class="eyebrow">${escape(project.slug)} · ТЕСТОВАЯ СЕТЬ</p><h1>${escape(project.display_name)}</h1><div class="result-box"><p>Токен / USDG</p><code>${escape(project.token_address)}</code></div><h2>Программа розыгрышей</h2>${modules.map(m=>`<article class="result-box"><p>${m.kind==='short'?'Регулярный розыгрыш':'Розыгрыш'}</p><code>${escape(m.program_address)}</code></article>`).join('')}<p>Это страница локальной репетиции. Контракты и билеты проекта обслуживаются общим бэком и отделены от других токенов.</p></main>`;
 }catch{app.innerHTML='<main style="padding:40px"><h1>Проект недоступен</h1><p>Проверьте поддомен и доступность локального стенда.</p></main>';}}
show();
