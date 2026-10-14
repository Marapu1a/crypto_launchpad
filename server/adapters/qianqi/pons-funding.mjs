// Explicit bindings are part of the rehearsal scheduler identity, never inferred from Pons API.
import {createRequire} from 'node:module';
import {Contract,keccak256} from 'ethers';
const require=createRequire(import.meta.url);
const {inspect,ABI}=require('./runtime/scripts/pons-collector-manual.cjs');
const {runFundingPass}=require('./runtime/scripts/pons-funding-pass.cjs');
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
export async function fundFromPons({provider,executor,config,domain,send}){
 const c=config,collector=new Contract(c.collector,ABI,executor),sender=await executor.getAddress();
 if(!same(c.recipients?.[0],domain.vault)||c.recipients.length!==3||c.bps?.length!==3)throw Error('Invalid funding recipients');
 const block=await provider.getBlock('latest'),at={blockTag:block.number};
 for(const k of ['collector','escrow'])if(!same(keccak256(await provider.getCode(c[k],block.number)),c.codeHashes?.[k]))throw Error('Funding runtime changed');
 if(!same(await collector.promoVault(at),domain.vault)||!same(await collector.quoteToken(at),c.quote)||!same(await collector.escrow(at),c.escrow))throw Error('Funding binding changed');
 if(String(await collector.campaignId(at))!==c.campaignId)throw Error('Funding campaign changed');
 const policy=await collector.policy(c.campaignId,at);
 if(!policy.recipients.every((a,i)=>same(a,c.recipients[i]))||!policy.bps.every((n,i)=>n===BigInt(c.bps[i])))throw Error('Funding allocation changed');
 return runFundingPass({loadPlan:()=>inspect(provider,c.collector,sender),send:(method,args)=>send(collector[method],args)});
}
