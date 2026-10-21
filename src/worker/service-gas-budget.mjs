import {isAddress,ZeroAddress} from 'ethers';
import {identity as digest} from '../holders/values.mjs';
const check=(v,m)=>{if(!v)throw Error(m);};
const uint=v=>{check(/^(0|[1-9]\d*)$/.test(String(v)),'Invalid gas amount');return BigInt(v);};
export function validateServiceGasBudget(p){
 check(p?.schema==='service-gas-budget-v1'&&p.chainId===4663&&/^[0-9a-f-]{36}$/i.test(p.projectId),'Invalid gas budget scope');
 check(Number.isSafeInteger(p.launchAt)&&p.launchAt>0&&p.periodSeconds===2592000&&uint(p.limitWei)>0n,'Invalid gas budget period/limit');
 check(Array.isArray(p.senders)&&p.senders.length===2&&p.senders.every(a=>isAddress(a)&&a!==ZeroAddress&&a===a.toLowerCase())&&new Set(p.senders).size===2,'Separate gas budget senders required');
 return p;
}
export function pwGasBudget(profile,launchAt,limitWei){
 return validateServiceGasBudget({schema:'service-gas-budget-v1',chainId:4663,projectId:profile.id,launchAt,periodSeconds:2592000,limitWei,senders:[profile.executor.toLowerCase(),profile.publisher.toLowerCase()].sort()});
}
export function gasIntent(request,sender){
 check(isAddress(sender)&&isAddress(request.to)&&uint(request.chainId)===4663n&&uint(request.value??0)===0n,'Invalid gas reservation transaction');
 const nonce=Number(request.nonce),type=Number(request.type);
 check(Number.isSafeInteger(nonce)&&nonce>=0&&[0,2].includes(type),'Invalid gas reservation nonce/type');
 check(!request.accessList||request.accessList.length===0,'Gas reservation access list unsupported');
 const data=request.data??'0x';check(/^0x([0-9a-f]{2})*$/i.test(data),'Invalid gas reservation data');
 const gas=uint(request.gasLimit),fee=uint(type===0?request.gasPrice:request.maxFeePerGas),tip=type===2?uint(request.maxPriorityFeePerGas):0n;
 check(gas>0n&&fee>0n&&tip<=fee,'Invalid gas reservation fee');
 const intent={chainId:4663,sender:sender.toLowerCase(),nonce,type,to:request.to.toLowerCase(),data:data.toLowerCase(),value:'0',gasLimit:String(gas),maxFeePerGas:String(fee),maxPriorityFeePerGas:String(tip)};
 return {intent,hash:digest(intent),maximum:String(gas*fee)};
}
export function gasPeriod(policy,at){
 check(Number.isSafeInteger(at)&&at>=policy.launchAt,'Gas budget clock precedes launch');
 return Math.floor((at-policy.launchAt)/policy.periodSeconds);
}
