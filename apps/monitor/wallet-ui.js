const $=id=>document.getElementById(id),valid=a=>/^0x[0-9a-f]{40}$/i.test(a),short=a=>a.slice(0,8)+'…'+a.slice(-6);
let data=null,limit=100,busy=false,activeData=null,statusKey='',activeLimit=10;
function stored(k,f){try{return JSON.parse(localStorage.getItem(k))??f}catch{return f}}
let favorites=stored('monitor-wallets',[]);favorites=Array.isArray(favorites)?favorites.filter(valid).slice(0,50):[];
function save(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{statusKey='storageFail';status()}}
function status(){$('status').textContent=U.t(statusKey||'walletSub')}
function bookmarks(){$('saved').replaceChildren();for(const a of favorites){const b=U.node('button',short(a));b.title=a;b.onclick=()=>{$('address').value=a;load()};$('saved').append(b)}}
let walletSort='volumeUsd';
const minutes=()=>Number($('wallet-period').value);
$('wallet-close').onclick=()=>$('wallet-dialog').close();
$('wallet-dialog').addEventListener('click',e=>{if(e.target===$('wallet-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}});

function usd(value){return value==null||!Number.isFinite(Number(value))?'—':'≈ $'+U.num(value)}
function active(){
 if(!activeData)return;
 $('active-time').textContent=U.t('saved',{time:U.clock(activeData.windowEnd)})+(activeData.complete===false?' · '+U.t('partialHelp'):'');
 const items=[...(activeData.walletActivity??[])].filter(x=>valid(x.address)).sort((a,b)=>{
  const av=a[walletSort],bv=b[walletSort];
  return (av==null)-(bv==null)||(Number(bv)-Number(av))||b.buys-a.buys||a.address.localeCompare(b.address);
 });
 $('active').replaceChildren();
 for(const x of items.slice(0,activeLimit)){
  const tr=document.createElement('tr');const td=cell(tr,'','wallets');
  const link=U.node('a',x.username||x.identity?.username||x.displayName||short(x.address));
  link.href='/wallets?address='+x.address;link.title=x.address;
  link.onclick=e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();$('address').value=x.address;load()};td.append(link);
  cell(tr,U.num(x.tokens),'tokens');cell(tr,U.num(x.buys),'buys');cell(tr,usd(x.volumeUsd),'volume');$('active').append(tr);
 }
 for(const b of document.querySelectorAll('[data-wallet-sort]')){b.parentElement.setAttribute('aria-sort',b.dataset.walletSort===walletSort?'descending':'none')}
 $('wallet-more').hidden=items.length<=activeLimit;
 if(!items.length)empty('active','noActive',4);
}
for(const b of document.querySelectorAll('[data-wallet-sort]'))b.onclick=()=>{walletSort=b.dataset.walletSort;activeLimit=10;active()};
function tokenCell(tr,address,symbol){
 const td=cell(tr,'','token'),label=symbol||(valid(address)?short(address):U.t('unknown'));
 if(valid(address)){const a=U.node('a',label,'token-link');a.href='https://ponsfamily.com/launchpad/'+address;a.target='_blank';a.rel='noopener noreferrer';a.title=address;td.append(a)}else td.textContent=label;
 return td;
}
function periodDetail(address){
 const x=activeData?.walletActivity?.find(x=>x.address===address),root=$('period-detail');root.replaceChildren();root.hidden=!x;if(!x)return;
 const heading=U.node('div','','section-head');heading.append(U.node('h2',U.t('periodPurchases')),U.node('small',U.clock(activeData.windowEnd-minutes()*60,true)+' – '+U.clock(activeData.windowEnd,true)));root.append(heading);
 const metrics=U.node('dl','','wallet-metrics');for(const [label,value] of [['tokens',U.num(x.tokens)],['buys',U.num(x.buys)],['volume',usd(x.volumeUsd)]]){const item=document.createElement('div');item.append(U.node('dt',U.t(label)),U.node('dd',value));metrics.append(item)}root.append(metrics);
 const table=U.node('table','','wallet-breakdown'),head=document.createElement('thead'),hr=document.createElement('tr');
 for(const key of ['token','buys','volume'])hr.append(U.node('th',U.t(key)));head.append(hr);table.append(head);
 const body=document.createElement('tbody');
 for(const t of x.tokenDetails??[]){const tr=document.createElement('tr');tokenCell(tr,t.address,t.symbol);cell(tr,U.num(t.buys),'buys');cell(tr,usd(t.volumeUsd),'volume');body.append(tr)}
 if(body.children.length){table.append(body);const wrap=U.node('div','','table-wrap');wrap.append(table);root.append(wrap)}else root.append(U.node('p',U.t('noBreakdown')));
}
function cell(tr,value,key){const td=U.node('td',value);td.dataset.label=U.t(key);tr.append(td);return td}
function empty(target,key,n){const tr=document.createElement('tr');cell(tr,U.t(key),'').colSpan=n;$(target).append(tr)}
function render(d){
 data=d;$('result').hidden=false;$('wallet-welcome').hidden=true;
 const x=activeData?.walletActivity?.find(x=>x.address===d.address);
 $('wallet-dialog-title').textContent=x?.username||short(d.address);$('identity').textContent=d.address;$('identity').title=d.address;
 $('pons').href='https://ponsfamily.com/profile/'+d.address;periodDetail(d.address);
 $('balances-time').textContent=U.t('checked',{time:U.clock(d.positionsUpdatedAt)});
 $('positions-status').textContent=d.errors?.positions?U.t('walletSources'):'';
 const positions=(d.positions??[]).filter(x=>Number(x.amountTokens)>0);let sum=0,missing=0;
 $('positions').replaceChildren();for(const x of positions){const value=x.valueUsd==null||x.reliable===false?null:Number(x.valueUsd);if(value===null||!Number.isFinite(value)||value<0)missing++;else sum+=value;
  const tr=document.createElement('tr');tokenCell(tr,x.token,x.symbol);cell(tr,U.amount(x.amountTokens),'quantity');cell(tr,value==null?'—':U.amount(value),'usd');$('positions').append(tr)
 }
 $('positions-total').replaceChildren(U.node('span',U.t('positionsValue')),U.node('strong',!d.positionsUpdatedAt||missing===positions.length&&missing>0?'—':usd(sum)));if(missing)$('positions-total').append(U.node('small',U.t('partialValuation')));
 if(!positions.length)empty('positions',d.positionsUpdatedAt?'noPositions':'unknown',3);
 $('favorite').textContent=U.t(favorites.includes(d.address)?'unsave':'save');

}
async function walletRequest(a){for(let attempt=0;attempt<5;attempt++){const r=await fetch('/api/wallet?address='+a,{signal:AbortSignal.timeout(40000)});if(!r.ok)throw Error();const d=await r.json();if(!d.busy||d.historyUpdatedAt||d.positionsUpdatedAt||attempt===4)return d;await new Promise(resolve=>setTimeout(resolve,Math.min(10,Math.max(1,d.retryAfter??3))*1000))}}
async function load(){const a=$('address').value.trim().toLowerCase();if(busy)return;if(!valid(a)){statusKey='invalid';status();return}busy=true;$('load').disabled=true;if(!$('wallet-dialog').open)$('wallet-dialog').showModal();$('wallet-dialog-title').textContent=short(a);$('modal-status').textContent=U.t('loading');statusKey='loading';status();if(data?.address!==a)$('result').hidden=true;const timer=setTimeout(()=>{statusKey='longWait';status()},4000);try{const d=await walletRequest(a);if(d.busy&&!d.historyUpdatedAt&&!d.positionsUpdatedAt){statusKey='busy';return}if(!valid(d.address)){statusKey=d.error?'busy':'walletFail';status();return}render(d);$('note').value=stored('wallet-note-'+d.address,'');statusKey=d.busy?'busy':d.error?'walletFail':Object.keys(d.errors??{}).length?'walletSources':'cached';history.replaceState(null,'','/wallets?address='+a)}catch{statusKey='walletFail'}finally{clearTimeout(timer);busy=false;$('load').disabled=false;status();$('modal-status').textContent=statusKey==='walletFail'||statusKey==='busy'?U.t(statusKey):''}}
$('search').onsubmit=e=>{e.preventDefault();load()};
$('favorite').onclick=()=>{if(!data)return;favorites=favorites.includes(data.address)?favorites.filter(x=>x!==data.address):[...favorites,data.address].slice(-50);save('monitor-wallets',favorites);bookmarks();$('favorite').textContent=U.t(favorites.includes(data.address)?'unsave':'save')};
$('note').onchange=()=>{if(data)save('wallet-note-'+data.address,$('note').value)};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(data.address);$('copy').textContent=U.t('copied')}catch{$('copy').textContent=U.t('copyFailed')}};
let activeGeneration=0;
async function fetchActive(){const generation=++activeGeneration;try{const r=await fetch('/api/active-wallets?minutes='+minutes());if(!r.ok)throw Error();const d=await r.json();if(generation!==activeGeneration)return;activeData=d;active();if(data)periodDetail(data.address)}catch{if(generation!==activeGeneration)return;activeData=null;$('active').replaceChildren();$('active-time').textContent=U.t('sourceError')}}
$('wallet-period').onchange=()=>{activeLimit=10;fetchActive()};
document.addEventListener('languagechange',()=>{bookmarks();active();status();if(data)render(data)});bookmarks();
let initialized=false;
async function initializeWallets(){if(initialized)return;initialized=true;await fetchActive();const initial=new URLSearchParams(location.search).get('address');if(valid(initial)){$('address').value=initial;load()}}
void initializeWallets();

$('wallet-more').onclick=()=>{activeLimit+=10;active()};
