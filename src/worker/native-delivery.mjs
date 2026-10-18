// Only recipient refusal is deferrable. Solvency, policy and transport failures
// must still stop execution. eth_call simulates the transfer without sending it.
export async function nativeDeliveryReady(contract,method,args,gasLimit){
 try{await contract[method].staticCall(...args,{gasLimit});return true;}
 catch(error){if(error.code==='CALL_EXCEPTION'&&error.reason==='native payout')return false;throw error;}
}
