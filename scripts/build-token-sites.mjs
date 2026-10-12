import {readFile,writeFile,mkdir,cp,access,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {footer,draws,validate,escape} from '../src/site-kit/render.mjs';

// First migration: existing shells are inputs; only owned component regions change.
// The QIANQI base is an explicit public static capture, never vendor or live source.
const root=resolve('.local/token-sites');
const catalog=JSON.parse(await readFile('tokens/hub/site/projects.json','utf8'));
const baseline=resolve(process.env.QIANQI_PUBLIC_SITE_BASE||'.local/qianqi-front-review/site');
function replaceOnce(html,pattern,replacement){let count=0;const out=html.replace(pattern,()=>{count++;return replacement;});if(count!==1)throw Error('Site shell changed: expected one component, got '+count);return out;}
const sources={};
async function source(file){const text=await readFile(file,'utf8');sources[file]=createHash('sha256').update(text).digest('hex');return text;}
for(const id of ['qianqi','igw']){
 const config=validate(JSON.parse(await source(`tokens/${id.toUpperCase()}/site.config.json`)));
 if(config.project!==id)throw Error('Project/config mismatch');
 const project=catalog.projects.find(p=>p.id===id);if(!project)throw Error('Missing catalog project');
 const output=join(root,id);await mkdir(output,{recursive:true});
 if(id==='qianqi'){
  await access(join(baseline,'app.js'));
  // Explicit public files only. No archives, state, keys, logs or manifests.
  for(const file of ['assets','locales','notices','transparency','evidence','concepts','app.js','overview.js','i18n.js','i18n.css','robots.txt','sitemap.xml','llms.txt','404.html','404.css'])await cp(join(baseline,file),join(output,file),{recursive:true});
  await cp('tokens/QIANQI/site-overrides',output,{recursive:true});
 }else await cp('tokens/IGW/site',output,{recursive:true});
 let html=await source(id==='qianqi'?'tokens/QIANQI/site-overrides/index.html':'tokens/IGW/site/index.html');
 const generatedFooter=footer(project,config,catalog);
 if(id==='qianqi'){
  html=replaceOnce(html,/<footer class="site-footer">[\s\S]*?<\/dialog>/,generatedFooter);
  html=replaceOnce(html,/<div class="draw-dashboard" id="draws">[\s\S]*?(?=\s*<p id="overview-status")/,draws(config)+'\n');
  html=html.replace('/footer.js','/site-kit/footer.js');
  html=html.replace('/assets/mouse-thinking.png',escape(config.art.hero.src));
 }else{
  html=replaceOnce(html,/<footer class="wrap">[\s\S]*?<\/dialog>/,generatedFooter);
  const originalCard=/<div class="draw-card">[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/.exec(html)?.[0];
  if(!originalCard)throw Error('IGW draw shell changed');
  const facts=/<div class="draw-facts">[\s\S]*?(?=<a class="button)/.exec(originalCard)?.[0];
  const note=/<p class="card-note">[\s\S]*?<\/p>/.exec(originalCard)?.[0];
  if(!facts||!note)throw Error('Missing proposed rules');
  html=html.replace(originalCard,draws(config)+`<p id="kit-draw-state" class="kit-data-state" role="status">Checking launch status…</p><details class="kit-proposals"><summary>Draw rules</summary>${facts}${note}</details></div></section>`);
  html=replaceOnce(html,/<!-- project-copy:start -->[\s\S]*?<!-- project-copy:end -->/,`<!-- project-copy:start --><p>${escape(project.description)}</p>${project.story?'<p class="muted">'+escape(project.story)+'</p>':''}<!-- project-copy:end -->`);
  html=html.replace(/\/assets\/hero.webp\?art=20261011b/g,escape(config.art.hero.src)).replace('/assets/footer.webp?art=20261011b',escape(config.art.footer.src));
  const site=await source('tokens/IGW/site/site.js');
  if(!site.includes('const contactDialog ='))throw Error('Contact source changed');
  await writeFile(join(output,'site.js'),site.slice(0,site.indexOf('const contactDialog =')));
  await writeFile(join(output,'live.js'),await source('tokens/IGW/site/live.js'));
  html=html.replace('<script src="/wallet.js', '<script src="/site-kit/footer.js" defer></script><script src="/site-kit/draws.js" defer></script>\n <script src="/wallet.js');
 }
 html=html.replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*/g,(_,prefix)=>prefix+escape(project.description));
 html=html.replace(/(<link rel="canonical" href=")[^"]*/,(_,prefix)=>prefix+escape(project.website));
 html=html.replace('<body',`<body data-site-theme="${id}"`).replace('</head>','<link rel="stylesheet" href="/site-kit/site.css"><link rel="stylesheet" href="/site-kit/theme.css">\n</head>');
 const hero=id==='igw'?'.hero-art':'.mascot-scene img',foot=id==='igw'?'.outro img':'.kit-footer-mascot';
 const palette=id==='igw'?`--bg:${config.theme.background};--paper:${config.theme.foreground};--red:${config.theme.accent};`:`--paper:${config.theme.background};--ink:${config.theme.foreground};--orange:${config.theme.accent};`;
 const theme=`:root{${palette}--kit-bg:${config.theme.background};--kit-fg:${config.theme.foreground};--kit-accent:${config.theme.accent};--kit-mascot-size:${config.footer.mascotWidth}px;--kit-mascot-mobile:${config.footer.mascotMobileWidth}px}\n${hero}{object-position:${config.art.hero.position}}${foot}{object-position:${config.art.footer.position}}\n@media(max-width:760px){${hero}{object-position:${config.art.hero.mobilePosition}}${foot}{object-position:${config.art.footer.mobilePosition}}`;
 for(const art of Object.values(config.art))await access(join(output,art.src.slice(1)));
 await mkdir(join(output,'site-kit'),{recursive:true});
 for(const file of ['footer.js','draws.js','site.css'])await cp('src/site-kit/'+file,join(output,'site-kit',file));
 await writeFile(join(output,'site-kit/theme.css'),theme);
 await writeFile(join(output,'index.html'),html);
 console.log(id+': '+output);
}
const outputs={};
async function hashTree(dir,prefix){for(const entry of await readdir(dir,{withFileTypes:true})){const file=join(dir,entry.name),key=prefix+'/'+entry.name;if(entry.isDirectory())await hashTree(file,key);else outputs[key]=createHash('sha256').update(await readFile(file)).digest('hex');}}
for(const id of ['qianqi','igw'])await hashTree(join(root,id),id);
await writeFile(join(root,'build.json'),JSON.stringify({schema:'token-site-build-v1',createdAt:new Date().toISOString(),baseline,sources,outputs},null,2)+'\n');
