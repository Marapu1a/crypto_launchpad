// Offline, explicit source migration. Does not read RPC or modify executor journals.
import {createRequire} from 'node:module';
import {advancePonsAccounting,ponsWallets} from '../../../src/tickets/pons-accounting.mjs';
import {digest} from '../../../src/tickets/digest.mjs';
import {amount} from '../../../src/draws/config.mjs';
import {isAddress,ZeroAddress} from 'ethers';
const require=createRequire(import.meta.url);
const sd=require('./runtime/scripts/short-dataset.cjs'),md=require('./runtime/scripts/monthly-dataset.cjs');
const {domainFor}=require('./runtime/scripts/attempt-lifecycle.cjs');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const kinds=['SHORT','MONTHLY'];
const rules=(l,k)=>l[k==='SHORT'?'shortRules':'monthlyRules'];
const clone=structuredClone;
const totalFrozen=s=>Object.values(s.frozenByDraw).reduce((n,x)=>n+BigInt(x.count),0n);
const fresh=()=>({mintedTotal:'0',open:'0',consumedTotal:'0',frozenByDraw:{},byEpoch:[]});
export function validateLedger(l){
 check(l&&Array.isArray(l.wallets)&&Array.isArray(l.draws)&&l.pending,'Missing legacy lifecycle');
 check(new Set(l.wallets.map(w=>w.wallet)).size===l.wallets.length,'Duplicate lifecycle wallet');
 check(l.wallets.every(w=>isAddress(w.wallet)&&w.wallet===w.wallet.toLowerCase()&&w.wallet!==ZeroAddress),'Invalid lifecycle wallet');
 for(const k of kinds){
  const r=rules(l,k);check(r?.epochs.some(e=>e.epoch===r.currentEpoch),'Missing active epoch');
  const frozen=l.draws.filter(d=>d.kind===k&&d.status==='FROZEN');
  check(l.pending[k]?frozen.length===1&&frozen[0].drawId===l.pending[k]:frozen.length===0,'Pending draw mismatch');
  for(const d of frozen)for(const p of d.snapshot.participants){
   const entry=l.wallets.find(w=>w.wallet===p.wallet)?.[k].frozenByDraw[d.drawId];
   check(entry&&entry.count===p.count&&entry.firstAttempt===p.firstAttempt&&entry.lastAttempt===p.lastAttempt,'Frozen participant missing');
  }
  for(const w of l.wallets){
   const s=w[k];check(s&&Array.isArray(s.byEpoch),'Missing epoch balances');
   check(BigInt(s.mintedTotal)===BigInt(s.open)+BigInt(s.consumedTotal)+totalFrozen(s),'Legacy conservation failed');
   check(BigInt(s.open)>=0n&&BigInt(s.consumedTotal)>=0n,'Negative legacy balance');
   check(new Set(s.byEpoch.map(e=>e.epoch)).size===s.byEpoch.length,'Duplicate balance epoch');
   for(const e of s.byEpoch){
    check(r.epochs.some(x=>String(x.epoch)===e.epoch),'Unknown balance epoch');
    check(['minted','open','consumed','frozen'].every(key=>BigInt(e[key])>=0n),'Negative epoch balance');
    check(BigInt(e.minted)===BigInt(e.open)+BigInt(e.consumed)+BigInt(e.frozen),'Epoch conservation failed');
    check(BigInt(e.open)===0n?e.firstOpenAttempt===null&&e.lastOpenAttempt===null:
     BigInt(e.firstOpenAttempt)>0n&&BigInt(e.lastOpenAttempt)-BigInt(e.firstOpenAttempt)+1n===BigInt(e.open),'Invalid epoch range');
   }
   for(const [key,expected] of [['minted',s.mintedTotal],['open',s.open],['consumed',s.consumedTotal],['frozen',totalFrozen(s)]])
    check(s.byEpoch.reduce((n,e)=>n+BigInt(e[key]),0n)===BigInt(expected),'Epoch totals differ');
   for(const [id,f] of Object.entries(s.frozenByDraw)){
    const d=l.draws.find(d=>d.drawId===id),p=d?.snapshot.participants.find(p=>p.wallet===w.wallet);
    check(l.pending[k]===id&&d?.kind===k&&d.status==='FROZEN'&&p&&p.count===f.count&&p.firstAttempt===f.firstAttempt&&p.lastAttempt===f.lastAttempt,'Frozen ownership differs');
   }
  }
 }
}
export function sealMigration(s){const {checksum,...payload}=s;return {...payload,checksum:digest(payload)};}
const seal=sealMigration;
export function validateMigration(state){
 const {checksum,...payload}=state;check(state.schema==='qianqi-pons-migration-v1'&&checksum===digest(payload),'Migration checksum mismatch');
 validateLedger(state.ledger);return state;
}
function applyAccounting(state,accounting){
 const s=clone(state),wallets=ponsWallets(accounting,String(amount(s.policy.template.config.ticketPurchase)));
 for(const address of new Set([...Object.keys(wallets),...s.ledger.wallets.map(w=>w.wallet)])){
  let w=s.ledger.wallets.find(w=>w.wallet===address);
  if(!w){w={wallet:address,SHORT:fresh(),MONTHLY:fresh()};s.ledger.wallets.push(w);}
  const issued=BigInt(wallets[address]?.tickets??'0');
  for(const k of kinds){
   const lane=w[k],previous=BigInt(lane.mintedTotal),delta=issued-previous;
   check(delta>=0n,'Migration would remove issued tickets');
   if(delta===0n)continue;
   const epoch=rules(s.ledger,k).currentEpoch;
   check(accounting.head.number>=rules(s.ledger,k).epochs.find(e=>e.epoch===epoch).firstBlock,'Epoch boundary incomplete');
   let e=lane.byEpoch.find(e=>e.epoch===String(epoch));
   if(!e){e={epoch:String(epoch),minted:'0',consumed:'0',frozen:'0',open:'0',firstOpenAttempt:null,lastOpenAttempt:null};lane.byEpoch.push(e);}
   // New credits belong to the epoch at admission, never a historical purchase time.
   if(BigInt(e.open)>0n)check(BigInt(e.lastOpenAttempt)===previous,'Non-contiguous active epoch');
   e.firstOpenAttempt??=String(previous+1n);e.lastOpenAttempt=String(issued);
   e.minted=String(BigInt(e.minted)+delta);e.open=String(BigInt(e.open)+delta);
   lane.mintedTotal=String(issued);lane.open=String(BigInt(lane.open)+delta);
   s.admissions.push({wallet:address,kind:k,epoch:String(epoch),firstAttempt:String(previous+1n),lastAttempt:String(issued),revision:accounting.revision,blockNumber:accounting.head.number});
  }
 }
 s.ledger.wallets.sort((a,b)=>a.wallet.localeCompare(b.wallet));s.ledger.head=clone(accounting.head);
 s.accounting=accounting;validateLedger(s.ledger);return seal(s);
}
export function createMigration({policy,report,legacyCredits,lifecycle,domain,rewards=[],head,now}){
 validateLedger(lifecycle);
 check(domain?.schema==='attempt-lifecycle-v4'&&domain.chainId==='4663','Explicit legacy domain required');
 check(head.number>=lifecycle.head.number,'Migration before saved lifecycle');
 check(head.number!==lifecycle.head.number||head.hash===lifecycle.head.hash,'Migration checkpoint branch changed');
 const accounting=advancePonsAccounting({policy,report,legacyCredits,head,now});
 // Verify the original ledger itself before mixing in API rows; new credits cannot hide missing history.
 const old=ponsWallets({...accounting,records:{}},String(amount(policy.template.config.ticketPurchase)));
 for(const address of new Set([...Object.keys(old),...lifecycle.wallets.map(w=>w.wallet)]))for(const k of kinds)
  check(BigInt(old[address]?.tickets??'0')===BigInt(lifecycle.wallets.find(w=>w.wallet===address)?.[k].mintedTotal??'0'),'Legacy credits differ from lifecycle');
 return applyAccounting({schema:'qianqi-pons-migration-v1',mode:'offline-rehearsal',executionEnabled:false,
  policy:clone(policy),domain:clone(domain),boundary:clone(head),sourcePolicy:'pons-trader-quote-v1-preserve-legacy',
  epochPolicy:'admission-current-epoch-v1',legacyHash:digest({lifecycle,legacyCredits,rewards}),
  ledger:clone(lifecycle),rewards:clone(rewards),admissions:[],artifacts:{}},accounting);
}
export function advanceMigration({state,report,head,now}){
 validateMigration(state);
 return applyAccounting(state,advancePonsAccounting({policy:state.policy,prior:state.accounting,report,head,now}));
}
export function prepareMigrationJob(state,kind,input){
 validateMigration(state);check(kinds.includes(kind),'Invalid draw kind');
 check(digest(domainFor(input.manifest,input.lifecycle,state.ledger.head.number))===digest(state.domain),'Migration controller domain changed');
 // Artifacts remain identical across restart and late API arrivals, even at the same block.
 const key=kind+':'+input.request.drawId,old=state.artifacts[key];
 if(old){check(old.inputHash===digest(input),'Stored request changed');return {state:clone(state),artifact:clone(old.artifact)};}
 const artifact=(kind==='SHORT'?sd:md).buildFromLedger(input,state.ledger);
 const next=clone(state);next.artifacts[key]={inputHash:digest(input),revision:state.accounting.revision,artifact};
 return {state:seal(next),artifact:clone(artifact)};
}
