import {drawAsset,quoteAddress} from '../draws/assets.mjs';
import {isAddress, ZeroAddress} from 'ethers';
import {digest} from './digest.mjs';
import {replayTickets} from './ledger.mjs';
import {participantsHash} from '../draws/short-outcome.mjs';
import {amount} from '../draws/config.mjs';

const check=(v,m)=>{if(!v)throw Error(m);};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const uint=v=>typeof v==='string'&&/^(0|[1-9]\d*)$/.test(v);
const idOf=e=>e.transactionHash.toLowerCase()+':'+Number(e.logIndex);
// The persisted QIANQI USDG policy predates the asset field. Resolve its units
// without rewriting the policy: its digest binds existing credits and journals.
function accountingAsset(policy){
 const config=policy.template.config;
 if(Object.hasOwn(config,'asset'))return drawAsset(config.asset).symbol;
 check(same(policy.contracts.quote?.address,drawAsset('USDG').address),'Unsupported legacy accounting asset');
 return 'USDG';
}

// Pons observations are an explicitly trusted source, not on-chain purchase proofs.
// This adapter preserves old credited amounts when the same purchase appears in Pons.
export function advancePonsAccounting({policy,report,prior,legacyCredits=[],head,now,maxAge=660}){
 check(report?.schema==='pons-purchase-accounting-v1'&&report.source==='Pons API'&&report.status==='current'&&!report.error&&!report.reviewCount,'Pons report unavailable/requires review');
 check(Number.isSafeInteger(report.checkedAt)&&now-report.checkedAt>=0&&now-report.checkedAt<=maxAge,'Stale Pons report');
 check(Number.isSafeInteger(head.number)&&Number.isSafeInteger(head.timestamp)&&/^0x[0-9a-f]{64}$/i.test(head.hash),'Invalid source checkpoint');
 const p=report.profile,asset=accountingAsset(policy);
 check(same(p.token,policy.contracts.token.address)&&same(p.quote,quoteAddress(policy))&&p.decimals===drawAsset(asset).decimals&&amount(p.threshold,undefined,asset)===amount(policy.template.config.ticketPurchase,undefined,asset),'Pons profile mismatch');
 check(Array.isArray(p.excludedWallets)&&Array.isArray(p.venues)&&p.venues.length===1&&p.venues[0]==='curve','Invalid Pons eligibility profile');
 const binding=digest({policy:digest(policy),profile:p});
 check(!prior||prior.binding===binding,'Pons accounting identity changed');
 check(!prior||head.number>=prior.head.number,'Pons checkpoint regressed');
 check(!prior||head.number!==prior.head.number||same(head.hash,prior.head.hash),'Pons checkpoint branch changed');
 const next=prior?structuredClone(prior):{schema:'pons-worker-accounting-v1',binding,records:{},head,revision:0,legacyCredits:structuredClone(legacyCredits),legacyPolicy:'preserve-credited-v1'};
 next.revision++;
 const seen=new Set();
 check(Array.isArray(report.activity)&&report.tradeCount===report.activity.length,'Pons activity count mismatch');
 for(const e of report.activity){
  check(/^0x[0-9a-f]{64}:\d+$/.test(e.id)&&e.id===e.txHash+':'+Number(e.id.split(':')[1])&&!seen.has(e.id),'Invalid/duplicate Pons ID');seen.add(e.id);
  check(isAddress(e.trader)&&e.trader!==ZeroAddress&&uint(e.quoteRaw)&&Number.isSafeInteger(e.timestamp)&&e.timestamp>0,'Invalid Pons amount/trader/time');
  check(['buy','sell'].includes(e.side),'Invalid Pons side');
  const excluded=p.excludedWallets.some(a=>same(a,e.trader));
  const eligible=e.side==='buy'&&p.venues.includes(e.venue)&&!excluded&&BigInt(e.quoteRaw)>0n;
  check(e.decision===(e.side==='sell'?'sale-no-ticket-change':!p.venues.includes(e.venue)?'unsupported-venue':excluded?'excluded-wallet':BigInt(e.quoteRaw)===0n?'zero-amount':'purchase'),'Pons decision mismatch');
  check(e.decision!=='unsupported-venue','Unsupported Pons venue');
  const content={id:e.id,txHash:e.txHash,trader:e.trader.toLowerCase(),quoteRaw:e.quoteRaw,timestamp:e.timestamp,side:e.side,venue:e.venue,eligible};
  if(next.records[e.id])check(digest(next.records[e.id].content)===digest(content),'Pons purchase was corrected');
  else if(e.timestamp<=head.timestamp)next.records[e.id]={content,observedAtBlock:head.number,observedAtRevision:next.revision};
 }
 for(const id of Object.keys(next.records))check(seen.has(id),'Pons purchase disappeared');
 next.head={...head};next.checkedAt=report.checkedAt;next.sourceFingerprint=digest({profile:report.profile,activity:report.activity,tradeCount:report.tradeCount});
 next.legacyDifferences=next.legacyCredits.flatMap(e=>{
  const id=idOf(e),observed=next.records[id]?.content;
  return !observed||!observed.eligible||!same(observed.trader,e.recipient)||observed.quoteRaw!==e.netQuoteDebitRaw?
   [{id,decision:'preserve-existing-credit',legacyWallet:e.recipient,legacyAmountRaw:e.netQuoteDebitRaw,pons:observed??null}]:[];
 });
 // Validate original credits before exposing a new state to the caller.
 ponsWallets(next,String(amount(p.threshold,undefined,asset)),head.number);
 return next;
}

export function ponsWallets(state,threshold,cutoff=state.head.number,revision=state.revision){
 const events=new Map();
 for(const [id,{content:e,observedAtBlock,observedAtRevision}] of Object.entries(state.records))if(e.eligible&&observedAtBlock<=cutoff&&observedAtRevision<=revision)
  events.set(id,{candidateId:id,status:'ELIGIBLE',recipient:e.trader,netQuoteDebitRaw:e.quoteRaw});
 const seen=new Set();
 for(const e of state.legacyCredits){
  check(e.status==='ELIGIBLE'&&isAddress(e.recipient)&&uint(e.netQuoteDebitRaw)&&BigInt(e.netQuoteDebitRaw)>0n,'Invalid legacy credit');
  const id=idOf(e);check(!seen.has(id),'Duplicate legacy credit');seen.add(id);
  const observed=state.records[id]?.content;
  check(state.legacyPolicy==='preserve-credited-v1','Missing migration decision');
  // Historical credits retain their original beneficiary and amount. The API row
  // with this ID is replaced, never credited again to a different beneficiary.
  events.set(id,{...e,candidateId:id});
 }
 return replayTickets([...events.values()],threshold);
}

export async function snapshotPonsTickets(policy,state,program,cutoff=state.head,revision=state.revision){
 check(Number.isSafeInteger(revision)&&revision>0&&revision<=state.revision,'Invalid Pons snapshot revision');
 const wallets=ponsWallets(state,String(amount(policy.template.config.ticketPurchase,undefined,accountingAsset(policy))),cutoff.number,revision),participants=[];
 for(const wallet of Object.keys(wallets).sort()){
  const used=BigInt(await program.consumedThrough(wallet)),end=BigInt(wallets[wallet].tickets);
  check(used>=0n&&used<=end,'Consumed attempts exceed Pons/migrated history');
  if(used<end)participants.push({wallet,firstAttempt:String(used+1n),lastAttempt:String(end)});
 }
 check(participants.length<=1000,'Participant contract limit exceeded');
 const content={source:'pons-api-v1',binding:state.binding,program:program.target.toLowerCase(),cutoff,revision,wallets,participants};
 return {participants,participantsHash:participantsHash(participants),checkpoint:{number:cutoff.number,blockHash:cutoff.hash,timestamp:cutoff.timestamp,ledgerHash:'0x'+digest(content)}};
}
