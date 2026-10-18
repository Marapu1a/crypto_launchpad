import {AbiCoder,keccak256} from 'ethers';
import {address,check,hash,identity,uint} from './values.mjs';
import {validateSnapshotAdmission} from './admission.mjs';
import {holderFundingInstance} from './funding-receipt.mjs';
const coder=AbiCoder.defaultAbiCoder();
const encodedHash=(types,values)=>keccak256(coder.encode(types,values));
// Pure local planner. A structurally valid proof is not an execution authorization.
export function planHolderAllocation({scope,candidate,proof,snapshotPolicy,exclusions,budget,vault,instance}){
 const valid=validateSnapshotAdmission(proof,candidate,snapshotPolicy,scope);
 check(scope.chainId===4663&&address(scope.asset)==='0x'+'0'.repeat(40),'Native holder scope required');
 vault=address(vault);check(vault!=='0x'+'0'.repeat(40),'Invalid vault');hash(instance);
 check(instance===holderFundingInstance(scope),'Wrong allocation instance');
 check(Array.isArray(exclusions),'Explicit exclusions required');const excluded=new Set(exclusions.map(address));
 check(excluded.size===exclusions.length,'Duplicate exclusions');
 const eligible=valid.holders.filter(h=>!excluded.has(h.wallet));
 const weight=eligible.reduce((n,h)=>n+uint(h.balance),0n),fund=uint(budget);
 check(weight>0n&&fund>0n,'Empty allocation');
 const allocations=eligible.map(h=>({wallet:h.wallet,amount:String(fund*uint(h.balance)/weight)})).filter(h=>h.amount!=='0').sort((a,b)=>a.wallet.localeCompare(b.wallet));
 check(!allocations.some(h=>h.wallet===vault||h.wallet==='0x'+'0'.repeat(40)),'Unpayable allocation: exclude system address');
 const snapshot='0x'+identity(proof),period=proof.period;
 let commitment=encodedHash(['uint256','address','bytes32','uint256','bytes32','uint256','uint256'],[scope.chainId,vault,instance,period,snapshot,budget,allocations.length]);
 const checkpoints=[commitment];
 for(const h of allocations){commitment=encodedHash(['bytes32','address','uint256'],[commitment,h.wallet,h.amount]);checkpoints.push(commitment);}
 const allocated=allocations.reduce((n,h)=>n+uint(h.amount),0n);
 return {schema:'holder-allocation-local-v1',executionEnabled:false,scopeId:identity(scope),vault,instance,period,snapshot,budget,count:allocations.length,
  allocated:String(allocated),remainder:String(fund-allocated),allocations,checkpoints,commitment};
}
// Read-only restart check: verifies every already-written prefix before resuming.
export async function inspectAllocationPublication(vault,plan){
 check(address(await vault.getAddress())===plan.vault&&await vault.instance()===plan.instance,'Wrong allocation vault');
 const r=await vault.rounds(plan.period);
 if(r.commitment==='0x'+'0'.repeat(64))return {status:'not-started',offset:0};
 check(r.commitment===plan.commitment&&r.budget===uint(plan.budget)&&r.count===BigInt(plan.count),'Conflicting published plan');
 const offset=Number(r.written);check(offset<=plan.count&&r.rolling===plan.checkpoints[offset],'Conflicting publication prefix');
 for(const h of plan.allocations.slice(0,offset))check(await vault.entitlement(plan.period,h.wallet)===uint(h.amount),'Allocation storage mismatch');
 return {status:r.complete?'sealed':offset===plan.count?'ready-to-seal':'partial',offset};
}
