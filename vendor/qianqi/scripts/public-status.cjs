const {hash}=require('./direct-buy.cjs');
const uint=x=>typeof x==='string'&&/^\d+$/.test(x);
function preparePublic(config,index,ledger,projected){
 const projection=index.publicProjection;
 if(projection){
  if(config.publicStatus!==true||projection.head!==index.head||projection.blockHash!==ledger.head.hash||projection.manifestHash!==hash(index.manifest)||!['available','unavailable'].includes(projection.state))throw Error('Invalid public projection status');
  if(projection.state==='unavailable'){if(index.publicObservation!==null||projection.reason!=='rpcUnavailable')throw Error('Invalid unavailable projection');return null;}
  if(!index.publicObservation)throw Error('Missing public observation');
 }
 const o=index.publicObservation;if(!o)return null;
 const manifest=index.manifest.schema==='buy-policy-history-v1'?require('./direct-buy.cjs').buyPolicyHistory(index.manifest).at(index.head):index.manifest;
 const bad=()=>{throw Error('Invalid public observation');};
 if(config.publicStatus!==true||!projected||o.schema!=='promo-public-observation-v1'||BigInt(o.blockTag)!==BigInt(index.head)||o.blockHash!==ledger.head.hash||o.manifestHash!==hash(index.manifest)||o.vault!==config.lifecycle.vault.toLowerCase()||o.asset.address!==manifest.quote.toLowerCase()||o.asset.decimals!==manifest.quoteDecimals||o.asset.codeHash!==manifest.codeHashes.quote||o.asset.symbol!=='USDG')bad();
 if(!Number.isInteger(o.asset.decimals)||o.asset.decimals<0||o.asset.decimals>36)bad();
 for(const k of ['freeShort','freeCurrent','freeNext','nextStartTarget','reserved','claimable','balance'])if(!uint(o.reserves?.[k]))bad();
 for(const kind of ['SHORT','MONTHLY'])if(!uint(o.timing?.[kind]?.earliestAt)||!uint(o.timing?.[kind]?.minimumRaw))bad();
 const records=new Map(projected.draws.map(d=>[d.drawId,d]));
 const history=ledger.draws.map(d=>{
  const money=records.get(d.drawId);if(!money||money.asset!==o.asset.address)bad();
  if((d.status==='CONSUMED')!==(money.status==='finalized'))bad();
  return {drawId:d.drawId,kind:d.kind,status:d.status==='FROZEN'?'inProgress':d.terminal.outcome==='WINNER'?'winner':'noWinner',budgetRaw:money.budget,awardedRaw:money.awarded,paidRaw:money.paid,freeze:d.freeze,terminal:d.terminal,participants:d.snapshot.participants.length,totalAttempts:d.totalAttempts};
 }).reverse();
 return {...o,history,pending:ledger.pending};
}
function renderPublic(config,view,{offset=0,limit=25,now=Date.now()}){
 const o=view.publicView;if(!o)return {schema:'promo-overview-v1',status:'unavailable',asset:null,reserves:null,draws:null,history:null,provenance:null};
 const age=now-Date.parse(view.index.observedAt),fresh=['caughtUp','catchingUp'].includes(view.state.status?.state)&&Number.isFinite(age)&&age>=0&&age<=config.indexer.maxAgeSeconds*1000;
 const draws={};
 for(const kind of ['SHORT','MONTHLY']){
  const free=o.reserves[kind==='SHORT'?'freeShort':'freeCurrent'],t=o.timing[kind];
  const active=o.history.find(d=>d.drawId===o.pending[kind])??null;
  const funding=BigInt(free)>=BigInt(t.minimumRaw)&&(kind==='SHORT'||BigInt(o.reserves.freeNext)>=BigInt(o.reserves.nextStartTarget));
  const time=BigInt(Math.floor(now/1000))>=BigInt(t.earliestAt);
  draws[kind]={active,freeRaw:free,earliestAt:t.earliestAt,minimumRaw:t.minimumRaw,state:active?'inProgress':!funding?'awaitingFunding':!time?'awaitingTime':'awaitingChecks',readiness:'funding-and-earliest-time-only; not-execution-authorization'};
 }
 return {schema:'promo-overview-v1',status:fresh?'observed':'stale',asset:o.asset,reserves:o.reserves,draws,
  history:{items:o.history.slice(offset,offset+limit),offset,limit,total:o.history.length,nextOffset:offset+limit<o.history.length?offset+limit:null},
  provenance:{chainId:String(config.manifest.chainId),head:view.ledger.head,observedAt:view.index.observedAt,manifestHash:view.manifestHash,ledgerHash:view.index.ledgerHash,indexerState:view.state.status?.state,canonicality:'saved-observation-not-live-finality',...require('./project-history.cjs').provenance(view.state.status?.evidenceMode)}};
}
module.exports={preparePublic,renderPublic};
