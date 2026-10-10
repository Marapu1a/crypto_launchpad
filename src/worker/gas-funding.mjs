// Stored with the corresponding sender journal, under its existing DB lease.
export async function recordGasFunding({state,save,role,wallet,action,balance,required=null,active=true}){
 const previous=state.gasFunding;
 if(!active&&!previous?.active)return;
 const info={active,role,wallet:wallet.toLowerCase(),action,balanceWei:String(balance),requiredWei:required===null?null:String(required),
  shortfallWei:required===null?null:String(required>balance?required-balance:0n),estimateAvailable:required!==null};
 if(previous&&JSON.stringify({...previous,changedAt:undefined})===JSON.stringify(info))return;
 state.gasFunding={...info,changedAt:new Date().toISOString()};await save(state);
 return info;
}
