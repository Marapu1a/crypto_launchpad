function shortCount(n){return n==null?'-':n<1000?U.num(n):new Intl.NumberFormat(U.locale(),{notation:'compact',maximumSignificantDigits:2}).format(n)}
let lastData=null,mode='recent',unavailable=false,fetching=false,metric='buyers',selectedEnd=null;
const el=id=>document.getElementById(id),fmt=U.num,amount=U.amount,clock=U.clock,node=U.node,t=U.t;
const metrics={buyers:'buyers',buys:'buys',tokens:'activeTokens',launches:'launches'};
function selected(){return lastData?.intervals?.find(x=>x.windowEnd===selectedEnd)??lastData;}
function link(text,url){const n=node('a',text);n.href=url;n.target='_blank';n.rel='noopener noreferrer';return n;}
function safeX(value){try{const u=new URL(value);return u.protocol==='https:'&&['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)&&!u.username&&!u.password&&(!u.port||u.port==='443')?u.href:null}catch{return null}}
function board(){if(!lastData)return;const d=selected();el('recent').setAttribute('aria-pressed',String(mode==='recent'));el('lifetime').setAttribute('aria-pressed',String(mode==='lifetime'));el('period').textContent=t(metric==='launches'?'periodLaunch':mode==='recent'?'periodRecent':'periodLife');
 const rows=[...(d.board??[])].filter(x=>metric==='launches'?x.ageSeconds<300:(x[mode].volume===null?x[mode].buys>0:Number(x[mode].volume)>0)).sort((a,b)=>el('sort').value==='age'?a.ageSeconds-b.ageSeconds:b[mode][el('sort').value]-a[mode][el('sort').value]||a.address.localeCompare(b.address));el('count').textContent=fmt(rows.length);el('rows').replaceChildren();
 for(const x of rows){const m=x[mode],r=node('tr',''),name=node('td','');const meta=node('div','','token-meta');meta.append(node('strong',x.symbol),node('small',t('age',{value:Math.floor(x.ageSeconds/60)})));name.append(meta,node('small',x.name));const links=node('div','','links');if(/^0x[0-9a-f]{40}$/i.test(x.address))links.append(link(t('openPons'),'https://ponsfamily.com/launchpad/'+x.address));const twitter=safeX(x.twitter);links.append(twitter?link('X',twitter):node('small',t('noX')));name.append(links);if(x.historyComplete===false)name.append(node('small',t('partial'),'quality'));r.append(name);
 const cell=(label,value,sub)=>{const td=node('td','');td.dataset.label=t(label);td.append(node('strong',value));if(sub)td.append(node('small',sub));return td};
 r.append(cell('buyers',fmt(m.buyers),mode==='recent'&&x.newBuyers!=null?t('newBuyer',{value:fmt(x.newBuyers)}):null));r.append(cell('buys',fmt(m.buys),t('perAddress',{value:m.buyers?fmt(m.buys/m.buyers):'—'})));
 const volume=cell('volume',amount(m.volume)+' '+x.quote);volume.append(node('small',t('top3')+': '+fmt(m.top3Pct)+(m.top3Pct==null?'':'%'),'desktop-sub'));if(m.missingAmounts)volume.append(node('small',t('missingAmounts')));
 const details=node('details','','mobile-detail');details.append(node('summary',t('more')),node('small',t('top3')+': '+fmt(m.top3Pct)+(m.top3Pct==null?'':'%')),node('small',t('largest')+': '+amount(m.maximum)+' '+x.quote),node('small',t('median')+': '+amount(m.median)+' '+x.quote));
 const max=cell('largest',amount(m.maximum)+' '+x.quote,t('median')+': '+amount(m.median)+' '+x.quote);if(/^0x[0-9a-f]{64}$/i.test(m.maximumTx??'')){const url='https://robinhoodchain.blockscout.com/tx/'+m.maximumTx;max.append(link(t('tx'),url));details.append(link(t('tx'),url))}volume.append(details);r.append(volume,max);el('rows').append(r);
 }if(!rows.length){const r=node('tr',''),td=node('td',t(d.complete!==true||d.error?'emptyPartial':metric==='launches'?'emptyLaunches':mode==='recent'&&d.current?.buys===0?'zeroBuys':'emptyFiltered'),'empty');td.colSpan=5;r.append(td);el('rows').append(r)}
}
for(const id of ['recent','lifetime'])el(id).onclick=()=>{mode=id;board()};el('sort').onchange=board;
function quality(d){const stale=d.stale||!d.windowEnd||Date.now()/1000-d.windowEnd>660,bad=unavailable||stale||d.error||!d.complete;el('quality').textContent=!selected()?.complete||selected()?.error?t('partialHelp'):bad||d.preview||selectedEnd?t('staleHelp'):'';return {bad,stale}}
function dataMessage(d){
 const time=d?.windowEnd?clock(d.windowEnd-300)+' – '+clock(d.windowEnd):t('unknown');
 let key=!d?(fetching?'noteLoading':'noteUnavailable'):unavailable||d.error?'noteError':d.loading&&!d.current?'noteLoading':d.preview?'notePreview':d.stale||!d.windowEnd||Date.now()/1000-d.windowEnd>660?'noteStale':d.complete!==true?'notePartial':'noteReady';
 const parts=[t(key,{time})];
 if(d?.current&&d.complete!==true&&key!=='notePartial')parts.push(t('partialHelp'));
 if(d?.complete===true&&!d.error&&d.current?.buys===0)parts.push(t('zeroBuys'));
 el('data-note').textContent=parts.join(' ');el('data-note').dataset.state=key;
}
function render(d){lastData=d;dataMessage(d);const {bad,stale}=quality(d);el('status').textContent=t(unavailable?'sourceError':d.preview?'preview':d.loading?'loading':d.error?'error':stale?'stale':!d.complete?'partial':d.refreshing?'collecting':'ready');el('timezone').textContent=t('local',{zone:Intl.DateTimeFormat().resolvedOptions().timeZone});
 const c=d.collection;el('coverage-text').textContent=c?t('coverageText',{complete:fmt(c.complete),expected:fmt(c.expected),partial:fmt(c.incomplete),missing:fmt(c.missing)}):t('unknown');el('gaps').replaceChildren();if(c?.gaps?.length){for(const g of c.gaps){const item=node('li','');item.append(node('span',clock(g.fromEnd-300)+' – '+clock(g.to)),node('small',t('gapCount',{value:fmt(g.intervals)})));el('gaps').append(item)}}else el('gaps').append(node('li',t(c?'noGaps':'unknown')));el('attempts').replaceChildren();for(const a of c?.recentAttempts??[])el('attempts').append(node('p',clock(a.started)+' · '+t(['complete','partial','error','interrupted','running'].includes(a.status)?a.status:'unknown')));
 el('market-label').textContent=t('comparison');el('market-time').textContent=t('comparisonTime',{time:clock(d.windowEnd,false,'Europe/Moscow')+' MSK'});const m=d.market;el('market-description').textContent=[!bad&&m?.today?t('todayRank',{value:fmt(m.today.buyers),count:fmt(m.todaySamples)}):t('insufficient'),!bad&&m?.seasonal?t('seasonRank',{value:fmt(m.seasonal.buyers),count:fmt(m.seasonalQualifiedDays)}):''].filter(Boolean).join(' ');
 el('time').textContent=d.updated?t('saved',{time:clock(d.updated)}):'';if(d.current)drawSelection();else{
  for(const id of ['chart','rows','volumes'])el(id).replaceChildren();
  el('selected-time').textContent='';el('heat-detail').textContent='';el('latest').hidden=true;el('heat-metric').disabled=true;
  const row=node('tr',''),cell=node('td',t(d.loading?'noteLoading':'noteUnavailable'),'empty');cell.colSpan=5;row.append(cell);el('rows').append(row);el('count').textContent='';
 }el('details').textContent='pons · '+clock(d.windowEnd);
}
function windows(){
 const source=lastData.intervals?.length?lastData.intervals:(lastData.chart??[]).map((x,i,a)=>({windowEnd:lastData.windowEnd-(a.length-1-i)*300,current:x,complete:i===a.length-1?lastData.complete:false,...(i===a.length-1?{board:lastData.board}:{} )}));
 if(!source.length)return [];
 const end=lastData.windowEnd,start=Math.max(end-1800,Math.min(...source.map(x=>x.windowEnd)));
 const result=[];for(let time=start;time<=end;time+=300)result.push(source.find(x=>x.windowEnd===time)??{windowEnd:time,current:{},complete:false});return result;
}
function comparisonFor(d,k,intervals){
 if(d.complete!==true||d.error||!Number.isFinite(d.current?.[k]))return null;
 const before=Array.from({length:6},(_,i)=>intervals.find(x=>x.windowEnd===d.windowEnd-(i+1)*300));
 if(before.some(x=>x?.complete!==true||x.error||!Number.isFinite(x.current?.[k])))return null;
 const values=before.map(x=>x.current[k]);return {mean:values.reduce((a,b)=>a+b,0)/6,low:Math.min(...values),high:Math.max(...values)};
}
function heatDetail(x,k,intervals){
 const valid=x.complete===true&&!x.error&&Number.isFinite(x.current?.[k]);
 const c=comparisonFor(x,k,intervals);
 const box=el('heat-detail');box.replaceChildren();
 const head=node('div','','summary-head');head.append(node('span',t('chosenInterval'),'summary-eyebrow'),node('span',clock(x.windowEnd-300)+' – '+clock(x.windowEnd,true),'summary-time'));
 const content=node('div','','summary-content'),stat=node('div','','summary-stat');stat.append(node('strong',fmt(x.current?.[k])),node('span',t(metrics[k])));
 const explanation=node('div','','summary-explanation');explanation.append(node('p',t({buyers:'buyerMeaning',buys:'buysMeaning',tokens:'tokensMeaning',launches:'launchesMeaning'}[k])));
 if(!valid)explanation.append(node('p',t('partialHelp'),'quality'));
 const compare=node('div','','summary-compare');compare.append(node('strong',c?t('contextAverage',{value:fmt(c.mean)}):t('noDelta')),node('small',c?t('meanExplanation'):t(x.windowEnd!==lastData.windowEnd?'earlierComparison':'heatUnknown')));
 content.append(stat,explanation,compare);box.append(head,content,node('small',t('local',{zone:Intl.DateTimeFormat().resolvedOptions().timeZone}),'summary-zone'));
 if(!x.board)box.append(node('p',t('heatUnavailable')));

}
function comparisonLabel(value,mean){
 if(mean===0)return t(value===0?'contextSame':'contextZero');
 const change=(value/mean-1)*100;
 return Math.abs(change)<0.5?t('contextSame'):t(change>0?'contextMore':'contextLess',{value:fmt(Math.round(Math.abs(change)))});
}
function drawSelection(){const d=selected();if(!d?.current)return;el('heat-metric').disabled=false;const intervals=windows(); document.querySelector('[data-i18n="overviewTitle"]').textContent=t(d.windowEnd!==lastData.windowEnd?'historic':lastData.preview||lastData.stale||Date.now()/1000-lastData.windowEnd>660?'savedWindow':'overviewTitle'); el('heat-metric').value=metric;el('chart').dataset.selectedMetric=metric;el('chart-title').textContent=t(metrics[metric]);el('chart').replaceChildren();el('chart').style.setProperty('--windows',Math.max(1,intervals.length));
 const latest=intervals.find(x=>x.windowEnd===lastData.windowEnd)??lastData;
 for(const [k,key] of Object.entries(metrics)){
  const row=node('div','','trend-row');row.dataset.metricKey=k;row.dataset.active=String(k===metric);
  const heading=node('div','','trend-heading'),label=node('button',t(key),'trend-label');
  label.setAttribute('aria-pressed',String(k===metric));label.onclick=()=>{metric=k;drawSelection()};heading.append(label);
  const baseline=comparisonFor(latest,k,intervals);
  heading.append(node('small',baseline?t('chartMean',{value:fmt(baseline.mean)}):t('noDelta')));
  const maximum=Math.max(1,...intervals.map(x=>Number(x.current?.[k])||0)),scale=maximum*1.2;
  const plot=node('div','','trend-plot');plot.style.setProperty('--windows',intervals.length||1);
  plot.append(node('span',shortCount(maximum),'axis-max'),node('span','0','axis-zero'));
  for(const x of intervals){
   const value=x.current?.[k],valid=x.complete===true&&!x.error&&Number.isFinite(value);
   const previous=intervals.find(y=>y.windowEnd===x.windowEnd-300);
   const comparable=valid&&previous?.complete===true&&!previous.error&&Number.isFinite(previous.current?.[k]);
   const direction=comparable?(value>previous.current[k]?'up':value<previous.current[k]?'down':'flat'):'unknown';
   const bar=node('button','','trend-bar '+(valid?direction:'trend-gap'));
   bar.dataset.metricKey=k;bar.dataset.end=x.windowEnd;bar.dataset.selected=String(x.windowEnd===d.windowEnd);
   bar.setAttribute('aria-pressed',String(k===metric&&x.windowEnd===d.windowEnd));
   const description=t(key)+': '+fmt(value)+' · '+clock(x.windowEnd-300)+' – '+clock(x.windowEnd,true)+' · '+t(!valid?'heatGap':direction==='up'?'chartUp':direction==='down'?'chartDown':direction==='flat'?'chartNeutral':'chartUnknown');
   bar.title=description;bar.setAttribute('aria-label',description);
   const height=Number.isFinite(value)?value/scale*100:0;bar.style.setProperty('--bar-height',height+'%');
   const fill=node('span','','trend-fill');fill.style.height=height+'%';
   bar.append(fill,node('span',shortCount(value),'trend-value'));
   bar.onclick=()=>{if(x.board){selectedEnd=x.windowEnd;metric=k;drawSelection();el('chart').querySelector('.trend-bar[aria-pressed="true"]')?.focus({preventScroll:true});}else{el('heat-detail').textContent=t('heatUnavailable');}};
   plot.append(bar);
  }
  const times=node('div','','trend-times');times.style.setProperty('--windows',intervals.length||1);
  for(const x of intervals){const tick=node('span',clock(x.windowEnd-300,true));tick.dataset.selected=String(x.windowEnd===d.windowEnd);times.append(tick);}
  const graph=node('div','','trend-graph');graph.append(plot,times);row.append(heading,graph);el('chart').append(row);
 }
 heatDetail(d,metric,intervals);
 el('selected-time').textContent=clock(d.windowEnd-300)+' – '+clock(d.windowEnd,true)+' · '+t(d.windowEnd===lastData.windowEnd?'latest':'historic')+(d.complete===false?' · '+t('partial'):'');el('latest').hidden=!new URLSearchParams(location.search).has('interval')&&d.windowEnd===lastData.windowEnd;el('volumes').replaceChildren();for(const v of d.volumes??[])el('volumes').append(node('div',amount(v.volume)+' '+v.symbol+(v.missingAmounts?' · '+t('partial'):''),'volume'));if(!d.volumes?.length)el('volumes').append(node('small','—'));board();quality(lastData)
}
el('heat-metric').onchange=e=>{metric=e.target.value;drawSelection()};
el('latest').onclick=()=>{if(new URLSearchParams(location.search).has('interval')){location.href='/';return}selectedEnd=null;drawSelection()};
async function tick(){if(fetching)return;fetching=true;if(!lastData)dataMessage(null);el('refresh').disabled=true;el('refresh').textContent=t('loading');try{const r=await fetch(new URLSearchParams(location.search).has('interval')?'/api/interval?end='+encodeURIComponent(new URLSearchParams(location.search).get('interval')):'/api/status',{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();unavailable=false;const d=await r.json();render(d);if(d.loading)setTimeout(tick,5000)}catch{unavailable=true;if(lastData)render(lastData);else {el('status').textContent=t('sourceError');fetching=false;dataMessage(null)}}finally{fetching=false;el('refresh').disabled=false;el('refresh').textContent=t('refresh')}}
el('refresh').onclick=tick;document.addEventListener('languagechange',()=>{if(lastData)render(lastData);else dataMessage(null);if(fetching)el('refresh').textContent=t('loading')});tick();setInterval(()=>{if(lastData&&Date.now()/1000-lastData.windowEnd>660)render({...lastData,stale:true})},30000);
