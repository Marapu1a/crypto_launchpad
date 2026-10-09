// Read-only preflight. Pin the fee and state to the same block so publication
// verification time cannot turn an old gas quote into a fatal eth_call rejection.
async function executionReady(provider,source,quotedPrice){
 const head=await provider.getBlock('latest');
 if(!head||!Number.isSafeInteger(head.number)||head.number<0||head.baseFeePerGas==null)throw Error('Missing execution readiness block/fee');
 const quote=BigInt(quotedPrice),base=BigInt(head.baseFeePerGas);
 if(quote<0n||base<0n)throw Error('Invalid execution readiness fee');
 return source.executionReady({blockTag:head.number,gasPrice:quote>base?quote:base});
}
module.exports={executionReady};
