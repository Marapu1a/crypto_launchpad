import {drawAsset} from '../../src/draws/assets.mjs';
import {drawEligibleAt} from '../../src/worker/draw-schedule.mjs';
import {keccak256} from 'ethers';
import {digest} from '../../src/tickets/digest.mjs';
import {drawContracts,validateDrawPolicy} from '../../src/worker/draw-policy.mjs';
import {creditedPurchases} from '../../src/tickets/draw-ledger.mjs';
import {replayTickets} from '../../src/tickets/ledger.mjs';
import {amount,validateBasket} from '../../src/draws/config.mjs';
import {check,same} from '../../src/worker/production-template.mjs';
import {projectWallets} from './draw-wallets.mjs';
import {deferred,pendingPurchases} from '../../src/tickets/deferred-recognition.mjs';
import {ponsWallets} from '../../src/tickets/pons-accounting.mjs';

// Whitelisted, finalized public data. No journal, signer, policy or purchase evidence.
export async function buildDrawSnapshot({provider,policy,state,metadata={}}){
 const config=validateDrawPolicy(policy);
 check(state.identity===digest(policy)&&state.runtime?.schema==='draw-runtime-v2','Invalid draw projection source');
 const ledger=state.runtime.ledger,pons=state.runtime.ponsAccounting,reference=pons?.head??ledger.head,head=await provider.getBlock(reference.number),finalized=await provider.getBlock('finalized');
 check(head&&finalized&&head.number<=finalized.number&&same(head.hash,reference.hash),'Projection is not finalized/canonical');
 const c=drawContracts({call:r=>provider.call({...r,blockTag:head.number})},policy);
 const thresholdRaw=String(amount(config.ticketPurchase,undefined,config.asset)),credited=creditedPurchases(policy,ledger,head.number),wallets=pons?ponsWallets(pons,thresholdRaw):replayTickets(credited,thresholdRaw),ids=new Set(credited.map(e=>e.candidateId));
 const waiting=!pons&&deferred(policy)?pendingPurchases(ledger,ids):[],pendingByWallet={};
 for(const e of waiting)for(const address of new Set([e.observedSender,e.observedRecipient].filter(Boolean))){
  const bucket=pendingByWallet[address]??={count:0,items:[]};bucket.count++;
  if(bucket.items.length<20)bucket.items.push({transactionHash:e.transactionHash,blockNumber:e.blockNumber,status:e.status});
 }
 const common={checkpoint:{number:head.number,hash:head.hash,timestamp:head.timestamp},finalized:{number:finalized.number,timestamp:finalized.timestamp},
  ...(pons?{purchaseAccounting:{source:'Pons API',mode:state.runtime.ponsMode??'rehearsal',checkedAt:pons.checkedAt,revision:pons.revision}}:{}),
  metadata:Object.fromEntries(['symbol','description','logo'].map(k=>[k,String(metadata[k]??'')])),
  tickets:{source:pons?'pons-api-v1':'chain-recognition',creditedPurchases:pons?new Set([...Object.values(pons.records).filter(r=>r.content.eligible).map(r=>r.content.id),...pons.legacyCredits.map(e=>e.transactionHash.toLowerCase()+':'+Number(e.logIndex))]).size:credited.length,wallets:Object.keys(wallets).length,totalIssued:String(Object.values(wallets).reduce((n,w)=>n+BigInt(w.tickets),0n)),awaitingRecognition:pons?0:deferred(policy)?waiting.length:ledger.events.filter(e=>e.status==='ELIGIBLE'&&!ids.has(e.candidateId)).length}};
 const draws=[];
 for(const kind of ['short','monthly'])if(config[kind].enabled){
  check(same(keccak256(await provider.getCode(policy.contracts[kind].address,head.number)),policy.contracts[kind].codeHash),'Program runtime changed');
  const program=c[kind],settings=config[kind];
  const [fund,liabilities,cycle,pending,lastTerminal]=await Promise.all(['freeFund','liabilities','cycle','pending','lastTerminal'].map(k=>program[k]()));
  let draw=null;
  if(cycle>0n){const d=await program.draws(cycle),frozen=state.runtime.cycles[kind]?.[String(cycle)];
   check(frozen&&same(d.participantsHash,frozen.participantsHash)&&d.budget===BigInt(frozen.budget),'Draw snapshot missing');
   draw={cycle:String(cycle),budgetRaw:String(d.budget),awardedRaw:String(d.awarded),settled:d.settled};
  }
  let minimum=amount(settings.minimumFund,undefined,config.asset);
  if(kind==='short'){const basket=validateBasket(settings.basket,config.asset).minimumBudget;if(basket>minimum)minimum=basket;}
  draws.push({...common,kind,program:program.target,settings:{asset:config.asset,decimals:drawAsset(config.asset).decimals,...(config.schedule?{schedule:{...config.schedule}}:{}),thresholdRaw,minimumFundRaw:String(minimum),intervalSeconds:settings.intervalSeconds,
   creatorFeeBps:policy.template.creatorTaxBps,splitBps:[config.fees.prizesBps,config.fees.teamBps,config.fees.operationsBps],weights:kind==='short'?[...settings.basket.weights]:[1],allocationBps:kind==='short'?config.allocation.shortBps:10000-config.allocation.shortBps},
   walletSnapshot:{schema:'draw-wallets-v1',pending:pendingByWallet,items:await projectWallets({wallets,program,pending,cycle,frozen:state.runtime.cycles[kind]?.[String(cycle)]})},
   fundRaw:String(fund),liabilitiesRaw:String(liabilities),cycle:String(cycle),pending,nextEligibleAt:String(await drawEligibleAt(provider,policy,kind,cycle,lastTerminal,settings.intervalSeconds)),draw,
   ...(kind==='monthly'?{nextFundRaw:String(await program.freeNext()),nextTargetRaw:String(await program.nextTarget())}:{})});
 }
 check(same((await provider.getBlock(head.number))?.hash,head.hash)&&same((await provider.getBlock(finalized.number))?.hash,finalized.hash),'Projection branch changed');
 return {schema:'draw-public-v2',...common,draws};
}
