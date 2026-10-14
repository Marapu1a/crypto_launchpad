// Snapshot producer uses RPC; the renderer deliberately has no provider or signer.
import {createRequire} from 'node:module';
import {Contract,ZeroHash,toQuantity,isAddress} from 'ethers';
import {validateMigration} from './pons-migration.mjs';
import {ponsWallets} from '../../../src/tickets/pons-accounting.mjs';
import {amount} from '../../../src/draws/config.mjs';
import {digest} from '../../../src/tickets/digest.mjs';
import {ponsFreshness,CONTRACT_MAX_AGE_MS} from '../../shared/pons-freshness.mjs';
const require=createRequire(import.meta.url);
const {observePublic}=require('./runtime/scripts/public-observation.cjs');
const {renderPublic}=require('./runtime/scripts/public-status.cjs');
const {domainFor}=require('./runtime/scripts/attempt-lifecycle.cjs');
const {hash}=require('./runtime/scripts/direct-buy.cjs');
const check=(ok,m)=>{if(!ok)throw Error(m);};
const page=(rows,offset,limit)=>({items:rows.slice(offset,offset+limit),offset,limit,total:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null});
export async function buildPonsPublicSnapshot({provider,config,migration,now=Date.now(),mode='rehearsal',serviceObservation}){
 check(['rehearsal','production'].includes(mode),'Invalid public snapshot mode');
 validateMigration(migration);
 if(serviceObservation&&migration.accounting.sourceFingerprint!==serviceObservation.sourceFingerprint)serviceObservation={sourceFingerprint:null,sourceCheckedAt:migration.accounting.checkedAt};
 check(digest(domainFor(config.manifest,config.lifecycle))===digest(migration.domain),'Public migration domain mismatch');
 const head=await provider.getBlock('finalized');check(head,'Missing public checkpoint');
 check(head.number>=migration.accounting.head.number,'Accounting ahead of public finality');
 check((await provider.getBlock(migration.accounting.head.number))?.hash===migration.accounting.head.hash,'Accounting checkpoint changed');
 check((await provider.getBlock(migration.boundary.number))?.hash===migration.boundary.hash,'Migration boundary changed');
 for(const r of Object.values(migration.controllerReceipts??{}))check(r.blockNumber<=head.number,'Receipt ahead of public finality');
 const at={blockTag:head.number};
 // Detect outside controller actions before presenting the saved ticket balances as current.
 for(const kind of ['SHORT','MONTHLY']){
  const short=kind==='SHORT',names=short?['currentShortEpoch','drainingShortEpoch','pendingDatasetDraw','lastShortTerminalAt']:['currentMonthlyEpoch','drainingMonthlyEpoch','pendingMonth','lastMonthAt'];
  const c=new Contract(migration.domain[short?'source':'monthlySource'],names.map((n,i)=>`function ${n}() view returns(${i===2?'bytes32':'uint256'})`),provider),r=migration.ledger[short?'shortRules':'monthlyRules'];
  const values=await Promise.all(names.map(n=>c[n](at)));
  check(Number(values[0])===r.currentEpoch&&Number(values[1])===r.drainingEpoch&&values[2]===(migration.ledger.pending[kind]??ZeroHash)&&Number(values[3])===r.lastTerminalAt,'Public controller receipts required');
 }
 const observation=await observePublic({config,manifest:config.manifest,rpc:(m,p)=>provider.send(m,p),blockTag:toQuantity(head.number),blockHash:head.hash});
 const vault=new Contract(migration.domain.vault,['function draws(bytes32) view returns(address asset,uint64 campaignId,uint8 status,uint256 budget,uint256 awarded,uint256 paid)','function reward(bytes32,address) view returns(uint256)'],provider);
 const history=[];
 for(const d of migration.ledger.draws){
  const money=await vault.draws(d.drawId,at);
  check(money.asset.toLowerCase()===observation.asset.address&&Number(money.status)===(d.status==='CONSUMED'?2:1),'Public draw storage mismatch');
  history.push({drawId:d.drawId,kind:d.kind,status:d.status==='FROZEN'?'inProgress':d.terminal.outcome==='WINNER'?'winner':'noWinner',budgetRaw:String(money.budget),awardedRaw:String(money.awarded),paidRaw:String(money.paid),freeze:d.freeze,terminal:d.terminal,startedAt:null,completedAt:null,participants:d.snapshot.participants.length,totalAttempts:d.totalAttempts});
 }
 const rewards=[...(migration.rewards?.rewards??[]),...(migration.controllerRewards??[]).map(r=>({drawId:r.drawId,winner:r.winner,asset:observation.asset.address,amountRaw:r.amount,status:r.paid?'paid':'assigned',assignment:r.assigned,payment:r.payment??null}))];
 for(const r of rewards)check(await vault.reward(r.drawId,r.winner,at)===(r.status==='paid'?0n:BigInt(r.amountRaw)),'Public reward receipts required');
 const threshold=String(amount(migration.policy.template.config.ticketPurchase)),totals=ponsWallets(migration.accounting,threshold);
 const buys=new Map();
 for(const [key,{content:e,observedAtRevision}] of Object.entries(migration.accounting.records))if(e.eligible)buys.set(key,{wallet:e.trader,transactionHash:e.txHash,logIndex:Number(key.split(':').at(-1)),status:'ELIGIBLE',grossQuoteRaw:e.quoteRaw,accountingSource:'pons-api-v1',purchaseTime:e.timestamp,admissionRevision:observedAtRevision});
 for(const e of migration.accounting.legacyCredits)buys.set(`${e.transactionHash.toLowerCase()}:${Number(e.logIndex)}`,{wallet:e.recipient.toLowerCase(),transactionHash:e.transactionHash,blockNumber:e.blockNumber,logIndex:e.logIndex,status:'ELIGIBLE',grossQuoteRaw:e.netQuoteDebitRaw,accountingSource:'preserved-legacy-credit'});
 // Existing credits first, then new admissions. This explains carry without backdating new tickets.
 const purchases=[...buys.values()].sort((a,b)=>Number(a.accountingSource==='pons-api-v1')-Number(b.accountingSource==='pons-api-v1')||(a.admissionRevision??0)-(b.admissionRevision??0)||(a.blockNumber??a.purchaseTime??0)-(b.blockNumber??b.purchaseTime??0)||a.logIndex-b.logIndex||a.transactionHash.localeCompare(b.transactionHash)),spent=new Map();
 for(const p of purchases){const before=spent.get(p.wallet)??0n,after=before+BigInt(p.grossQuoteRaw);p.entriesMinted=String(after/BigInt(threshold)-before/BigInt(threshold));spent.set(p.wallet,after);}
 const wallets={};
 for(const w of migration.ledger.wallets)wallets[w.wallet]={balances:{SHORT:w.SHORT,MONTHLY:w.MONTHLY,carryRaw:totals[w.wallet]?.remainder??'0',entryThresholdRaw:threshold,quoteDecimals:config.manifest.quoteDecimals}};
 const observedAt=new Date(now).toISOString(),checkedAt=migration.accounting.checkedAt;
 check((await provider.getBlock(head.number))?.hash===head.hash,'Public checkpoint changed during observation');
 return {schema:'qianqi-pons-public-v1',mode,...(serviceObservation?{serviceObservation}:{}),configHash:digest({manifest:config.manifest,lifecycle:config.lifecycle}),entryThresholdRaw:threshold,head:{number:head.number,hash:head.hash,timestamp:head.timestamp},observedAt,checkedAt,
  manifestHash:hash(config.manifest),ledgerHash:digest(migration.ledger),purchaseAccounting:{source:'Pons API',revision:migration.accounting.revision,checkedAt,legacyPolicy:migration.accounting.legacyPolicy},
  publicView:{...observation,history:history.reverse(),pending:migration.ledger.pending},wallets,purchases,rewards};
}
export function renderPonsPublic(config,snapshot,{wallet,offset=0,limit=25,now=Date.now(),maxAgeSeconds=660}={}){
 check((wallet===undefined||isAddress(wallet))&&Number.isSafeInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=100,'Invalid public query');
 check(snapshot.schema==='qianqi-pons-public-v1'&&snapshot.manifestHash===hash(config.manifest)&&snapshot.configHash===digest({manifest:config.manifest,lifecycle:config.lifecycle}),'Invalid Pons public snapshot');
 const age=now-Date.parse(snapshot.observedAt),sourceAge=now-snapshot.checkedAt*1000;
 const freshness=snapshot.serviceObservation?ponsFreshness({...snapshot.serviceObservation,observedAt:snapshot.observedAt,now}):null;
 const fresh=freshness?!freshness.stale:age>=0&&age<=maxAgeSeconds*1000&&sourceAge>=0&&sourceAge<=maxAgeSeconds*1000;
 const view={publicView:snapshot.publicView,index:{observedAt:snapshot.observedAt,ledgerHash:snapshot.ledgerHash},state:{status:{state:fresh?'caughtUp':'stale'}},ledger:{head:snapshot.head},manifestHash:snapshot.manifestHash};
 const overview=renderPublic({...config,indexer:{maxAgeSeconds:freshness?.awaitingActivity?Math.max(CONTRACT_MAX_AGE_MS/1000,age/1000+1):freshness?CONTRACT_MAX_AGE_MS/1000:maxAgeSeconds}},view,{offset,limit,now});
 const provenance={...overview.provenance,canonicality:'saved-finalized-contract-observation; purchases-from-pons-api',purchaseAccounting:snapshot.purchaseAccounting,mode:snapshot.mode,...(freshness?{freshness}:{})};
 if(wallet===undefined)return structuredClone({...overview,provenance});
 const address=wallet.toLowerCase(),empty=()=>({mintedTotal:'0',open:'0',consumedTotal:'0',frozenByDraw:{},byEpoch:[]});
 const balances=snapshot.wallets[address]?.balances??{SHORT:empty(),MONTHLY:empty(),carryRaw:'0',entryThresholdRaw:snapshot.entryThresholdRaw,quoteDecimals:config.manifest.quoteDecimals};
 return structuredClone({schema:'promo-wallet-status-v1',status:overview.status,wallet:address,provenance,balances,asset:overview.asset,
  purchases:{...page(snapshot.purchases.filter(p=>p.wallet===address),offset,limit),coverage:'pons-api-with-preserved-legacy-credits'},
  rewards:{...page(snapshot.rewards.filter(r=>r.winner.toLowerCase()===address),offset,limit),coverage:'saved-legacy-rewards-and-controller-receipts',vault:config.lifecycle.vault}});
}
