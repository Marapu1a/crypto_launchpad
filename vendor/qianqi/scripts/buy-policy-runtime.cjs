// Shared admission path for CLI, builders and scheduler. A fresh load precedes each use.
const {loadBuyPolicy}=require('./buy-policy-admission.cjs');
const {buyPolicyHistory,validateManifest}=require('./direct-buy.cjs');
function prefix(history,cutoff){
 return {...history,versions:history.versions.filter((v,i)=>i===0||v.announcedAtBlock<=cutoff)};
}
async function resolveBuyPolicy(config,rpc,cutoff){
 validateManifest(config.manifest);
 if(config.buyPolicy&&config.lifecycle&&config.buyPolicy.instanceId!==config.lifecycle.instanceId)throw Error('BUY policy instance mismatch');
 if(config.buyPolicyMode!==undefined&&!['admitted','unadmitted'].includes(config.buyPolicyMode))throw Error('Unknown BUY policy mode');
 if(config.buyPolicy&&config.buyPolicyMode==='unadmitted')throw Error('Conflicting BUY policy trust/mode');
 if(!config.buyPolicy){
  const local=String(config.manifest.chainId)==='31337'&&config.manifest.schema==='direct-buy-v1';
  if(config.buyPolicyMode!=='unadmitted'&&(!local||config.buyPolicyMode==='admitted'))throw Error('BUY policy trust required; use explicit unadmitted mode only for research');
  return {manifest:require('./purchase-recognition.cjs').attach(config.manifest,config.recognition),policyStatus:{mode:'unadmitted',reason:local?'Local genesis fixture; no source admission':'Explicit research genesis; no source admission'}};
 }
 const admitted=await loadBuyPolicy({trust:config.buyPolicy,genesis:config.manifest,rpc,cutoff});
 const height=cutoff??admitted.checkpoint.number;
 if(!Number.isSafeInteger(height)||height>admitted.checkpoint.number)throw Error('BUY policy cutoff is not finalized');
 const manifest=require('./purchase-recognition.cjs').attach(prefix(admitted.history,height),config.recognition);
 buyPolicyHistory(manifest).at(height);
 return {manifest,admission:admitted,cutoff:height,policyStatus:{mode:'admitted',trustHash:admitted.trustHash,checkpoint:admitted.checkpoint,pendingAdapters:admitted.pendingAdapters}};
}
module.exports={resolveBuyPolicy,prefix};
