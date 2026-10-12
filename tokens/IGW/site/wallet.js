// Read-only account viewer: no signature, approval or transaction requests.
const account=document.createElement('section');
account.id='account';account.className='account-section wrap';
account.innerHTML=`<p class="eyebrow">YOUR LITTLE PIECE OF THE CHAOS</p><h2>Your tickets.</h2>
 <p id="account-status" role="status">Connect your wallet or paste an address to see its tickets.</p>
 <div id="account-controls"><div class="account-actions"><button class="button pale" id="wallet-connect" type="button">CONNECT WALLET</button><button class="button" id="wallet-clear" type="button" hidden>CLEAR</button></div>
 <form id="wallet-form"><label for="wallet-address">Or look up a wallet address</label><div class="address-input"><input id="wallet-address" name="address" placeholder="0x…" autocomplete="off" spellcheck="false" required pattern="0x[a-fA-F0-9]{40}"><button class="button" type="submit">LOOK UP</button></div></form>
 <p class="muted">Read-only. No signature needed. Tickets count after the purchase is confirmed and processed.</p></div>
 <div id="wallet-results" aria-live="polite"></div>`;
document.querySelector('.faq').before(account);
const nav=document.createElement('a');nav.href='#account';nav.textContent='My Tickets';document.querySelector('.nav nav').prepend(nav);
const status=account.querySelector('#account-status'),controls=account.querySelector('#account-controls'),results=account.querySelector('#wallet-results'),input=account.querySelector('input'),clear=account.querySelector('#wallet-clear');
const address=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x);
const uint=x=>{if(typeof x!=='string'||!/^(0|[1-9]\d*)$/.test(x))throw Error();return BigInt(x);};
const usd=x=>{const n=uint(x);return (n/1000000n).toLocaleString('en-US')+(n%1000000n?'.'+(n%1000000n).toString().padStart(6,'0').replace(/0+$/,''):'');};
let ready=false,selected='',generation=0,request,connected=false,provider;
function reset(){generation++;request?.abort();selected='';input.value='';results.replaceChildren();clear.hidden=true;connected=false;}
async function load(){
 if(!selected)return;
 if(!ready){status.textContent=selected+' · Ticket data is unavailable. Refreshing automatically.';return;}
 request?.abort();const controller=request=new AbortController(),version=++generation,wallet=selected;
 status.textContent='Checking '+wallet+'…';results.replaceChildren();
 try{
  const r=await fetch('/api/wallet/'+wallet,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});
  if(!r.ok)throw Error();const data=await r.json();if(data.address!==wallet||!Array.isArray(data.modules))throw Error();
  const fragment=document.createDocumentFragment();let count=0,delayed=false;
  for(const m of data.modules){
   const s=m.snapshot,w=s?.wallet;if(!w)continue;
   if(!['short','monthly'].includes(s.kind)||s.settings?.asset!=='USDG'||s.settings.decimals!==6)throw Error();
   for(const key of ['available','reserved','used','totalIssued','eligibleVolumeRaw','remainderRaw','latestUnpaidRewardRaw','latestCycle'])uint(w[key]);
   const threshold=uint(s.settings.thresholdRaw),remainder=uint(w.remainderRaw);
   if(threshold===0n||remainder>=threshold||uint(w.available)+uint(w.reserved)+uint(w.used)!==uint(w.totalIssued))throw Error();
   const age=Date.now()-Date.parse(m.observedAt),stale=m.stale||m.service?.stale||m.service?.projectionFailed||['blocked','paused','unavailable'].includes(m.service?.status)||!Number.isFinite(age)||age>120000||age< -30000;delayed ||= stale;
   const card=document.createElement('article');card.className='wallet-card';
   const heading=document.createElement('h3');heading.textContent=s.kind==='short'?'Short draw':'Monthly draw';card.append(heading);
   const grid=document.createElement('dl');grid.className='wallet-stats';
   for(const [label,value] of [['Available tickets',w.available],['In the current draw',w.reserved],['Used tickets',w.used],['Until the next ticket',usd(String(threshold-remainder))+' USDG']]){
    const cell=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;cell.append(dt,dd);grid.append(cell);
   }card.append(grid);
   const note=document.createElement('p');note.className='muted';note.textContent='Confirmed eligible purchases: '+usd(w.eligibleVolumeRaw)+' USDG. '+(stale?'Delayed snapshot — these values may have changed.':'Confirmed snapshot.');card.append(note);
   if(uint(w.latestUnpaidRewardRaw)>0n){const prize=document.createElement('p');prize.textContent='Unpaid prize in draw #'+w.latestCycle+': '+usd(w.latestUnpaidRewardRaw)+' USDG. Payout service will process it.';card.append(prize);}
   const waiting=s.pendingRecognition;
   if(waiting){
    if(!Number.isSafeInteger(waiting.count)||waiting.count<0||!Array.isArray(waiting.items)||waiting.items.length>20||waiting.items.length>waiting.count)throw Error();
    if(waiting.count){const pending=document.createElement('p');pending.className='pending-purchases';pending.textContent=waiting.count+' purchase'+(waiting.count===1?'':'s')+' linked to this address awaiting verification. No tickets counted yet. Once confirmed, eligible tickets join future draws.';card.append(pending);
     for(const item of waiting.items){if(!/^0x[0-9a-f]{64}$/i.test(item.transactionHash))throw Error();const link=document.createElement('a');link.href='https://robinhoodchain.blockscout.com/tx/'+item.transactionHash;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View pending purchase '+item.transactionHash.slice(0,10)+'…';link.style.display='block';card.append(link);}
    }
   }
   fragment.append(card);count++;
  }
  if(version!==generation)return;
  results.replaceChildren(fragment);status.textContent=wallet+(count?(delayed?' · Updates are delayed.':' · Robinhood Chain'):' · No confirmed ticket snapshot yet.');
 }catch{if(version!==generation||controller.signal.aborted)return;results.replaceChildren();status.textContent='Ticket data is temporarily unavailable. Your wallet has not changed.';}
}
function select(value){if(!address(value)){reset();status.textContent='Enter a complete wallet address (0x + 40 characters).';return;}selected=value.toLowerCase();input.value=selected;clear.hidden=false;load();}
document.addEventListener('igw-project',event=>{
 ready=Boolean(event.detail);
 if(!ready){generation++;request?.abort();results.replaceChildren();status.textContent=selected?selected+' · Ticket data is unavailable. Refreshing automatically.':'Connect your wallet or paste an address to see its tickets.';}
 else if(selected)load();else status.textContent='Connect your wallet or paste an address to see its tickets.';
});
account.querySelector('form').addEventListener('submit',e=>{e.preventDefault();connected=false;select(input.value.trim());});
clear.addEventListener('click',()=>{reset();status.textContent='Wallet cleared. Connect or look up another address.';});
account.querySelector('#wallet-connect').addEventListener('click',async()=>{
 const version=generation;
 try{
  const candidate=window.ethereum;if(!candidate?.request){status.textContent='No browser wallet found. Paste an address below to view tickets.';return;}
  const accounts=await candidate.request({method:'eth_requestAccounts'});if(version!==generation)return;
  if(!address(accounts?.[0]))throw Error();
  if(provider!==candidate){provider=candidate;provider.on?.('accountsChanged',accounts=>{if(connected){if(address(accounts?.[0]))select(accounts[0]);else{reset();status.textContent='Wallet disconnected.';}}});provider.on?.('disconnect',()=>{if(connected){reset();status.textContent='Wallet disconnected.';}});}
  connected=true;select(accounts[0]);
 }catch{status.textContent='Connection was not completed. You can still look up an address.';}
});
