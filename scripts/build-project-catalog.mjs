import {readFile,writeFile} from 'node:fs/promises';
import {loadCatalog,hubCards,escapeHtml} from '../server/project-bot/catalog.mjs';
const c=await loadCatalog(),check=process.argv.includes('--check');
async function update(file,transform){const before=await readFile(file,'utf8'),after=transform(before);if(before!==after){if(check)throw Error('Catalog output is stale: '+file);await writeFile(file,after);} }
function section(s,name,body){const start=`<!-- ${name}:start -->`,end=`<!-- ${name}:end -->`,a=s.indexOf(start),b=s.indexOf(end);if(a<0||b<a)throw Error('Missing catalog markers');return s.slice(0,a+start.length)+body+s.slice(b);}
await update('tokens/hub/site/index.html',s=>section(s,'catalog','\n'+hubCards(c)+'\n'));
const p=c.projects.find(p=>p.id==='igw');
await update('tokens/IGW/site/index.html',s=>section(s,'project-copy',`<p>${escapeHtml(p.description)}</p><p class="muted">${escapeHtml(p.story)}</p>`)
 .replace(/(<meta name="description" content=")[^"]*/,(_,a)=>a+escapeHtml(p.description))
 .replace(/(<meta property="og:description" content=")[^"]*/,(_,a)=>a+escapeHtml(p.description)));
console.log(check?'Catalog outputs match':'Catalog outputs generated');
