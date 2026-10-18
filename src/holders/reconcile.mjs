import {Contract,keccak256} from 'ethers';
import {check,identity} from './values.mjs';
import {observeHolderFunding} from './funding-receipt.mjs';
import {replayHolderProgram} from './program.mjs';

// Explicit restart/pre-allocation check. No polling, rewind, synthetic credits or payouts.
export async function reconcileHolderFunding(program,provider,{maxEvents=1000}={}){
 const state=replayHolderProgram(program),policy=program.fundingPolicy;
 check(policy,'Observed funding policy required');
 check(Number.isSafeInteger(maxEvents)&&maxEvents>0&&maxEvents<=10000,'Invalid reconciliation budget');
 const events=program.events.filter(e=>['fee.received','holder.deposited'].includes(e.type));
 check(events.length<=maxEvents,'Funding reconciliation budget exceeded');
 check(Number((await provider.getNetwork()).chainId)===program.scope.chainId,'Wrong reconciliation chain');
 const checkpoint=await provider.getBlock('finalized');check(checkpoint&&checkpoint.number>=policy.fromBlock,'No finalized funding checkpoint');
 for(const role of ['splitter','vault','collector','draw'])check(keccak256(await provider.getCode(policy[role].address,checkpoint.number))===policy[role].codeHash,'Reconciliation runtime changed');
 for(const saved of events){
  check(saved.evidence.blockNumber<=checkpoint.number,'Finality regressed below recorded funding');
  const fresh=await observeHolderFunding({provider,policy,scope:program.scope,txHash:saved.evidence.txHash,logIndex:saved.evidence.logIndex});
  check(identity(fresh)===identity(saved),'Stored funding evidence no longer matches chain');
 }
 const at={blockTag:checkpoint.number};
 const split=new Contract(policy.splitter.address,['function totalReceived() view returns(uint256)'],provider);
 const vault=new Contract(policy.vault.address,['function totalReceived() view returns(uint256)'],provider);
 check(String(await split.totalReceived(at))===state.fees.received,'Missing or changed revenue evidence');
 check(String(await vault.totalReceived(at))===state.fees.holderDelivered,'Missing or changed deposit evidence');
 // Funding-only vault has no payments yet; excess (forced ETH) is not available credit.
 check(await provider.getBalance(policy.vault.address,checkpoint.number)>=BigInt(state.fees.holderDelivered),'Holder vault is underfunded');
 check((await provider.getBlock(checkpoint.number))?.hash===checkpoint.hash,'Funding checkpoint reorg');
 return {status:'reconciled',checkpoint:{number:checkpoint.number,hash:checkpoint.hash},programHash:identity(program),checkedEvents:events.length,executionEnabled:false};
}
