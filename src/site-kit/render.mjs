// Static components: no wallet, transaction or financial decisions here.
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeLink(value) {
  if (typeof value !== 'string' || !/^(https:\/\/|mailto:|\/(?!\/)|#[a-z])/i.test(value) || /[\s\\]/.test(value)) throw Error('Unsafe site link');
  return escape(value);
}
function link(label, url) {
  return `<a href="${safeLink(url)}"${url.startsWith('https:')?' target="_blank" rel="noopener noreferrer"':''}>${escape(label)}</a>`;
}
export function footer(project, config, catalog) {
  const f=config.footer;
  const contacts=[['Telegram',project.creatorTelegram],['Email',f.email],['X',catalog.authorX]].filter(([,url])=>url);
  const mascot=f.mascot?`<img class="kit-footer-mascot" src="${safeLink(config.art.footer.src)}" width="${f.mascotWidth}" height="${f.mascotWidth}" alt="" loading="lazy" decoding="async">`:'';
  return `<footer class="kit-footer" data-site-component="footer">
 <div class="wrap kit-footer-main"><div class="kit-footer-identity">${mascot}<div><a class="kit-footer-brand" href="#">${escape(project.symbol)}${f.wordmark?` <span lang="zh-Hant">${escape(f.wordmark)}</span>`:''}</a><p>${escape(f.signature)}</p></div></div>
 <div class="kit-footer-actions"><a href="${safeLink(catalog.hub)}">All projects</a><button type="button" class="contact-open" aria-haspopup="dialog" aria-controls="contact-dialog">Contact</button></div></div>
 <div class="wrap kit-footer-resources" role="navigation" aria-label="Project">${f.resources.map(r=>link(r.label,r.url)).join('')}</div>
 <div class="wrap kit-footer-bottom"><span translate="no">© ${escape(project.symbol)}${f.wordmark?' · '+escape(f.wordmark):''}</span><p>${escape(f.risk)}</p></div>
</footer>
<dialog class="kit-contact" id="contact-dialog" aria-labelledby="contact-title"><button type="button" class="contact-close" aria-label="Close dialog">×</button><p class="kit-contact-brand" translate="no">${escape(project.name)}</p><h2 id="contact-title">Say hello.</h2><div class="kit-contact-links">${contacts.map(([label,url])=>`<a href="${safeLink(url)}"${url.startsWith('https:')?' target="_blank" rel="noopener noreferrer"':''}><span translate="no">${label}</span><strong translate="no">${escape(url.replace('https://t.me/','@').replace('https://x.com/','@').replace('mailto:',''))}</strong></a>`).join('')}</div></dialog>`;
}
export function draws(config) {
  const legacy=config.adapter==='qianqi-v1';
  return `<div class="draw-dashboard kit-draws" ${legacy?'id="draws"':''} data-site-component="draws" data-draw-adapter="${escape(config.adapter)}">
 <div class="past-draws"><h3 id="history-heading">Latest results</h3><div id="draw-history">${legacy?'No confirmed results loaded.':'Draw results appear here once confirmed.'}</div>
 <div class="history-navigation"><button id="history-prev" class="text-button" hidden>Newer draws</button><span id="history-page" class="small"></span><button id="history-next" class="text-button" hidden>Older draws</button></div></div>
 <div class="upcoming-draws"><h3>Coming next</h3><div id="kit-upcoming">${config.draws.map(d=>`<article class="upcoming-card"><h4>${escape(d.label)}</h4><p class="upcoming-bank"><strong id="${d.kind}-bank">—</strong> USDG</p><p id="${d.kind}-draw-state">${legacy?'Waiting for confirmed data':'Waiting for confirmed data'}</p><p id="${d.kind}-time" class="small">${escape(d.note)}</p></article>`).join('')}</div><p class="small schedule-note">All times are UTC. Start times are the earliest possible. Funding and checks must also be ready.</p></div></div>`;
}
export function validate(config) {
  if(config.schema!=='token-site-v1'||!['qianqi-v1','draw-v2'].includes(config.adapter))throw Error('Unsupported site config');
  if(!/^#[a-f\d]{6}$/i.test(config.theme.background)||!/^#[a-f\d]{6}$/i.test(config.theme.foreground)||!/^#[a-f\d]{6}$/i.test(config.theme.accent))throw Error('Invalid theme');
  if(!Number.isInteger(config.footer.mascotWidth)||config.footer.mascotWidth<40||config.footer.mascotWidth>240)throw Error('Invalid mascot size');
  if(!Number.isInteger(config.footer.mascotMobileWidth)||config.footer.mascotMobileWidth<40||config.footer.mascotMobileWidth>160)throw Error('Invalid mobile mascot size');
  const kinds=config.draws.map(d=>d.kind);
  if(!kinds.length||kinds.some(k=>!['short','monthly'].includes(k))||new Set(kinds).size!==kinds.length)throw Error('Invalid draw placeholders');
  if(config.adapter==='qianqi-v1'&&(!kinds.includes('short')||!kinds.includes('monthly')))throw Error('Existing QIANQI reader requires both programs');
  for(const art of Object.values(config.art)){if(!/^\/assets\/[a-zA-Z0-9_./-]+$/.test(art.src)||art.src.includes('..'))throw Error('Artwork must be a local asset');for(const key of ['position','mobilePosition'])if(!/^\d{1,3}% \d{1,3}%$/.test(art[key])||art[key].split(' ').some(n=>parseInt(n)>100))throw Error('Invalid art position');}
  return config;
}
