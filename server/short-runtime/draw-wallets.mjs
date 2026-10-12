import {check,same} from '../../src/worker/production-template.mjs';
import {participantsHash} from '../../src/draws/short-outcome.mjs';

// Only confirmed ledger amounts and reads at the projection's canonical block.
// A frozen ticket is reserved until settlement; late purchases remain available.
export async function projectWallets({wallets,program,pending,cycle,frozen}){
 if(pending){
  check(frozen&&same(participantsHash(frozen.participants),frozen.participantsHash),'Invalid frozen wallet snapshot');
  check(frozen.participants.every(p=>wallets[p.wallet.toLowerCase()]&&BigInt(wallets[p.wallet.toLowerCase()].tickets)>=BigInt(p.lastAttempt)),'Frozen wallet missing from ledger');
 }
 const entries=Object.entries(wallets),result={};let cursor=0;
 await Promise.all(Array.from({length:Math.min(8,entries.length)},async()=>{
  while(cursor<entries.length){
   const [wallet,w]=entries[cursor++],issued=BigInt(w.tickets),used=await program.consumedThrough(wallet);
   const participant=pending?frozen?.participants?.find(p=>same(p.wallet,wallet)):null;
   const reserved=participant?BigInt(participant.lastAttempt)-BigInt(participant.firstAttempt)+1n:0n;
   check(used>=0n&&used<=issued&&reserved>=0n&&used+reserved<=issued,'Invalid wallet ticket counters');
   if(participant)check(BigInt(participant.firstAttempt)===used+1n,'Frozen wallet range mismatch');
   result[wallet]={eligibleVolumeRaw:w.spent,totalIssued:w.tickets,used:String(used),reserved:String(reserved),available:String(issued-used-reserved),remainderRaw:w.remainder,
    latestCycle:String(cycle),latestUnpaidRewardRaw:cycle>0n?String(await program.rewards(cycle,wallet)):'0'};
  }
 }));
 return result;
}
