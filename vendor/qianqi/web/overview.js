'use strict';
(()=>{
 const el=id=>document.getElementById(id);if(!el('overview-status'))return;
 let pageOffset=0,nextOffset=null,busy=false;
 const labels={inProgress:'Draw in progress',awaitingFunding:'Building the prize pool',awaitingTime:'Waiting for the next window',awaitingChecks:'Waiting for system checks'};
 function empty(){for(const k of ['short','monthly']){el(k+'-bank').textContent='—';el(k+'-draw-state').textContent='Waiting for confirmed data';el(k+'-time').textContent=k==='short'?'At least 6 hours between draws':'At least 30 days between draws';}el('reserve-summary').textContent='';el('overview-provenance').textContent='';el('draw-history').textContent='No confirmed results loaded.';el('history-next').hidden=true;}
 async function refreshOverview(offset=pageOffset){
  if(busy)return;busy=true;el('history-next').disabled=true;
  try{
   const r=await fetch('/v1/overview?offset='+offset+'&limit=10',{cache:'no-store',signal:AbortSignal.timeout(10000)}),d=await r.json();
   if(!r.ok||d.schema!=='promo-overview-v1'||!['observed','stale'].includes(d.status)||String(d.provenance?.chainId)!=='4663'||!d.asset||!d.reserves||!d.draws||!Array.isArray(d.history?.items))throw Error();
   const amount=n=>money(n,d.asset.decimals);
   for(const kind of ['SHORT','MONTHLY']){
    const k=kind.toLowerCase(),draw=d.draws[kind];
    el(k+'-bank').textContent=amount(draw.active?.budgetRaw??draw.freeRaw);
    el(k+'-draw-state').textContent=labels[draw.state]??'Waiting for confirmed data';
    const date=new Date(Number(draw.earliestAt)*1000);if(!Number.isFinite(date.getTime()))throw Error();
    el(k+'-time').textContent=draw.active?'Prize pool locked for this draw':`Not before ${date.toLocaleString()} · may start later`;
   }
   el('overview-status').textContent=d.status==='stale'?'Updates delayed. These are the last confirmed numbers.':d.provenance.indexerState==='catchingUp'?'Catching up with the chain. Numbers are as of the block below.':'Latest observed prize pools. Start times depend on funding and system checks.';
   el('reserve-summary').textContent=`Available: Short ${amount(d.reserves.freeShort)} · Monthly ${amount(d.reserves.freeCurrent)} · Next starter ${amount(d.reserves.freeNext)} / ${amount(d.reserves.nextStartTarget)} USDG. Locked in draws: ${amount(d.reserves.reserved)} USDG. Prizes awaiting payment: ${amount(d.reserves.claimable)} USDG.`;
   el('overview-provenance').textContent=`Draw data: block ${d.provenance.head.number} · ${d.provenance.observedAt}. Wallet data has its own block and update time.`;
   const box=el('draw-history');box.replaceChildren();
   for(const draw of d.history.items){
    const row=document.createElement('article');row.className='draw-result';
    const title=document.createElement('strong');title.textContent=`${draw.kind} · ${draw.status==='inProgress'?'In progress':draw.status==='winner'?'Winner result':draw.kind==='MONTHLY'?'No winner · rollover':'No winner'}`;
    const info=document.createElement('p');info.textContent=`Draw ${draw.drawId} · Pool ${amount(draw.budgetRaw)} USDG · Awarded ${amount(draw.awardedRaw)} · Paid ${amount(draw.paidRaw)}`;row.append(title,info);
    const tx=draw.terminal?.source?.transactionHash??draw.freeze?.transactionHash;
    if(/^0x[0-9a-f]{64}$/i.test(tx)){const a=document.createElement('a');a.href='https://robinhoodchain.blockscout.com/tx/'+tx;a.target='_blank';a.rel='noopener noreferrer';a.textContent=draw.terminal?'View result transaction':'View draw transaction';row.append(a);}box.append(row);
   }
   if(!d.history.items.length)box.textContent=offset?'No older results to show.':'No draws to show yet.';
   pageOffset=offset;nextOffset=d.history.nextOffset;el('history-next').hidden=nextOffset===null;el('history-next').textContent='Older draws';
  }catch{empty();el('overview-status').textContent='Live prize data is not available yet. Missing numbers don’t mean empty pools.';}
  finally{busy=false;el('history-next').disabled=false;}
 }
 el('history-next').addEventListener('click',()=>{if(nextOffset!==null)void refreshOverview(nextOffset);});
 void refreshOverview(0);setInterval(()=>{if(!document.hidden)void refreshOverview();},30000);
})();
