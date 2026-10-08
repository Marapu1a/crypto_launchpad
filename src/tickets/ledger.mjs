import { participantsHash } from '../draws/short-outcome.mjs';
import { creditedEvents } from './late-recognition.mjs';
import { digest } from './digest.mjs';
export { digest } from './digest.mjs';
export function replayTickets(events, thresholdRaw) {
  if(typeof thresholdRaw!=='string'||!/^[1-9]\d*$/.test(thresholdRaw))throw Error('Invalid ticket threshold');
  const threshold=BigInt(thresholdRaw),wallets={},seen=new Set();
  for(const e of events){
    if(seen.has(e.candidateId))throw Error('Duplicate purchase evidence');seen.add(e.candidateId);
    if(e.status!=='ELIGIBLE')continue;
    if(!/^[1-9]\d*$/.test(e.netQuoteDebitRaw))throw Error('Invalid net debit');
    const wallet=e.recipient.toLowerCase(),prior=wallets[wallet]??{spent:'0',tickets:'0',remainder:'0'};
    const spent=BigInt(prior.spent)+BigInt(e.netQuoteDebitRaw),tickets=spent/threshold;
    if(tickets>=(1n<<128n))throw Error('Ticket uint128 overflow');
    wallets[wallet]={spent:String(spent),tickets:String(tickets),remainder:String(spent%threshold)};
  }
  return wallets;
}
export function snapshotTickets(state, cutoff, consumed={}) {
  if(!Number.isSafeInteger(cutoff)||cutoff<state.profile.anchor.number||cutoff>state.head.number)throw Error('Invalid cutoff');
  const block=state.blocks.find(b=>b.number===cutoff)??(cutoff===state.profile.anchor.number?state.profile.anchor:null);
  if(!block)throw Error('Missing cutoff evidence');
  const sources=new Map(state.blocks.flatMap(b=>b.events.map(event=>[event.candidateId,b.number])));
  const blocks=new Map(state.blocks.map(b=>[b.number,b.hash]));
  const events=creditedEvents(state).filter(event=>{
    const position=event.creditedAt??event;
    const number=position.blockNumber??sources.get(event.candidateId);
    if(event.creditedAt && blocks.get(number)!==position.blockHash)throw Error('Missing credit block');
    return number<=cutoff;
  });
  const wallets=replayTickets(events,state.profile.thresholdRaw);
  const participants=[];
  for(const wallet of [...new Set([...Object.keys(wallets),...Object.keys(consumed)])].sort()){
    const end=BigInt(wallets[wallet]?.tickets??'0'),used=BigInt(consumed[wallet]??'0');
    if(used<0n||used>end)throw Error('Consumed attempts exceed indexed history');
    if(end>used)participants.push({wallet,firstAttempt:String(used+1n),lastAttempt:String(end)});
  }
  const result={schema:'launchpad-short-tickets-v1',profileHash:digest(state.profile),cutoff,blockHash:block.hash,participants,participantsHash:participantsHash(participants)};
  return {...result,snapshotHash:digest(result)};
}
