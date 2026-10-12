// New-token presentation adapter. QIANQI keeps its existing overview reader.
(() => {
 const dashboard=document.querySelector('[data-draw-adapter="draw-v2"]');if(!dashboard)return;
 const status=document.querySelector('#kit-draw-state');
 const initial=dashboard.innerHTML;
 const node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const amount=value=>{if(!/^(0|[1-9]\d*)$/.test(String(value)))throw Error('Invalid amount');const n=BigInt(value);return(n/1000000n).toLocaleString('en-US')+(n%1000000n?'.'+(n%1000000n).toString().padStart(6,'0').replace(/0+$/,''):'');};
 document.addEventListener('token-site-draws',event=>{
  const data=event.detail;
  if(!data||data.state!=='confirmed'){
   // Clear previous balances on loss of project identity or unavailable data.
   dashboard.innerHTML=initial;
   if(data?.state!=='prelaunch'){
    dashboard.querySelector('#draw-history').textContent='Confirmed results are temporarily unavailable.';
    dashboard.querySelectorAll('.upcoming-card p:not(.upcoming-bank)').forEach(n=>n.textContent='Waiting for confirmed data');
   }
   status.textContent=data?.state==='prelaunch'?'Waiting for confirmed draw data. This page updates automatically.':'Updates unavailable. Missing numbers do not mean empty pools.';
   return;
  }
  try{
   const results=document.createDocumentFragment(),cards=document.createDocumentFragment();
   let delayed=false,seen=0;
   for(const m of data.modules){
    const s=m.snapshot;if(!s)continue;
    if(!['short','monthly'].includes(s.kind)||s.settings?.asset!=='USDG'||s.settings?.decimals!==6)throw Error();
    const age=Date.now()-Date.parse(m.observedAt);
    const stale=m.stale||m.service?.stale||m.service?.projectionFailed||['blocked','paused','unavailable'].includes(m.service?.status)||!Number.isFinite(age)||age>120000||age< -30000;
    delayed ||= stale;seen++;
    const label=s.kind==='short'?'Short':'Monthly',card=node('article','', 'upcoming-card');
    card.append(node('h4',label));const bank=node('p','', 'upcoming-bank');bank.append(node('strong',amount(s.fundRaw)),document.createTextNode(' USDG'));card.append(bank,node('p','Available prize pool'));
    card.append(node('p',stale?'Delayed snapshot. Not a live balance.':s.draw&&!s.draw.settled?'Draw in progress':'Waiting for draw conditions'));
    if(!stale&&/^\d+$/.test(String(s.nextEligibleAt))){const date=new Date(Number(s.nextEligibleAt)*1000);if(!Number.isFinite(date.getTime()))throw Error();card.append(node('p','Not before '+date.toISOString().replace('T',' ').replace('.000Z',' UTC')+' · may start later'));}
    cards.append(card);
    if(s.draw){
     const row=node('article','', 'kit-result');
     row.append(node('h4',label+' · '+(s.draw.settled?'Completed draw':'Draw in progress')));
     row.append(node('strong',amount(s.draw.awardedRaw)+' USDG awarded'));
     row.append(node('p','Draw pool: '+amount(s.draw.budgetRaw)+' USDG'));
     row.append(node('p','Awarded prizes and completed payments are separate. Check your wallet for your reward.'));results.append(row);
    }
   }
   dashboard.querySelector('#kit-upcoming').replaceChildren(cards);
   dashboard.querySelector('#draw-history').replaceChildren(results);
   dashboard.querySelector('#history-heading').textContent='Latest available results';
   if(!dashboard.querySelector('#draw-history').children.length)dashboard.querySelector('#draw-history').textContent='No confirmed draw results available yet.';
   if(!seen)dashboard.querySelector('#kit-upcoming').textContent='No confirmed prize snapshot available.';
   status.textContent=delayed?'Updates delayed. Showing the last confirmed snapshot.':seen?'Confirmed snapshot · USDG. Results shown here are the latest available per draw program.':'Waiting for the first confirmed snapshot.';
  }catch{document.dispatchEvent(new CustomEvent('token-site-draws',{detail:{state:'unavailable'}}));}
 });
})();
