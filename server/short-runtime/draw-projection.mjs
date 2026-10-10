import {keccak256} from 'ethers';
import {digest} from '../../src/tickets/digest.mjs';
import {drawContracts,validateDrawPolicy} from '../../src/worker/draw-policy.mjs';
import {creditedPurchases} from '../../src/tickets/draw-ledger.mjs';
import {replayTickets} from '../../src/tickets/ledger.mjs';
import {amount,validateBasket} from '../../src/draws/config.mjs';
import {check,same} from '../../src/worker/production-template.mjs';

// Whitelisted, finalized public data. No journal, signer, policy or purchase evidence.
export async function buildDrawSnapshot({provider,policy,state,metadata={}}){
 const config=validateDrawPolicy(policy);
 check(state.identity===digest(policy)&&state.runtime?.schema==='draw-runtime-v2','Invalid draw projection source');
 const ledger=state.runtime.ledger,head=await provider.getBlock(ledger.head.number),finalized=await provider.getBlock('finalized');
 check(head&&finalized&&head.number<=finalized.number&&same(head.hash,ledger.head.hash),'Projection is not finalized/canonical');
 const c=drawContracts({call:r=>provider.call({...r,blockTag:head.number})},policy);
 const thresholdRaw=String(amount(config.ticketPurchase)),credited=creditedPurchases(policy,ledger,head.number),wallets=replayTickets(credited,thresholdRaw),ids=new Set(credited.map(e=>e.candidateId));
 const common={checkpoint:{number:head.number,hash:head.hash,timestamp:head.timestamp},finalized:{number:finalized.number,timestamp:finalized.timestamp},
  metadata:Object.fromEntries(['symbol','description','logo'].map(k=>[k,String(metadata[k]??'')])),
  tickets:{creditedPurchases:credited.length,wallets:Object.keys(wallets).length,totalIssued:String(Object.values(wallets).reduce((n,w)=>n+BigInt(w.tickets),0n)),awaitingRecognition:ledger.events.filter(e=>e.status==='ELIGIBLE'&&!ids.has(e.candidateId)).length}};
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
  let minimum=amount(settings.minimumFund);
  if(kind==='short'){const basket=validateBasket(settings.basket).minimumBudget;if(basket>minimum)minimum=basket;}
  draws.push({...common,kind,program:program.target,settings:{asset:'USDG',decimals:6,thresholdRaw,minimumFundRaw:String(minimum),intervalSeconds:settings.intervalSeconds,
   creatorFeeBps:policy.template.creatorTaxBps,splitBps:[config.fees.prizesBps,config.fees.teamBps,config.fees.operationsBps],weights:kind==='short'?[...settings.basket.weights]:[1],allocationBps:kind==='short'?config.allocation.shortBps:10000-config.allocation.shortBps},
   fundRaw:String(fund),liabilitiesRaw:String(liabilities),cycle:String(cycle),pending,nextEligibleAt:String(lastTerminal+BigInt(settings.intervalSeconds)),draw,
   ...(kind==='monthly'?{nextFundRaw:String(await program.freeNext()),nextTargetRaw:String(await program.nextTarget())}:{})});
 }
 check(same((await provider.getBlock(head.number))?.hash,head.hash)&&same((await provider.getBlock(finalized.number))?.hash,finalized.hash),'Projection branch changed');
 return {schema:'draw-public-v2',...common,draws};
}
