// Share this instance across all transports in a process, including read/trace.
// Reservations are charged before dispatch: failures must not refund usage.
function createRpcGate({intervalMs=50,maxRequests=Infinity,windowMs=3600000,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<0||!Number.isSafeInteger(windowMs)||windowMs<1||!(maxRequests===Infinity||Number.isSafeInteger(maxRequests)&&maxRequests>0))throw Error('Invalid RPC gate settings');
 let tail=Promise.resolve(),last=-Infinity,started=now(),used=0,denied=0;
 const gate=(payload)=>{
  const count=Array.isArray(payload)?payload.length:1;
  if(!count)return Promise.reject(Error('Empty RPC batch'));
  const turn=tail.then(async()=>{
   const delay=last+intervalMs-now();if(delay>0)await sleep(delay);
   const at=now();
   if(at>=started+windowMs){started=at;used=0;}
   if(used+count>maxRequests){denied+=count;const error=Error('RPC request budget exhausted');error.code='RPC_BUDGET_EXHAUSTED';error.retryAt=started+windowMs;throw error;}
   used+=count;last=at;
  });
  tail=turn.catch(()=>{});return turn;
 };
 gate.snapshot=()=>({used,denied,maxRequests:Number.isFinite(maxRequests)?maxRequests:null,windowStartedAt:started,windowEndsAt:started+windowMs});
 return gate;
}
module.exports={createRpcGate};
