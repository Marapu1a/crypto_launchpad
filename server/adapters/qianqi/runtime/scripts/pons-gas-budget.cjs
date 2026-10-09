// Per-transaction native budget. No forecast of future draws, no prize assets.
const REMINDER_MS=60*60*1000;
const {keccak256}=require('ethers');
const keyOf=(request,action)=>String(request.to).toLowerCase()+':'+action+':'+keccak256(request.data??'0x');
function createGasBudget({provider,sender,maxGasLimit,state,save,notifications,now=Date.now}){
 const waits=new Map();
 const gasLimit=estimate=>{const limit=(BigInt(estimate)*120n+99n)/100n;
  if(limit>BigInt(maxGasLimit))throw Object.assign(Error('gasBound'),{code:'LOCAL_BUDGET_WAIT',workerWait:'gasBound',budget:{reason:'gasBound',estimatedGas:String(estimate),requiredGasLimit:String(limit),maxGasLimit:String(maxGasLimit)}});
  return limit;
 };
 function missing(request,action,balance,required,fee,units){
  const key=keyOf(request,action),at=now(),previous=state.gasAlerts?.[key];
  const info={reason:'nativeFunding',action,target:String(request.to),balanceWei:String(balance),requiredWei:required===null?null:String(required),shortfallWei:required===null?null:String(required>balance?required-balance:0n),gasLimit:units===null?null:String(units),feePerGasWei:fee===null?null:String(fee),estimateAvailable:required!==null};
  const notify=!previous?.active||at-previous.lastNotifiedAt>=REMINDER_MS;
  state.gasAlerts??={};state.gasAlerts[key]={active:true,lastNotifiedAt:notify?at:previous.lastNotifiedAt,...info};save(state);
  if(notify)notifications.push({type:'nativeFundingRequired',at:new Date(at).toISOString(),...info});
  waits.set(key,info);
  throw Object.assign(Error('nativeFunding'),{code:'LOCAL_BUDGET_WAIT',workerWait:'nativeFunding',budget:info});
 }
 async function check(request,action,price){
  // The shared sender estimates first. Do not gate on a made-up gas limit.
  if(request.gasLimit===undefined)return;
  const units=BigInt(request.gasLimit),fee=BigInt(request.maxFeePerGas??request.gasPrice??price);
  const required=units*fee+BigInt(request.value??0),balance=await provider.getBalance(sender);
  if(balance<required)missing(request,action,balance,required,fee,units);
  const key=keyOf(request,action);waits.delete(key);
  if(state.gasAlerts?.[key]?.active){delete state.gasAlerts[key];save(state);notifications.push({type:'nativeFundingAvailable',action,target:String(request.to),balanceWei:String(balance),requiredWei:String(required)});}
 }
 async function estimateFailed(error,request,action){
  // Some RPCs refuse estimation itself when the account has no native funds.
  // No estimate means no invented shortfall; retry after topping up.
  if(error.code==='INSUFFICIENT_FUNDS')missing(request,action,await provider.getBalance(sender),null,null,null);
 }
 return {gasLimit,check,estimateFailed,waiting:()=>[...waits.values()]};
}
module.exports={createGasBudget,REMINDER_MS};
