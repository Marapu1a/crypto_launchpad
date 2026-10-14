import {digest} from '../../../src/tickets/digest.mjs';
// The pinned legacy QIANQI admission (pons-public-profile.cjs) verifies 90/5/5.
// The original config has no bps field. This is not a platform-wide default.
export function validatePonsExecutionBinding({config,funding,deliveryJob,publicConfig:c,sender}){
 const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
 const check=(ok)=>{if(!ok)throw Error('Public Pons scheduler binding mismatch');};
 check(digest(c.manifest)===digest(config.manifest)&&digest(c.lifecycle)===digest(config.lifecycle));
 check(digest(c.deliveryJob)===digest(deliveryJob)&&same(sender,c.executor));
 check(funding&&same(funding.collector,c.collector)&&same(funding.escrow,c.escrow)&&same(funding.quote,c.manifest.quote)&&funding.campaignId===c.campaignId&&digest(funding.recipients)===digest(c.recipients)&&digest(funding.bps)===digest([9000,500,500])&&digest(funding.codeHashes)===digest(c.codeHashes));
}
