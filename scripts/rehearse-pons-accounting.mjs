// Offline migration comparison. Reads only explicitly exported public state, never RPC.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {advancePonsAccounting,ponsWallets} from '../src/tickets/pons-accounting.mjs';
import {creditedPurchases} from '../src/tickets/draw-ledger.mjs';
import {digest} from '../src/tickets/digest.mjs';

const root=resolve('.local/pons-accounting'),read=p=>JSON.parse(readFileSync(root+'/'+p,'utf8'));
const saved=read('migration/source-public-state.json'),life=read('migration/qianqi-lifecycle.json');
const result={schema:'pons-migration-comparison-v1',observedAt:new Date().toISOString(),executionEnabled:false,projects:{}};
for(const name of ['igw','qianqi']){
 const report=read('reports/'+name+'.json'),p=report.profile;
 const policy=name==='igw'?saved.igw.policy:{projectId:'qianqi-comparison',contracts:{token:{address:p.token},quote:{address:p.quote}},template:{config:{ticketPurchase:p.threshold}}};
 const credits=name==='igw'?creditedPurchases(policy,saved.igw.ledger):saved.qianqi.ledger.decisions.filter(e=>e.status==='ELIGIBLE').map(e=>({...e,recipient:e.payer,netQuoteDebitRaw:e.grossQuoteRaw}));
 // Real source checkpoint is retained; API observation time is not asserted to be block finality.
 const legacyHead=name==='igw'?saved.igw.ledger.head:saved.qianqi.ledger.head;
 const head={number:legacyHead.number,hash:legacyHead.hash,timestamp:report.checkedAt};
 const state=advancePonsAccounting({policy,report,legacyCredits:credits,head,now:report.checkedAt});
 const wallets=ponsWallets(state,String(BigInt(p.threshold)*10n**6n));
 const repeat=advancePonsAccounting({policy,report,prior:JSON.parse(JSON.stringify(state)),head,now:report.checkedAt});
 assert.deepEqual(ponsWallets(repeat,String(BigInt(p.threshold)*10n**6n)),wallets);
 const lanes={};
 if(name==='qianqi')for(const kind of ['SHORT','MONTHLY']){
  const entries={};
  for(const wallet of new Set([...Object.keys(wallets),...life.wallets.map(w=>w.wallet)])){
   const old=life.wallets.find(w=>w.wallet===wallet)?.[kind];
   const issued=BigInt(wallets[wallet]?.tickets??'0'),used=BigInt(old?.consumedTotal??'0');
   const frozen=Object.values(old?.frozenByDraw??{}).reduce((n,x)=>n+BigInt(typeof x==='object'?x.count:x),0n);
   assert.ok(issued>=used+frozen,'Legacy liabilities exceed migrated tickets');
   assert.ok(issued>=BigInt(old?.mintedTotal??'0'),'Migration lost issued tickets');
   entries[wallet]={issued:String(issued),used:String(used),reserved:String(frozen),available:String(issued-used-frozen),legacy:old??null};
  }
  lanes[kind]={wallets:entries,used:String(Object.values(entries).reduce((s,x)=>s+BigInt(x.used),0n)),reserved:String(Object.values(entries).reduce((s,x)=>s+BigInt(x.reserved),0n)),available:String(Object.values(entries).reduce((s,x)=>s+BigInt(x.available),0n))};
 }
 result.projects[name]={policyHash:digest(policy),sourceStateHash:digest(saved[name]),legacyCredits:credits.length,purePonsGross:report.totalTickets,
  migratedGross:String(Object.values(wallets).reduce((s,w)=>s+BigInt(w.tickets),0n)),wallets,lanes,legacyDifferences:state.legacyDifferences,
  preserved:name==='qianqi'?{draws:life.draws,pending:life.pending,rewards:saved.qianqi.rewards,shortRules:life.shortRules,monthlyRules:life.monthlyRules}:{cycles:saved.igw.cycles,hasPending:saved.igw.hasPending},
  limits:['Offline comparison only; timestamps here are API observation times, not an executable finalized checkpoint','QIANQI epoch assignment of new API credits still requires a versioned migration']};
}
mkdirSync(root+'/migration',{recursive:true});writeFileSync(root+'/migration/comparison.json',JSON.stringify(result,null,2));
for(const [name,p] of Object.entries(result.projects))console.log(JSON.stringify({name,legacyCredits:p.legacyCredits,purePonsGross:p.purePonsGross,migratedGross:p.migratedGross,lanes:Object.fromEntries(Object.entries(p.lanes).map(([k,v])=>[k,{used:v.used,reserved:v.reserved,available:v.available}]))}));
