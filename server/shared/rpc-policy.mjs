import budget from './rpc-budget.cjs';
import {runtimeProvider} from '../short-runtime/rpc-provider.mjs';

export function validateRpcUrl(url,{mode,allowedRpcHosts=[]}){
 const u=new URL(url);
 if(mode==='rehearsal'){
  if(!['http:','https:'].includes(u.protocol)||!['127.0.0.1','[::1]','localhost'].includes(u.hostname)||u.username||u.password)throw Error('Rehearsal requires loopback RPC');
 }else if(mode!=='production'||u.protocol!=='https:'||u.username||u.password||!Array.isArray(allowedRpcHosts)||!allowedRpcHosts.includes(u.hostname)||/quicknode|quiknode/i.test(u.hostname))throw Error('Unapproved RPC host');
 return u;
}

// The operator and daemon must name the same budget file and policy. Opening an
// operator never creates or resets an allowance; every actual RPC is reserved.
export async function operatorRpc(url,config){
 validateRpcUrl(url,{mode:'production',allowedRpcHosts:config.allowedRpcHosts});
 const gate=budget.persistentRpcGate(config.rpcBudget??{});
 await gate.preflight();
 return {provider:runtimeProvider(url,{gate}),usage:()=>gate.snapshot()};
}
