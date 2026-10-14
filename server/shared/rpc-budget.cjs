const fs=require('node:fs/promises');
const {isAbsolute,dirname}=require('node:path');
const {randomUUID}=require('node:crypto');
const {createRpcGate}=require('./rpc-gate.cjs');
function valid(s){
 if(s?.schema!=='rpc-budget-v1'||!Number.isSafeInteger(s.maxRequests)||s.maxRequests<1||!Number.isSafeInteger(s.windowMs)||s.windowMs<1000||!Number.isSafeInteger(s.startedAt)||s.startedAt<0||!Number.isSafeInteger(s.used)||s.used<0||s.used>s.maxRequests)throw Error('Invalid persistent RPC budget');
 return s;
}
async function initializeBudget(file,{maxRequests,windowMs,now=Date.now}){
 if(!isAbsolute(file))throw Error('Absolute budget path required');
 const state=valid({schema:'rpc-budget-v1',maxRequests,windowMs,startedAt:now(),used:0});
 const handle=await fs.open(file,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(state));await handle.sync();}finally{await handle.close();}
}
// No stale-lock deletion: after a crash an operator must verify the owner is gone.
// Missing/corrupt state fails closed, never creates a fresh allowance automatically.
function persistentRpcGate({file,maxRequests,windowMs,intervalMs=50,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),lockAttempts=100}){
 if(!isAbsolute(file)||!Number.isSafeInteger(lockAttempts)||lockAttempts<1)throw Error('Invalid RPC budget path or lock policy');
 valid({schema:'rpc-budget-v1',maxRequests,windowMs,startedAt:0,used:0});
 const pace=createRpcGate({intervalMs,now,sleep:wait});let last=null;
 const gate=async payload=>{
  await pace(payload);
  const count=Array.isArray(payload)?payload.length:1,lock=file+'.lock';let owner;
  for(let i=0;i<lockAttempts;i++){
   try{owner=await fs.open(lock,'wx',0o600);break;}catch(e){if(e.code!=='EEXIST')throw e;if(i+1<lockAttempts)await wait(20);}
  }
  if(!owner)throw Object.assign(Error('RPC budget locked'),{code:'RPC_BUDGET_LOCKED'});
  let temporary;
  try{
   const s=valid(JSON.parse(await fs.readFile(file,'utf8')));
   if(s.maxRequests!==maxRequests||s.windowMs!==windowMs)throw Error('RPC budget policy mismatch');
   const at=now();if(at>=s.startedAt+s.windowMs){s.startedAt=at;s.used=0;}
   last={...s};
   if(s.used+count>s.maxRequests)throw Object.assign(Error('RPC request budget exhausted'),{code:'RPC_BUDGET_EXHAUSTED',retryAt:s.startedAt+s.windowMs});
   s.used+=count;temporary=file+'.'+randomUUID()+'.tmp';
   const handle=await fs.open(temporary,'wx',0o600);
   try{await handle.writeFile(JSON.stringify(s));await handle.sync();}finally{await handle.close();}
   await fs.rename(temporary,file);temporary=null;last={...s};
   if(process.platform!=='win32'){const directory=await fs.open(dirname(file),'r');try{await directory.sync();}finally{await directory.close();}}
   // Reservation is durable before the caller is allowed to send.
  }finally{
   if(temporary)await fs.unlink(temporary).catch(()=>{});
   await owner.close();await fs.unlink(lock);
  }
 };
 gate.snapshot=()=>last?{...last,persistent:true}: {persistent:true,checked:false};
 return gate;
}
function configuredRpcGate(options={}){return Object.hasOwn(options,'file')?persistentRpcGate(options):createRpcGate(options);}
module.exports={initializeBudget,persistentRpcGate,configuredRpcGate};
