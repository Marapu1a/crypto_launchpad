'use strict';
(()=>{
 const el=id=>document.getElementById(id);if(!el('overview-status'))return;
 let pageOffset=0,nextOffset=null,busy=false;const pageSize=5;
 const utcTime=value=>{if(!/^\d+$/.test(String(value)))return null;const d=new Date(Number(value)*1000);return Number.isFinite(d.getTime())?d.toLocaleString('en-GB',{timeZone:'UTC',hour12:false,year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}):null;};
 const labels={inProgress:'Draw in progress',awaitingFunding:'Building the prize pool',awaitingTime:'Waiting for the next draw',awaitingChecks:'Preparing the next draw'};
 function empty(){for(const k of ['short','monthly']){el(k+'-bank').textContent='—';el(k+'-draw-state').textContent='Waiting for confirmed data';el(k+'-time').textContent=k==='short'?'At least 6 hours between draws':'At least 30 days between draws';}el('reserve-summary').textContent='';el('overview-provenance').textContent='';el('draw-history').textContent='No confirmed results loaded.';if(el('results-freshness'))el('results-freshness').textContent='Results are temporarily unavailable.';el('history-next').hidden=true;if(el('history-prev'))el('history-prev').hidden=true;if(el('history-page'))el('history-page').textContent='';}
 async function refreshOverview(offset=pageOffset){
  if(busy)return;busy=true;el('history-next').disabled=true;if(el('history-prev'))el('history-prev').disabled=true;if(el('overview-retry'))el('overview-retry').disabled=true;
  try{
   const r=await fetch('/v1/overview?offset='+offset+'&limit='+pageSize,{cache:'no-store',signal:AbortSignal.timeout(10000)}),d=await r.json();
   if(!r.ok||d.schema!=='promo-overview-v1'||!['observed','stale'].includes(d.status)||String(d.provenance?.chainId)!=='4663'||!d.asset||!d.reserves||!d.draws||!Array.isArray(d.history?.items))throw Error();
   if(el('overview-retry'))el('overview-retry').hidden=true;
   const amount=n=>money(n,d.asset.decimals);
   for(const kind of ['SHORT','MONTHLY']){
    const k=kind.toLowerCase(),draw=d.draws[kind];
    el(k+'-bank').textContent=amount(draw.active?.budgetRaw??draw.freeRaw);
    el(k+'-draw-state').textContent=labels[draw.state]??'Waiting for confirmed data';
    const date=new Date(Number(draw.earliestAt)*1000);if(!Number.isFinite(date.getTime()))throw Error();
    el(k+'-time').textContent=draw.active?'Prize pool locked for this draw':`Not before ${utcTime(draw.earliestAt)} · may start later`;
   }
   el('overview-status').textContent=d.status==='stale'?'Updates delayed. These are the last confirmed numbers.':d.provenance.indexerState==='catchingUp'?'Updating recent activity. These are the latest confirmed prize pools.':'';
   el('reserve-summary').textContent=`Available: Short ${amount(d.reserves.freeShort)} · Monthly ${amount(d.reserves.freeCurrent)} · Next starter ${amount(d.reserves.freeNext)} / ${amount(d.reserves.nextStartTarget)} USDG. Locked in draws: ${amount(d.reserves.reserved)} USDG. Prizes awaiting payment: ${amount(d.reserves.claimable)} USDG.`;
   snapshotDetails(el('overview-provenance'),d.provenance);
   if(el('results-freshness'))el('results-freshness').textContent=d.status==='stale'?'Updates delayed · showing the last confirmed results.':d.provenance.indexerState==='catchingUp'?'Updating recent activity · showing confirmed results.':'Confirmed results · USDG';
   const box=el('draw-history');box.replaceChildren();
   for(const draw of d.history.items){
    drawRecords.set(draw.drawId,draw);
    const row=document.createElement('article');row.className='draw-result';
    const title=document.createElement('strong');title.textContent=`${drawName(draw.kind)} · ${draw.status==='inProgress'?'In progress':draw.status==='winner'?'Prizes awarded':draw.kind==='MONTHLY'?'No winner · rollover':'No winner'}`;
    const when=document.createElement('p');when.className='result-date';const stamp=utcTime(draw.status==='inProgress'?draw.startedAt:draw.completedAt);when.textContent=stamp?`${draw.status==='inProgress'?'Started':'Completed'} ${stamp}`:'Date available in the onchain result';
    const payout=document.createElement('p');payout.className='result-payout';
    const number=document.createElement('strong');number.textContent=amount(draw.paidRaw);
    const unit=document.createElement('span');unit.textContent='USDG paid';payout.append(number,unit);
    const info=document.createElement('p');info.className='result-breakdown';info.textContent=`Prize pool ${amount(draw.budgetRaw)} USDG · Awarded ${amount(draw.awardedRaw)} USDG`;row.append(title,when,payout,info);
    const tx=draw.terminal?.source?.transactionHash??draw.freeze?.transactionHash;
    if(/^0x[0-9a-f]{64}$/i.test(tx))row.append(explorerLink(draw.terminal?'View result':'View draw','tx',tx,d.provenance.chainId));row.append(technicalDetails('Verification details',`Draw ID: ${draw.drawId}`));box.append(row);
   }
   if(!d.history.items.length)box.textContent=offset?'No older results to show.':'No draws to show yet.';
   if(el('history-heading'))el('history-heading').textContent=offset?'Previous results':'Latest results';if(el('history-prev'))el('history-prev').hidden=offset===0;if(el('history-page'))el('history-page').textContent=d.history.total?(d.history.total<=pageSize?`${d.history.total} ${d.history.total===1?'draw':'draws'}`:`${offset+1}–${offset+d.history.items.length} of ${d.history.total} draws`):'';
   pageOffset=offset;nextOffset=d.history.nextOffset;el('history-next').hidden=nextOffset===null;el('history-next').textContent='Older draws';
  }catch{empty();if(el('overview-retry'))el('overview-retry').hidden=false;el('overview-status').textContent='Live prize data is not available yet. Missing numbers don’t mean empty pools.';}
  finally{busy=false;el('history-next').disabled=false;if(el('history-prev'))el('history-prev').disabled=false;if(el('overview-retry'))el('overview-retry').disabled=false;}
 }
 el('overview-retry')?.addEventListener('click',()=>void refreshOverview(0));
 el('history-prev')?.addEventListener('click',()=>void refreshOverview(Math.max(0,pageOffset-pageSize)));
 el('history-next').addEventListener('click',()=>{if(nextOffset!==null)void refreshOverview(nextOffset);});
 void refreshOverview(0);setInterval(()=>{if(!document.hidden)void refreshOverview();},30000);
})();
