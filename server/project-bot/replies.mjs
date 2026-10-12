import {escapeHtml as esc,explorer} from './catalog.mjs';
const message=(text,rows)=>({text,parse_mode:'HTML',link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:rows}});
const button=(text,url)=>({text,url});
export function menu(c){return message('QIANQI Hub\n\nSend a token name, ticker or contract address. I’ll find its description, links and creator’s contact in our project catalog.',[
 [button('All projects',c.hub),button('@ui_uallas on X',c.authorX)],
]);}
export function card(c,id){
 const p=c.projects.find(p=>p.id===id);if(!p)return menu(c);
 const rows=[[button('Website',p.website),button('Creator on Telegram',p.creatorTelegram)],[button('Developer on X',c.authorX),button('Project hub',c.hub)]];
 if(p.status==='launched')rows.push([button('Buy on Pons',p.buy),button('Explorer',explorer(p))],[{text:'Contract address',callback_data:'contract:'+p.id}]);
 for(const link of p.links??[])rows.push([button(link.label,link.url)]);
 rows.push([{text:'Find another token',callback_data:'menu'}]);
 return message(`<b>${esc(p.name)}${p.name!==p.symbol?' · '+esc(p.symbol):''}</b>\n${p.status==='prelaunch'?'In preparation — token not deployed.':'Launched · Robinhood Chain'}\n\n${esc(p.description)}\n\nCreator: <a href="${esc(p.creatorTelegram)}">@${esc(new URL(p.creatorTelegram).pathname.slice(1))}</a>${p.contract?'\n\nContract:\n<code>'+p.contract+'</code>':''}`,rows);
}
const normalize=s=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export function search(c,input){
 const q=normalize(input).replace(/^\$/,'');
 if(!q||q.length>200)return menu(c);
 const isAddress=/^0x/i.test(q);
 let found=isAddress?c.projects.filter(p=>p.contract?.toLowerCase()===q):c.projects.filter(p=>[p.id,p.name,p.symbol].some(v=>normalize(v)===q));
 if(!isAddress&&!found.length&&q.length>=3)found=c.projects.filter(p=>[p.id,p.name,p.symbol].some(v=>normalize(v).includes(q)));
 if(found.length===1)return card(c,found[0].id);
 if(found.length)return message('Several projects match. Choose one, or send the full contract address.',[
  ...found.slice(0,15).map(p=>[{text:p.name+' · '+p.symbol,callback_data:'project:'+p.id}]),
  [{text:'Search again',callback_data:'menu'}],
 ]);
 return message('No match in our project catalog. Check the token name or paste its full contract address. I only list projects from QIANQI Hub.',[[button('Project hub',c.hub)],[{text:'Search again',callback_data:'menu'}]]);
}
export function contract(c,id){
 const p=c.projects.find(p=>p.id===id);if(!p||p.status!=='launched')return card(c,id);
 return message(`<b>${esc(p.symbol)} · Robinhood Chain (4663)</b>\n\n<code>${p.contract}</code>`,[
 [{text:'Copy address',copy_text:{text:p.contract}}],
 [button('Explorer',explorer(p)),{text:'Back to '+p.symbol,callback_data:'project:'+p.id}],
 ]);
}
// Reply only to private incoming messages; never enumerate users or broadcast.
export function actions(c,update,username){
 const cb=update.callback_query,m=cb?.message??update.message;
 if(!m||m.chat?.type!=='private'||!Number.isSafeInteger(m.chat.id)||m.chat.id<=0||m.from?.is_bot&&!cb)return [];
 if(cb){
  if(cb.from?.id!==m.chat.id||typeof cb.data!=='string')return [];
  const [kind,id]=cb.data.split(':');
  const reply=kind==='contract'?contract(c,id):kind==='project'?card(c,id):menu(c);
  return [{method:'answerCallbackQuery',body:{callback_query_id:cb.id}},{method:'sendMessage',body:{chat_id:m.chat.id,...reply}}];
 }
 if(typeof m.text!=='string')return [];
 const match=/^\/(\w+)(?:@([\w]+))?(?:\s+([a-z0-9-]+))?\s*$/i.exec(m.text);
 if(match?.[2]&&match[2].toLowerCase()!==username.toLowerCase())return [];
 const command=match?.[1]?.toLowerCase(),id=command==='start'?match?.[3]:command;
 const reply=c.projects.some(p=>p.id===id)?card(c,id):['start','help','projects'].includes(command)?menu(c):search(c,m.text);
 return [{method:'sendMessage',body:{chat_id:m.chat.id,...reply}}];
}
