'use strict';
const $=id=>document.getElementById(id),dialog=$('dialog'),providers=new Map();
let provider=null,address=null,chain=null,version=0,busy=false;
let claimVersion=0,claimFingerprint=null;
function invalidateClaims(){claimVersion++;claimFingerprint=null;}
let currentWallet=null,accounts=[],session=0,detach=()=>{},dialogMode='',restoreTimer;
let expectedChain=4663n,siteActions=null;
const storageKey='qianqi.wallet.v1';
const networkLabel=()=>siteActions?'Configured test chain':'Robinhood Chain';
function loadClaimScript(src){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.head.append(script);});}
const actionsReady=(async()=>{try{if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname))return;const response=await fetch('/site-actions.json',{cache:'no-store',signal:AbortSignal.timeout(5000)});const config=await response.json();if(config){if(!globalThis.QianqiClaim){await loadClaimScript('/vendor/ethers-6.17.0.min.js');await loadClaimScript('/claim.js');}siteActions=QianqiClaim.config(config);expectedChain=BigInt(config.chainId);const note=document.createElement('p');note.className='local-test-notice';note.textContent='LOCAL TEST · test prizes and test transactions only';note.setAttribute('role','status');$('account').prepend(note);}}catch{/* No checked deployment means no transaction controls. */}})();
const cleanAccounts=value=>Array.isArray(value)?[...new Set(value.filter(a=>typeof a==='string'&&/^0x[\da-fA-F]{40}$/.test(a)).map(a=>a.toLowerCase()))]:[];
function readSaved(){try{return JSON.parse(sessionStorage.getItem(storageKey));}catch{return null;}}
let saved=readSaved(),restoreAllowed=true;
function forget(){saved=null;try{sessionStorage.removeItem(storageKey);}catch{}}
function remember(){if(!currentWallet||!address)return;saved={rdns:currentWallet.rdns,name:currentWallet.name,address};try{sessionStorage.setItem(storageKey,JSON.stringify(saved));}catch{}}
function rpc(p,method,params){let timer;return Promise.race([Promise.resolve().then(()=>p.request({method,...(params?{params}: {})})),new Promise((_,reject)=>{timer=setTimeout(()=>reject({code:'TIMEOUT'}),20000);})]).finally(()=>clearTimeout(timer));}
function show(title,copy,{error=false,choices=[],mode=''}={}){
 dialogMode=mode;$('dialog-title').textContent=title;$('dialog-copy').textContent=copy;$('dialog-mouse').hidden=!error;
 $('wallet-options').replaceChildren();for(const item of choices){const b=document.createElement('button');b.className='button outline';b.textContent=item.name;if(item.selected!==undefined)b.setAttribute('aria-pressed',String(item.selected));b.disabled=busy&&item.allowBusy!==true;b.onclick=()=>{dialog.close();void item.action();};$('wallet-options').append(b);}if(!dialog.open)dialog.showModal();
}
dialog.setAttribute('aria-labelledby','dialog-title');dialog.setAttribute('aria-describedby','dialog-copy');
dialog.addEventListener('close',()=>{if(!dialog.open)dialogMode='';});
for(const b of document.querySelectorAll('.dialog-close'))b.addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
function walletChoices(){const list=[...providers.values()];if(!list.length&&typeof window.ethereum?.request==='function')list.push({name:'Browser wallet',rdns:null,provider:window.ethereum});return list;}
window.addEventListener('eip6963:announceProvider',e=>{
 const d=e.detail;if(typeof d?.info?.uuid!=='string'||!d.info.uuid||d.info.uuid.length>100||typeof d.info.name!=='string'||typeof d.provider?.request!=='function'||providers.size>=32)return;
 if(providers.has(d.info.uuid)||[...providers.values()].some(w=>w.provider===d.provider))return;
 // Names/rdns are self-reported labels, never proof of identity. No supplied HTML/icons are rendered.
 const rdns=typeof d.info.rdns==='string'&&/^[a-zA-Z0-9.-]{1,253}$/.test(d.info.rdns)?d.info.rdns:null;
 providers.set(d.info.uuid,{name:d.info.name.slice(0,80)||'Wallet',rdns,provider:d.provider});
 if(dialog.open&&dialogMode==='wallets')chooseWallet(true);
 scheduleRestore();
});
function emptyRewards(title,copy){const td=document.createElement('td');td.colSpan=3;const box=document.createElement('div');box.className='empty-state';const h=document.createElement('h3');h.textContent=title;const p=document.createElement('p');p.textContent=copy;box.append(h,p);td.append(box);const tr=document.createElement('tr');tr.append(td);$('rewards-body').replaceChildren(tr);}
function resetData(message,{keepToken=false}={}){if(!keepToken&&$('token-balance'))$('token-balance').textContent='—';invalidateClaims();$('purchase-status')?.remove();if($('locked-tickets'))$('locked-tickets').replaceChildren();$('short-count').textContent='—';$('monthly-count').textContent='—';$('carry').textContent=message;$('provenance').textContent='We can’t confirm the numbers right now.';emptyRewards('PRIZES: WAITING FOR DATA',message);}
function updateButtons(){for(const b of document.querySelectorAll('.connect')){const label=b.querySelector('.connect-label');const text=busy?'CONNECTING…':address?`${address.slice(0,6)}…${address.slice(-4)}`:'CONNECT WALLET';if(label)label.textContent=text;else b.textContent=text;b.disabled=busy;b.setAttribute('aria-label',address?`Manage wallet ${address}`:text);}$('disconnect').hidden=!provider;$('refresh').hidden=!address;}
function disconnected(){restoreAllowed=false;clearTimeout(restoreTimer);session++;version++;detach();detach=()=>{};provider=null;currentWallet=null;address=null;accounts=[];chain=null;busy=false;forget();if(dialog.open)dialog.close();updateButtons();$('wallet-status').textContent='Wallet disconnected.';resetData('Connect and check your tickets.');}
function applyAccounts(value,preferred=address){accounts=cleanAccounts(value);if(!accounts.length){disconnected();return false;}address=accounts.includes(preferred)?preferred:accounts[0];version++;remember();updateButtons();resetData('Getting this wallet’s numbers…');return true;}
function readChain(value){if(typeof value!=='string'||!/^0x[\da-f]+$/i.test(value))throw Error('Invalid network');return BigInt(value);}
function errorCopy(e){switch(Number(e?.code)){case 4001:return 'You declined the request. No worries — nothing was signed or sent.';case -32002:return 'A request is already open in your wallet. Pop it open and approve or dismiss that request before trying again.';case 4100:return 'This site no longer has account access. Connect again when you’re ready to share your address.';case 4900:case 4901:return 'Your wallet lost its network connection. Open it and check what’s going on.';case 4902:return 'Your wallet doesn’t know Robinhood Chain yet. Add it with checked network details in your wallet, then try again.';case 4200:case -32601:return 'This wallet does not support that request. You can manage accounts or pick Robinhood Chain inside the wallet instead.';default:return e?.code==='TIMEOUT'?'The wallet has not responded. Take a look inside — there may be a request waiting for you. Check it before trying again.':'That didn’t go through. Check that your wallet is unlocked, then give it another try.';}}
async function connect(item,{silent=false,preferred=null}={}){
 if(busy)return;restoreAllowed=false;clearTimeout(restoreTimer);
 detach();provider=item.provider;currentWallet=item;address=null;accounts=[];chain=null;version++;const token=++session;busy=true;updateButtons();resetData('Checking in with your wallet…');
 let initializing=true,accountEvent,networkEvent,accountsRevision=0,chainRevision=0;
 const onAccounts=value=>{if(token!==session)return;accountEvent=value;accountsRevision++;if(initializing){if(!cleanAccounts(value).length)disconnected();return;}if(applyAccounts(value)){void refresh();if(dialog.open&&dialogMode==='account')accountMenu();}};
 const onChain=value=>{if(token!==session)return;networkEvent=value;chainRevision++;if(initializing)return;version++;try{chain=readChain(value);}catch{chain=null;}resetData('Checking network…');void refresh();if(dialog.open&&dialogMode==='account')accountMenu();};
 const onDisconnect=()=>{if(token===session)disconnected();};
 const bindings=[['accountsChanged',onAccounts],['chainChanged',onChain],['disconnect',onDisconnect]];
 detach=()=>{for(const [name,fn] of bindings){try{item.provider.removeListener?.(name,fn);}catch{}}};
 try{
  for(const [name,fn] of bindings)item.provider.on?.(name,fn);
  const initialAccountsRevision=accountsRevision;
  const result=await rpc(provider,silent?'eth_accounts':'eth_requestAccounts');if(token!==session)return;
  const initialChainRevision=chainRevision;
  const network=await rpc(provider,'eth_chainId');if(token!==session)return;
  chain=readChain(chainRevision!==initialChainRevision?networkEvent:network);
  initializing=false;busy=false;
  const granted=accountsRevision!==initialAccountsRevision?accountEvent:result;
  if(silent&&!cleanAccounts(granted).includes(preferred)){disconnected();return;}
  if(!applyAccounts(granted,preferred))return;
  if(!silent)$('account').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  void refresh();
 }catch(e){if(token!==session)return;disconnected();if(!silent)show('Let’s try that connection again',errorCopy(e),{error:true});}
 finally{if(token===session){busy=false;updateButtons();}}
}
function accountMenu(){
 if(!address)return;
 const choices=accounts.map(a=>({name:(a===address?'Selected: ':'')+a,selected:a===address,action:()=>{applyAccounts(accounts,a);void refresh();accountMenu();}}));
 if(chain!==expectedChain)choices.push({name:'Switch to '+networkLabel(),action:()=>walletAction('switch')});
 choices.push({name:'Manage accounts in wallet',action:()=>walletAction('accounts')},{name:'Change wallet',action:()=>{disconnected();chooseWallet(true);}},{name:'Disconnect this site',action:disconnected});
 show(currentWallet.name,`${chain===expectedChain?networkLabel(): 'Wrong network'} · Pick an account your wallet has shared. Disconnect here to leave the site; remove access in the extension if you want it forgotten there too.`,{choices,mode:'account'});
}
async function walletAction(kind){
 if(busy||!provider)return;const p=provider,token=session;busy=true;updateButtons();
 // Events are authoritative. Do not overwrite an event with an older read response.
 let changed=0;const notice=()=>{changed++;};
 try{
  p.on?.('accountsChanged',notice);p.on?.('chainChanged',notice);
  await rpc(p,kind==='switch'?'wallet_switchEthereumChain':'wallet_requestPermissions',kind==='switch'?[{chainId:'0x'+expectedChain.toString(16)}]:[{eth_accounts:{}}]);if(token!==session)return;
  const before=changed;const list=await rpc(p,'eth_accounts');const network=await rpc(p,'eth_chainId');if(token!==session)return;
  if(changed===before){chain=readChain(network);if(!applyAccounts(list))return;void refresh();}
  busy=false;updateButtons();accountMenu();
 }catch(e){if(token===session){if([4100,4900,4901].includes(Number(e?.code)))disconnected();show('That request didn’t go through',errorCopy(e),{error:true});}}
 finally{try{p.removeListener?.('accountsChanged',notice);p.removeListener?.('chainChanged',notice);}catch{}if(token===session){busy=false;updateButtons();}}
}
function chooseWallet(force=false){
 restoreAllowed=false;clearTimeout(restoreTimer);if(busy)return;if(address&&!force){accountMenu();return;}
 window.dispatchEvent(new Event('eip6963:requestProvider'));
 const choices=walletChoices();if(!choices.length){show('Wallet required','Got a wallet extension? Open it here. On your phone, open this site in your wallet’s browser. QR connection isn’t ready yet.',{mode:'wallets'});return;}
 if(choices.length===1&&!force){void connect(choices[0]);return;}
 show('Choose your wallet','Pick your wallet. We’ll see the accounts you share and the network you’re on. Your spending stays in your hands.',{mode:'wallets',choices:choices.map(item=>({name:item.name,action:()=>connect(item)}))});
}
function scheduleRestore(){
 if(!restoreAllowed||!saved||busy||provider)return;clearTimeout(restoreTimer);
 restoreTimer=setTimeout(()=>{if(!restoreAllowed||busy||provider)return;
  // Legacy injection has no stable identity: require a click after reload.
  if(!saved?.rdns)return;const matches=walletChoices().filter(w=>w.rdns===saved.rdns&&w.name===saved.name);
  if(matches.length===1)void connect(matches[0],{silent:true,preferred:saved.address});
 },250);
}
window.dispatchEvent(new Event('eip6963:requestProvider'));scheduleRestore();
function units(raw,decimals){if(!/^\d+$/.test(String(raw))||!Number.isInteger(decimals)||decimals<0||decimals>36)throw Error('Invalid amount');const n=BigInt(raw),d=10n**BigInt(decimals),fraction=(n%d).toString().padStart(decimals,'0').replace(/0+$/,'');return (n/d).toLocaleString('en-US')+(fraction?'.'+fraction:'');}
// Display only: retain raw amounts for accounting and signed transactions.
function money(raw,decimals,{roundUp=false}={}){
 units(raw,decimals);const n=BigInt(raw);if(decimals<=2)return units(raw,decimals);
 const scale=10n**BigInt(decimals-2),cents=n/scale;
 if(n>0n&&cents===0n&&!roundUp)return '<0.01';
 return units(String(cents+(roundUp&&n%scale?1n:0n)),2);
}
async function refreshTokenBalance(request,wallet){
 const box=$('token-balance');if(!box)return;
 if(siteActions||chain!==4663n){box.textContent='Unavailable on this network';return;}
 box.textContent='Loading…';const p=provider,token=document.body.dataset.marketToken;
 try{
  if(!/^0x[\da-f]{40}$/i.test(token))throw Error();
  const [raw,dec]=await Promise.all([
   rpc(p,'eth_call',[{to:token,data:'0x70a08231'+wallet.slice(2).padStart(64,'0')},'latest']),
   rpc(p,'eth_call',[{to:token,data:'0x313ce567'},'latest'])]);
  if(request!==version||p!==provider)return;
  if(!/^0x[\da-f]{64}$/i.test(raw)||!/^0x[\da-f]{64}$/i.test(dec))throw Error();
  const decimals=Number(BigInt(dec));
  box.textContent=units(BigInt(raw).toString(),decimals);
 }catch{if(request===version&&p===provider)box.textContent='Unable to load';}
}
async function refresh(){
 const request=++version,wallet=address;if(!wallet)return;
 await actionsReady;if(request!==version)return;
 if(chain!==expectedChain){$('wallet-status').textContent=`Wrong network. Tap your wallet address and choose ${networkLabel()}.`;resetData(`Switch to ${networkLabel()} to see your tickets and prizes.`);return;}
 void refreshTokenBalance(request,wallet);
 $('wallet-status').textContent='Fetching your tickets and prizes…';
 try{
  const res=await fetch(`/v1/wallets/${wallet}?limit=25`,{cache:'no-store',signal:AbortSignal.timeout(10000)});const data=await res.json();if(request!==version)return;
  if(!res.ok||data.schema!=='promo-wallet-status-v1'||!['observed','stale'].includes(data.status)||data.wallet!==wallet||String(data.provenance?.chainId)!==String(expectedChain)||!data.balances)throw Error();
  const fingerprint=JSON.stringify([wallet,String(chain),data.status,data.rewards?.vault,data.asset,(data.rewards?.items??[]).map(r=>[r.drawId,r.winner,r.asset,r.amountRaw,r.status]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
  if(fingerprint!==claimFingerprint){claimVersion++;claimFingerprint=fingerprint;}
  const b=data.balances;$('short-count').textContent=units(b.SHORT.open,0);$('monthly-count').textContent=units(b.MONTHLY.open,0);
  if($('locked-tickets')){
   const box=$('locked-tickets');box.replaceChildren();
   for(const kind of ['SHORT','MONTHLY'])for(const [id,entry] of Object.entries(b[kind].frozenByDraw??{})){
    const p=document.createElement('p');p.className='locked-ticket';p.textContent=`${kind}: ${units(entry.count,0)} tickets in progress · draw ${id}`;box.append(p);
   }
  }
  const remaining=BigInt(b.entryThresholdRaw)-BigInt(b.carryRaw);if(remaining<=0n)throw Error();
  $('carry').textContent=`${money(String(remaining),b.quoteDecimals,{roundUp:true})} USDG to your next Short + Monthly ticket pair. Tickets shown here are waiting for a draw.`;
  $('wallet-status').textContent=data.status==='stale'?'Updates delayed. You’re seeing the last numbers we could confirm.':data.provenance.indexerState==='catchingUp'?'Catching up with the chain. Recent buys may not appear yet. Your confirmed tickets stay recorded.':'Your prizes and payment status appear here.';
  $('provenance').textContent=`As of block ${data.provenance.head.number} · ${data.provenance.observedAt??'time unavailable'}`;
  if(data.rewards===null)emptyRewards('PRIZES: STILL CHECKING','We don’t have confirmed prize data for this wallet yet.');
  else if(!data.rewards.items.length)emptyRewards('NO PRIZES TO SHOW YET','No prizes assigned to this wallet in the latest data we have.');
  else{
   // Reward asset/decimals must come from a verified deployment profile, never the quote decimals.
   $('rewards-body').replaceChildren();for(const reward of data.rewards.items){const tr=document.createElement('tr');for(const text of [String(reward.drawId).slice(0,10)+'…',data.asset&&reward.asset===data.asset.address?money(reward.amountRaw,data.asset.decimals)+' USDG':'Amount not loaded',reward.status==='paid'?'Paid':'Won · payment pending']){const td=document.createElement('td');td.textContent=text;tr.append(td);}tr.firstChild.title=String(reward.drawId);for(const [label,source] of [['Assignment',reward.assignment],['Payment',reward.payment]]){if(source&&/^0x[0-9a-f]{64}$/i.test(source.transactionHash)&&String(data.provenance.chainId)==='4663'){const a=document.createElement('a');a.href='https://robinhoodchain.blockscout.com/tx/'+source.transactionHash;a.textContent=label;a.target='_blank';a.rel='noopener noreferrer';tr.firstChild.append(document.createElement('br'),a);}}tr.lastChild.className=reward.status==='paid'?'status-paid':'status-assigned';$('rewards-body').append(tr);}
   $('provenance').textContent+=` · Showing ${data.rewards.items.length} of ${data.rewards.total} rewards.`;
   attachClaims(data,claimVersion);
  }
  renderPurchases(data);
 }catch{if(request!==version)return;resetData('We can’t load your tickets right now. That doesn’t mean you have none.',{keepToken:true});$('wallet-status').textContent='Data unavailable. Give Refresh a try in a moment.';}
}
for(const b of document.querySelectorAll('.connect'))b.addEventListener('click',()=>void chooseWallet());
$('disconnect').addEventListener('click',disconnected);$('refresh').addEventListener('click',()=>void refresh());
$('buy').addEventListener('click',()=>{
 const token=siteActions?siteActions.publishedMarketToken:document.body.dataset.marketToken;
 if(typeof token==='string'&&/^0x[\da-f]{40}$/i.test(token)){
  show('Buy on Pons',`Pons opens the trading page for ${token}. Check the token and payment route there. Only supported purchases earn tickets.`,{choices:[{name:'Open Pons',action:()=>window.open('https://www.ponsfamily.com/launchpad/'+token,'_blank','noopener,noreferrer')}]});
 }else show('Buy link: coming soon','We haven’t added a checked buy link yet. Before you buy, make sure the token address and route match the ones we publish.');
});

function claimEngine(reward,revision){
 const selected=address,p=provider;
 return QianqiClaim.create({deployment:siteActions,provider:p,storage:localStorage,
  current:()=>provider===p&&address===selected&&claimVersion===revision&&chain===expectedChain,
  lock:navigator.locks?((key,fn)=>navigator.locks.request(key,{ifAvailable:true},lock=>{if(!lock)throw Error('Another tab is checking this claim.');return fn();})):null});
}
function attachClaims(data,revision){
 if(!siteActions||data.status!=='observed'||data.rewards.vault?.toLowerCase()!==siteActions.vault.toLowerCase()||data.asset?.address?.toLowerCase()!==siteActions.asset.toLowerCase()||data.asset.decimals!==siteActions.decimals)return;
 for(const [i,reward] of data.rewards.items.entries()){
  if(reward.status!=='assigned'||reward.winner?.toLowerCase()!==address)continue;
  const r={...reward,winner:address},button=document.createElement('button');button.className='text-button';button.textContent='Claim / check payment';
  button.onclick=async()=>{
   button.disabled=true;
   try{
    const engine=claimEngine(r,revision),saved=await engine.check(r);if(revision!==claimVersion)return;
    if(saved&&!['rejected','reverted'].includes(saved.state)){
     const text=saved.state==='confirmed'?'Payment confirmed on the test chain. The indexed view may take a moment to catch up.':saved.hash?`Transaction pending: ${saved.hash}. Refresh and check again; no second transaction will be sent.`:'A wallet request is still open or its outcome is unknown. Check wallet activity before doing anything else. This site will not send it again.';
     show('Claim status',text,{choices:saved.state==='confirmed'?[]:[{name:'Check a transaction hash',action:()=>recoverClaim(engine,r,revision)}]});return;
    }
    const review=await engine.prepare(r);if(revision!==claimVersion)return;
    show('Claim your test prize',`${review.amount} USDG → ${r.winner}. Test chain ${siteActions.chainId}. Estimated gas: ${BigInt(review.gas)} units; your wallet shows the network fee. No token approval.`,{choices:[{name:'Confirm claim in wallet',action:async()=>{
     if(revision!==claimVersion){show('Check the prize again','Your wallet or its data changed. Close this message and reopen Claim to review the current prize.');return;}
     show('Check your wallet','Confirm or decline the claim there. Leave an unanswered request open only once.');
     try{await engine.send(r);if(revision===claimVersion)show('Claim submitted','The transaction was sent. Use Claim / check payment to check its result.');}
     catch(e){if(revision===claimVersion)show('Claim needs attention',e.message,{error:true});}
    }}]});
   }catch(e){if(revision===claimVersion)show('Claim needs attention',e.message,{error:true});}
   finally{button.disabled=false;}
  };
  $('rewards-body').children[i]?.lastChild.append(document.createElement('br'),button);
 }
}
function renderPurchases(data){
 let box=$('purchase-status');if(!box){box=document.createElement('section');box.id='purchase-status';$('provenance').closest('.rewards-footer').after(box);}box.replaceChildren();
 const heading=document.createElement('h3');heading.textContent='Your purchases.';box.append(heading);
 const info=document.createElement('p');info.textContent='Purchases we could identify for this wallet. Only eligible buys count toward tickets.';box.append(info);
 const labels={ELIGIBLE:'Counted toward tickets',INELIGIBLE:'Does not qualify',WAITING_RECOGNITION:'Waiting for purchase verification',UNSUPPORTED_ROUTE:'This route is not supported yet',AMBIGUOUS:'Could not verify this purchase'};
 for(const purchase of data.purchases?.items??[]){const p=document.createElement('p');p.textContent=`${String(purchase.transactionHash).slice(0,12)}… · ${labels[purchase.status]??'Still checking'}${purchase.status==='ELIGIBLE'?` · ${purchase.entriesMinted??'0'} ticket pairs added`:''}`;
  if(purchase.creditedAt){const note=document.createElement('span');note.textContent=` · Verified at block ${purchase.creditedAt.blockNumber}. Tickets became available for future draws at confirmation.`;p.append(note);}
  if(purchase.reason&&purchase.status!=='ELIGIBLE'){const detail=document.createElement('details'),summary=document.createElement('summary'),code=document.createElement('code');summary.textContent='Check detail';code.textContent=purchase.reason;detail.append(summary,code);p.append(detail);}box.append(p);}
 if(!data.purchases?.items?.length){const p=document.createElement('p');p.textContent='No purchases found for this wallet yet. A recent or unverified purchase may take longer to appear.';box.append(p);}
 if(data.purchases){const p=document.createElement('p');p.textContent=`Showing ${data.purchases.items.length} of ${data.purchases.total} purchases.`;box.append(p);}
}
setInterval(()=>{if(address&&!document.hidden)void refresh();},30000);

function recoverClaim(engine,reward,revision){
 show('Find your claim payment','Paste the transaction hash from your wallet activity. We only accept a completed payment for this exact prize; this does not send a transaction.');
 const input=document.createElement('input');input.type='text';input.placeholder='0x…';input.setAttribute('aria-label','Claim transaction hash');input.autocomplete='off';input.style.maxWidth='100%';
 const button=document.createElement('button');button.className='button outline';button.textContent='Verify payment';
 button.onclick=async()=>{button.disabled=true;try{if(revision!==claimVersion)throw Error('Wallet or prize changed. Reopen Claim.');await engine.recover(reward,input.value.trim());if(revision===claimVersion)show('Payment verified','This exact prize was paid on the test chain. Refresh the cabinet to load its latest status.');}catch(e){if(revision===claimVersion){const error=document.createElement('p');error.textContent=e.message;error.setAttribute('role','alert');$('wallet-options').querySelector('[role="alert"]')?.remove();$('wallet-options').append(error);}}finally{button.disabled=false;}};
 $('wallet-options').append(input,button);input.focus();
}
