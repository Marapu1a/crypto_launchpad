(()=>{
const stamp=value=>typeof value==='string'?Date.parse(value):NaN;
class ProjectPulse extends HTMLElement{
 connectedCallback(){this.innerHTML='<span class="pulse-dot" aria-hidden="true"></span><div><strong></strong><time></time></div>';this.setAttribute('role','status');this.paint('Checking draw status',null,'unknown');this.refresh();this.timer=setInterval(()=>{this.render();if(!document.hidden)this.refresh();},30000);}
 disconnectedCallback(){clearInterval(this.timer);this.abort?.abort();}
 paint(label,date,state){this.dataset.state=state;this.querySelector('strong').textContent=label;const n=this.querySelector('time');n.textContent=Number.isFinite(date)?'Last verified · '+new Intl.DateTimeFormat(navigator.language||'en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset'}).format(date):'Waiting for a verified update';if(Number.isFinite(date))n.dateTime=new Date(date).toISOString();else n.removeAttribute('datetime');}
 render(){if(!this.data)return;try{
 let date,healthy=false,label='';
 if(this.getAttribute('adapter')==='overview'){
 const d=this.data;date=stamp(d.provenance?.observedAt);healthy=d.schema==='promo-overview-v1'&&d.status==='observed'&&d.provenance?.indexerState==='caughtUp';label='Draw data up to date';
 }else{
 const ms=this.data.modules;if(!Array.isArray(ms)||!ms.length)throw Error();
 date=Math.min(...ms.flatMap(m=>[stamp(m.observedAt),stamp(m.service?.observedAt)]));
 healthy=ms.every(m=>m.snapshot&&['short','monthly'].includes(m.snapshot.kind)&&!m.stale&&!m.service?.stale&&!m.service?.projectionFailed&&['waiting','running','idle','ok'].includes(m.service?.status));
 const funding=ms.every(m=>/^\d+$/.test(m.snapshot?.fundRaw)&&/^\d+$/.test(m.snapshot?.settings?.minimumFundRaw)&&BigInt(m.snapshot.fundRaw)<BigInt(m.snapshot.settings.minimumFundRaw));
 label=funding?'Prize fund growing':'Draw service active';
 }
 healthy=healthy&&Number.isFinite(date)&&Date.now()-date<=120000&&date-Date.now()<=30000;
 if(healthy)this.verified=date;
 this.paint(this.failed?'Status temporarily unavailable':healthy?label:'',healthy?date:this.verified??date,this.failed?'unknown':healthy?'active':'delayed');
 }catch{this.paint('Status temporarily unavailable',this.verified,'unknown');}}
 async refresh(){if(this.busy)return;this.busy=true;this.abort=new AbortController();const timeout=setTimeout(()=>this.abort.abort(),10000);try{const r=await fetch(this.getAttribute('src'),{cache:'no-store',signal:this.abort.signal});if(!r.ok)throw Error();this.data=await r.json();this.failed=false;this.render();}catch{this.failed=true;if(this.data)this.render();else this.paint('Status temporarily unavailable',this.verified,'unknown');}finally{clearTimeout(timeout);this.busy=false;}}
}
customElements.define('project-pulse',ProjectPulse);
})();
