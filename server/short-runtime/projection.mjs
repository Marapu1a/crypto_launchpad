import {buildDrawSnapshot} from './draw-projection.mjs';
import {keccak256} from 'ethers';
import {inProject,verifyRole} from '../shared/store.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {contracts,check,same} from '../../src/worker/production-template.mjs';
import {creditedPurchases} from '../../src/tickets/production-ledger.mjs';
import {replayTickets} from '../../src/tickets/ledger.mjs';

// Explicit public fields only. Never serialize a policy, journal or RPC exception.
export async function buildShortSnapshot({provider,policy,state,metadata={}}){
 check(state.identity===digest(policy)&&state.runtime?.schema==='production-runtime-v1','Invalid projection source');
 const ledger=state.runtime.ledger,head=await provider.getBlock(ledger.head.number),finalized=await provider.getBlock('finalized');
 check(head&&finalized&&head.number<=finalized.number&&same(head.hash,ledger.head.hash),'Projection is not finalized/canonical');
 check(same((await provider.getBlock(finalized.number))?.hash,finalized.hash),'Finality branch changed');
 check(same(keccak256(await provider.getCode(policy.contracts.program.address,head.number)),policy.contracts.program.codeHash),'Program runtime changed');
 const c=contracts({call:request=>provider.call({...request,blockTag:head.number})},policy),t=policy.template;
 const [fund,liabilities,cycle,pending,lastTerminal]=await Promise.all(['freeFund','liabilities','cycle','pending','lastTerminal'].map(k=>c.program[k]()));
 let draw=null;
 if(cycle>0n){
  const d=await c.program.draws(cycle),frozen=state.runtime.cycles[String(cycle)];
  check(frozen&&same(d.participantsHash,frozen.participantsHash)&&d.budget===BigInt(frozen.budget),'Draw snapshot missing');
  draw={cycle:String(cycle),budgetRaw:String(d.budget),awardedRaw:String(d.awarded),settled:d.settled};
 }
 const credited=creditedPurchases(policy,ledger,head.number),wallets=replayTickets(credited,t.thresholdRaw),ids=new Set(credited.map(e=>e.candidateId));
 const minimumBasket=t.weights.reduce((a,b)=>a+BigInt(b),0n)*BigInt(t.minimumUnit);
 const threshold=minimumBasket>BigInt(t.minimumFund)?minimumBasket:BigInt(t.minimumFund);
 const snapshot={schema:'short-public-v1',checkpoint:{number:head.number,hash:head.hash,timestamp:head.timestamp},finalized:{number:finalized.number,timestamp:finalized.timestamp},
  metadata:{symbol:String(metadata.symbol??''),description:String(metadata.description??''),logo:String(metadata.logo??'')},
  settings:{asset:'USDG',decimals:6,thresholdRaw:t.thresholdRaw,minimumFundRaw:String(threshold),intervalSeconds:Number(t.interval),creatorFeeBps:t.creatorTaxBps,splitBps:[...t.bps],weights:[...t.weights]},
  fundRaw:String(fund),liabilitiesRaw:String(liabilities),cycle:String(cycle),pending,
  nextEligibleAt:String(lastTerminal+BigInt(t.interval)),draw,
  tickets:{creditedPurchases:credited.length,wallets:Object.keys(wallets).length,totalIssued:String(Object.values(wallets).reduce((n,w)=>n+BigInt(w.tickets),0n)),awaitingRecognition:ledger.events.filter(e=>e.status==='ELIGIBLE'&&!ids.has(e.candidateId)).length}};
 check(same((await provider.getBlock(head.number))?.hash,head.hash),'Projection branch changed');return snapshot;
}

export async function publishShortView({pool,provider,projectId,moduleId,status,reason,alerts=[]}){
 await verifyRole(pool,'lp_executor');
 const allowed=['paused','blocked','busy','waiting','confirmed','already-confirmed','idle'];check(allowed.includes(status),'Invalid public status');
 const attention=alerts.length>0||['chain-clock','finality-unavailable','finality-regression','native-balance','gas-limit','gas-price','external-pending-nonce','latest-beacon-unavailable','beacon-unavailable'].includes(reason);
 const publicStatus=status==='paused'?'paused':attention?'blocked':status;
 let failed=false;
 try{
  if(['paused','blocked','busy'].includes(status))return;
  const source=await inProject(pool,projectId,async c=>{
   const {rows:[r]}=await c.query('SELECT policy_text,policy_hash,state_text,state_hash,revision FROM launchpad.production_senders WHERE project_id=$1 AND module_id=$2',[projectId,moduleId]);check(r,'Sender missing');
   const policy=JSON.parse(r.policy_text),state=JSON.parse(r.state_text);check(digest(policy)===r.policy_hash&&digest(state)===r.state_hash&&policy.projectId===projectId,'Projection source checksum');
   const {rows:[launch]}=await c.query('SELECT state_text,state_hash FROM launchpad.owner_launches WHERE project_id=$1',[projectId]);
   let metadata={};if(launch){const s=JSON.parse(launch.state_text);check(digest(s)===launch.state_hash&&s.input.id===projectId,'Launch metadata checksum');metadata=s.input.draft;}
   return {policy,state,metadata,revision:r.revision};
  });
  const snapshot=await (source.policy.schema==='draw-production-policy-v2'?buildDrawSnapshot:buildShortSnapshot)({provider,...source});
  const saved=await inProject(pool,projectId,c=>c.query(`INSERT INTO launchpad.short_public_views(project_id,module_id,source_revision,snapshot,observed_at,service_status)
   VALUES($1,$2,$3,$4,clock_timestamp(),$5) ON CONFLICT(project_id,module_id) DO UPDATE SET
   source_revision=EXCLUDED.source_revision,snapshot=EXCLUDED.snapshot,observed_at=EXCLUDED.observed_at,
   service_status=EXCLUDED.service_status,service_at=clock_timestamp(),projection_failed=false
   WHERE (launchpad.short_public_views.source_revision IS NULL OR launchpad.short_public_views.source_revision<=EXCLUDED.source_revision)
   AND (launchpad.short_public_views.snapshot IS NULL OR (launchpad.short_public_views.snapshot->'checkpoint'->>'number')::bigint<=(EXCLUDED.snapshot->'checkpoint'->>'number')::bigint)`,[projectId,moduleId,source.revision,JSON.stringify(snapshot),publicStatus]),{readOnly:false});
  check(saved.rowCount===1,'Public snapshot already advanced');
 }catch{failed=true;}
 finally{
  await inProject(pool,projectId,c=>c.query(`INSERT INTO launchpad.short_public_views(project_id,module_id,service_status,projection_failed) VALUES($1,$2,$3,$4)
   ON CONFLICT(project_id,module_id) DO UPDATE SET service_status=EXCLUDED.service_status,service_at=clock_timestamp(),projection_failed=EXCLUDED.projection_failed`,[projectId,moduleId,publicStatus,failed]),{readOnly:false});
 }
 return {failed};
}
