import {language,localized} from '../monitor-alerts/language.mjs';
import {escapeHtml as esc,explorer} from './catalog.mjs';
const message=(text,rows)=>({text,parse_mode:'HTML',link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:rows}});
const button=(text,url)=>({text,url});
const tr=(lang,en,ru,zh)=>localized(lang,en,ru,zh);
export function languages(){return message('Language · Язык · 语言',[[{text:'English',callback_data:'lang:en'},{text:'Русский',callback_data:'lang:ru'},{text:'中文',callback_data:'lang:zh'}]]);}
export function menu(c,lang='en'){return message('QIANQI Hub\n\n'+tr(lang,'Choose a project:','Выбери проект:','请选择项目：'),[
 ...c.projects.map(p=>[{text:p.name+(p.name!==p.symbol?' · '+p.symbol:''),callback_data:'project:'+p.id}]),
 [button(tr(lang,'All projects','Все проекты','所有项目'),c.hub),button('@ui_uallas on X',c.authorX)],
 [{text:'Language · Язык · 语言',callback_data:'language'}]
]);}
export function card(c,id,lang='en'){
 const p=c.projects.find(p=>p.id===id);if(!p)return menu(c,lang);
 const rows=[[button(tr(lang,"Website","Сайт","网站"),p.website),button(tr(lang,"Creator on Telegram","Автор в Telegram","作者 Telegram"),p.creatorTelegram)],[button(tr(lang,"Developer on X","Разработчик в X","开发者 X"),c.authorX),button(tr(lang,"Project hub","Все проекты","项目主页"),c.hub)]];
 if(p.status==='launched')rows.push([button(tr(lang,"Buy on Pons","Открыть в Pons","在 Pons 查看"),p.buy),button(tr(lang,"Explorer","Обозреватель","区块浏览器"),explorer(p))],[{text:tr(lang,"Contract address","Адрес контракта","合约地址"),callback_data:'contract:'+p.id}]);
 for(const link of p.links??[])rows.push([button(link.label==='Chart on GeckoTerminal'?tr(lang,'Chart on GeckoTerminal','График GeckoTerminal','GeckoTerminal 图表'):link.label,link.url)]);
 rows.push([{text:tr(lang,"Find another token","К проектам","返回项目"),callback_data:'menu'}]);
 return message(`<b>${esc(p.name)}${p.name!==p.symbol?' · '+esc(p.symbol):''}</b>\n${p.status==='prelaunch'?tr(lang,"In preparation — token not deployed.","Токен готовится к выпуску.","代币准备中，尚未部署。"):tr(lang,"Launched · Robinhood Chain","Выпущен · Robinhood Chain","已发行 · Robinhood Chain")}\n\n${esc(p.descriptions?.[lang]??p.description)}\n\n${tr(lang,'Creator','Автор','作者')}: <a href="${esc(p.creatorTelegram)}">@${esc(new URL(p.creatorTelegram).pathname.slice(1))}</a>${p.contract?'\n\n'+tr(lang,'Contract','Контракт','合约')+':\n<code>'+p.contract+'</code>':''}`,rows);
}
const normalize=s=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export function search(c,input,lang='en'){
 const q=normalize(input).replace(/^\$/,'');
 if(!q||q.length>200)return menu(c,lang);
 const isAddress=/^0x/i.test(q);
 let found=isAddress?c.projects.filter(p=>p.contract?.toLowerCase()===q):c.projects.filter(p=>[p.id,p.name,p.symbol].some(v=>normalize(v)===q));
 if(!isAddress&&!found.length&&q.length>=3)found=c.projects.filter(p=>[p.id,p.name,p.symbol].some(v=>normalize(v).includes(q)));
 if(found.length===1)return card(c,found[0].id,lang);
 if(found.length)return message(tr(lang,"Several projects match. Choose one, or send the full contract address.","Найдено несколько проектов. Выбери нужный.","找到多个项目，请选择。"),[
  ...found.slice(0,15).map(p=>[{text:p.name+' · '+p.symbol,callback_data:'project:'+p.id}]),
  [{text:tr(lang,"Search again","К проектам","返回项目"),callback_data:'menu'}],
 ]);
 return message(tr(lang,"No match in our project catalog. Check the token name or paste its full contract address. I only list projects from QIANQI Hub.","Такого проекта нет в каталоге. Открой список проектов.","目录中没有该项目，请打开项目列表。"),[[button(tr(lang,"Project hub","Все проекты","项目主页"),c.hub)],[{text:tr(lang,"Search again","К проектам","返回项目"),callback_data:'menu'}]]);
}
export function contract(c,id,lang='en'){
 const p=c.projects.find(p=>p.id===id);if(!p||p.status!=='launched')return card(c,id,lang);
 return message(`<b>${esc(p.symbol)} · Robinhood Chain (4663)</b>\n\n<code>${p.contract}</code>`,[
 [{text:tr(lang,"Copy address","Копировать адрес","复制地址"),copy_text:{text:p.contract}}],
 [button(tr(lang,"Explorer","Обозреватель","区块浏览器"),explorer(p)),{text:tr(lang,'Back to ','Назад к ','返回 ')+p.symbol,callback_data:'project:'+p.id}],
 ]);
}
// Reply only to private incoming messages; never enumerate users or broadcast.
export function actions(c,update,username,lang=language(update.callback_query?.from?.language_code??update.message?.from?.language_code)){
 const cb=update.callback_query,m=cb?.message??update.message;
 if(!m||m.chat?.type!=='private'||!Number.isSafeInteger(m.chat.id)||m.chat.id<=0||m.from?.is_bot&&!cb)return [];
 if(cb){
  if(cb.from?.id!==m.chat.id||typeof cb.data!=='string')return [];
  const [kind,id]=cb.data.split(':');
  const reply=kind==='language'?languages():kind==='lang'?menu(c,language(id)):kind==='contract'?contract(c,id,lang):kind==='project'?card(c,id,lang):menu(c,lang);
  return [{method:'answerCallbackQuery',body:{callback_query_id:cb.id}},{method:'sendMessage',body:{chat_id:m.chat.id,...reply}}];
 }
 if(typeof m.text!=='string')return [];
 const match=/^\/(\w+)(?:@([\w]+))?(?:\s+([a-z0-9-]+))?\s*$/i.exec(m.text);
 if(match?.[2]&&match[2].toLowerCase()!==username.toLowerCase())return [];
 const command=match?.[1]?.toLowerCase(),id=command==='start'?match?.[3]:command;
 const reply=command==='language'?(match?.[3]&&['en','ru','zh'].includes(match[3])?menu(c,match[3]):languages()):c.projects.some(p=>p.id===id)?card(c,id,lang):['start','help','projects'].includes(command)?menu(c,lang):search(c,m.text,lang);
 return [{method:'sendMessage',body:{chat_id:m.chat.id,...reply}}];
}
