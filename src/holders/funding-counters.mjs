import {Contract,keccak256} from 'ethers';
import {check} from './values.mjs';
import {validateFundingPolicy} from './funding-receipt.mjs';

// Compare at one finalized block, including scans of older pages when the local
// journal already contains later receipts. No assumption about current balance:
// holder funds may already have been paid out.
export async function checkFundingCounters(program,provider,block,{deploymentHead}={}){
 const p=validateFundingPolicy(program.fundingPolicy,program.scope);
 check(Number((await provider.getNetwork()).chainId)===program.scope.chainId,'Wrong funding chain');
 check(block&&block.number>=p.fromBlock,'Missing funding checkpoint');
 const expected={splitter:0n,vault:0n};
 for(const e of program.events){
  const role=e.type==='fee.received'?'splitter':e.type==='holder.deposited'?'vault':null;
  if(role&&e.evidence.blockNumber<=block.number)expected[role]+=BigInt(e.amount);
 }
 for(const role of ['splitter','vault']){
  const code=await provider.getCode(p[role].address,block.number);
  // A bounded recovery page can end between deployment steps. Empty historical
  // code is acceptable only with zero local receipts and the pinned code at head.
  if(code==='0x'&&deploymentHead&&deploymentHead.number>=block.number&&expected[role]===0n){
   check(keccak256(await provider.getCode(p[role].address,deploymentHead.number))===p[role].codeHash,'Funding deployment runtime changed');continue;
  }
  check(keccak256(code)===p[role].codeHash,'Funding counter runtime changed');
  const c=new Contract(p[role].address,['function totalReceived() view returns(uint256)'],provider);
  if(await c.totalReceived({blockTag:block.number})!==expected[role])throw Object.assign(Error('holder-funding-evidence-missing'),{code:'HOLDER_FUNDING_EVIDENCE_MISSING'});
 }
 check((await provider.getBlock(block.number))?.hash===block.hash,'Funding checkpoint changed');
 return {received:String(expected.splitter),holderDelivered:String(expected.vault)};
}
