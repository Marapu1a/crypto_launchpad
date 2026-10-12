import {check} from './store.mjs';
const max=(a,b)=>a>b?a:b;
export async function ownerGasPrice(provider,limits,previous=0n){
 const [fee,block]=await Promise.all([provider.getFeeData(),provider.getBlock('latest')]);
 check(fee.gasPrice>0n,'Gas price unavailable');
 // Legacy gasPrice is actually paid, not an EIP-1559 cap. Keep the reserve explicit.
 const price=max(max(fee.gasPrice,BigInt(block?.baseFeePerGas??0))*2n,(BigInt(previous)*113n+99n)/100n);
 check(price<=BigInt(limits.maxGasPrice),'Gas price budget');return price;
}
export async function repriceOwnerRequest(provider,profile,pending,spent){
 check(pending&&!pending.hash&&pending.state==='requesting','Only an unresolved request can be repriced');
 const r=pending.request;
 const nonceCheck=async()=>check(await provider.getTransactionCount(r.from,'latest')===r.nonce&&await provider.getTransactionCount(r.from,'pending')===r.nonce,'Nonce already used; recover the hash');
 await nonceCheck();
 const gasPrice=await ownerGasPrice(provider,profile.limits,r.gasPrice);
 const estimate=await provider.estimateGas({...r,gasLimit:undefined,gasPrice});
 const gasLimit=max(BigInt(r.gasLimit),(estimate*120n+99n)/100n);
 check(gasLimit<=BigInt(profile.limits.maxGasLimit),'Gas limit budget');
 const cost=BigInt(r.value)+gasLimit*gasPrice;
 check(BigInt(spent)+cost<=BigInt(profile.totalNativeLimit),'Total native budget exhausted');
 check(await provider.getBalance(r.from)>=cost,'Insufficient owner ETH');
 await nonceCheck();
 return {...r,gasPrice:String(gasPrice),gasLimit:String(gasLimit)};
}
export async function checkRetryFee(provider,request){
 const block=await provider.getBlock('latest');
 check(BigInt(request.gasPrice)>=BigInt(block?.baseFeePerGas??0),'Комиссия устарела. Нажмите «Обновить комиссию» и проверьте новую стоимость.');
}
