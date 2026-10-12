import {readFile} from 'node:fs/promises';

export const catalogFile=new URL('../../tokens/hub/site/projects.json',import.meta.url);
const check=(v,m)=>{if(!v)throw Error(m);};
const text=v=>typeof v==='string'&&v.length>0&&v.length<=1000;
const https=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}};
export const escapeHtml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function validateCatalog(c){
 check(c?.schema==='project-catalog-v1'&&https(c.hub)&&https(c.authorX),'Invalid catalog');
 check(c.botUsername===null||/^[a-zA-Z0-9_]{5,32}bot$/i.test(c.botUsername),'Invalid bot username');
 check(Array.isArray(c.projects)&&c.projects.length>0,'Invalid projects');
 const ids=new Set();
 for(const p of c.projects){
  check(/^[a-z][a-z0-9-]{0,30}$/.test(p.id)&&!ids.has(p.id),'Duplicate/invalid project ID');ids.add(p.id);
  check(text(p.name)&&text(p.symbol)&&text(p.description)&&https(p.website)&&p.chainId===4663,'Invalid project details');
  check(/^https:\/\/t\.me\/[a-zA-Z0-9_]{5,32}$/.test(p.creatorTelegram),'Invalid creator contact');
  check(p.links===undefined||(Array.isArray(p.links)&&p.links.length<=12&&p.links.every(l=>text(l.label)&&https(l.url))),'Invalid project links');
  check(['launched','prelaunch'].includes(p.status),'Invalid project status');
  if(p.status==='prelaunch')check(p.contract===null&&p.buy===null,'Prelaunch trading links prohibited');
  else check(/^0x[0-9a-f]{40}$/i.test(p.contract)&&https(p.buy)&&new URL(p.buy).pathname.toLowerCase().includes(p.contract.toLowerCase()),'Invalid launch links');
  check(p.story===undefined||text(p.story),'Invalid story');
  check(p.art&&/^[a-z0-9-]+$/.test(p.art.class),'Invalid project artwork');
  if(p.art.image)check(/^\/hub-assets\/[a-z0-9-]+\.(webp|png)$/.test(p.art.image)&&text(p.art.alt),'Invalid artwork path');
 }
 return c;
}
export async function loadCatalog(file=catalogFile){return validateCatalog(JSON.parse(await readFile(file,'utf8')));}
export const explorer=p=>p.contract?'https://robinhoodchain.blockscout.com/token/'+p.contract:null;

export function hubCards(c){return c.projects.map(p=>`<article class="project"><div class="art ${p.art.class}">${p.art.image?`<img src="${escapeHtml(p.art.image)}" width="1400" height="470" alt="${escapeHtml(p.art.alt)}">`:''}</div><div class="project-content"><div class="project-title"><h3>${escapeHtml(p.symbol)}</h3><span class="badge">USDG draws</span></div><p>${escapeHtml(p.description)}</p><a class="project-link" href="${escapeHtml(p.website)}">Visit website</a></div></article>`).join('\n');}
