// Same-origin project identity controls links; draw availability is independent.
const root=document.querySelector('#network-state'),market=document.querySelector('#market-links');
let busy=false,contract=null;
const publishDraws=detail=>document.dispatchEvent(new CustomEvent('token-site-draws',{detail}));
const decimal=value=>{if(!/^(0|[1-9]\d*)$/.test(String(value)))throw Error('Invalid amount');const n=BigInt(value);return(n/1000000n).toLocaleString('en-US')+(n%1000000n?'.'+(n%1000000n).toString().padStart(6,'0').replace(/0+$/,''):'');};
function identity(address){
 contract=address;market.hidden=!address;
 document.querySelector('#contract-address').textContent=address?address.slice(0,8)+'…'+address.slice(-6):'—';
 document.querySelector('#contract-status').textContent=address?'Verified contract':'Data unavailable';
 const buy=document.querySelector('#buy-igw'),explorer=document.querySelector('#view-contract');
 if(address){buy.href='https://www.ponsfamily.com/launchpad/'+address;explorer.href='https://robinhoodchain.blockscout.com/address/'+address;}
 else{buy.removeAttribute('href');explorer.removeAttribute('href');}
 document.dispatchEvent(new CustomEvent('igw-project',{detail:address}));
}
document.querySelector('#copy-contract').addEventListener('click',async event=>{
 if(!contract)return;const button=event.currentTarget;
 try{await navigator.clipboard.writeText(contract);button.textContent='COPIED';}
 catch{button.textContent='SELECT ADDRESS BELOW';}
 setTimeout(()=>{button.textContent='COPY CONTRACT';},2500);
});
async function refresh(){
 if(busy)return;busy=true;
 try{
  const response=await fetch('/api/project',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(response.status===421){
   const body=await response.json();if(body.error!=='unknown_project_host')throw Error();
   identity(null);publishDraws({state:'prelaunch'});
   root.textContent='Contract data is unavailable. This page refreshes automatically.';return;
  }
  if(!response.ok)throw Error();const {project}=await response.json();
  if(project?.slug!=='igw'||String(project.chain_id)!=='4663'||!/^0x[0-9a-f]{40}$/i.test(project.token_address)||/^0x0{40}$/i.test(project.token_address))throw Error();
  identity(project.token_address);root.replaceChildren();
  const label=document.createElement('p');label.textContent='Verified contract · Robinhood Chain';
  const link=document.createElement('a');link.href='https://robinhoodchain.blockscout.com/address/'+contract;link.textContent=contract;link.target='_blank';link.rel='noopener noreferrer';root.append(label,link);
  try{
   const r=await fetch('/api/draws',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();const data=await r.json();if(!Array.isArray(data.modules))throw Error();
   const lines=document.createDocumentFragment();
   for(const m of data.modules){
    const s=m.snapshot;if(!s||!['short','monthly'].includes(s.kind))continue;
    if(s.settings?.asset!=='USDG'||s.settings?.decimals!==6)throw Error();
    const age=Date.now()-Date.parse(m.observedAt),stale=m.stale||m.service?.stale||m.service?.projectionFailed||['blocked','paused','unavailable'].includes(m.service?.status)||!Number.isFinite(age)||age>120000||age< -30000;
    const line=document.createElement('p');line.textContent=(s.kind==='short'?'Short':'Monthly')+' prize fund: '+decimal(s.fundRaw)+' USDG'+(stale?' · Delayed snapshot. Not a live balance.':' · Confirmed snapshot.');lines.append(line);
   }
   root.append(lines);publishDraws({state:'confirmed',modules:data.modules});
  }catch{
   publishDraws({state:'unavailable'});const note=document.createElement('p');note.textContent='Draw data is temporarily unavailable. Contract and trading links are verified.';root.append(note);
  }
 }catch{
  identity(null);publishDraws({state:'unavailable'});root.textContent='Network data is temporarily unavailable. This page refreshes automatically.';
 }finally{busy=false;}
}
refresh();setInterval(()=>{if(!document.hidden)refresh();},15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
