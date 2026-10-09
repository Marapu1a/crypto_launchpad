// Explicit runtime network context. Legacy entrypoints remain local by default.
const {AsyncLocalStorage}=require('node:async_hooks'),{ethers}=require('ethers');
const scope=new AsyncLocalStorage(),LOCAL=Object.freeze({mode:'local',chainId:31337n});
const current=()=>scope.getStore()||LOCAL;
const isRobinhood=()=>current().chainId===4663n;
const schema=local=>isRobinhood()?local.replace(/^local-/,'robinhood-'):local;
function check(ok,message){if(!ok)throw Error(message);}
function checkChain(chain){check(BigInt(chain)===current().chainId,isRobinhood()?'Robinhood chain 4663 required':'Local chain 31337 only');}
function checkRpc(url){
 const u=new URL(url),loopback=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if(current().mode==='robinhood-public')check(u.protocol==='https:'&&!u.username&&!u.password,'Public HTTPS RPC required');
 else if(current().mode==='robinhood-inspect')check((u.protocol==='https:'||u.protocol==='http:'&&loopback)&&!u.username&&!u.password,'Public HTTPS RPC required');
 else check(u.protocol==='http:'&&loopback&&!u.username&&!u.password,'Loopback HTTP RPC only');
}
async function beforeSend({journaled=false}={}){
 const c=current();if(c===LOCAL)return;
 if(c.mode==='robinhood-public'){
  await require('../../fence.cjs').checkFence({required:true});
  check(journaled&&typeof c.publicGuard==='function','Public send requires a guarded journal');
  checkChain((await c.provider.getNetwork()).chainId);return;
 }
 check(c.mode==='robinhood-rehearsal','Public execution disabled pending release qualification');
 checkChain((await c.provider.getNetwork()).chainId);
 const metadata=await c.provider.send('hardhat_metadata',[]);
 check(metadata.instanceId===c.instanceId,'Rehearsal node instance changed');
}
async function withRobinhoodNetwork({provider,rpcUrl,mode='robinhood-inspect',publicGuard},action){
 check(['robinhood-inspect','robinhood-rehearsal','robinhood-public'].includes(mode),'Explicit Robinhood mode required');
 if(mode==='robinhood-public')check(typeof publicGuard==='function','Explicit Pons public guard required');
 const context={mode,chainId:4663n,provider,publicGuard};
 return scope.run(context,async()=>{
  checkRpc(rpcUrl);checkChain((await provider.getNetwork()).chainId);
  const request=new ethers.FetchRequest(rpcUrl);request.timeout=20000;
  const reader=new ethers.JsonRpcProvider(request,undefined,{cacheTimeout:-1});
  try{
   checkChain((await reader.getNetwork()).chainId);
   const a=await provider.getBlock('latest'),b=await reader.getBlock(a.number);
   check(a&&b&&a.hash===b.hash,'Runtime and scan RPC branch differ');
   if(mode==='robinhood-rehearsal'){
    const local=await provider.send('hardhat_metadata',[]),remote=await reader.send('hardhat_metadata',[]);
    check(typeof local.instanceId==='string'&&/^0x[0-9a-fA-F]{64}$/.test(local.instanceId)&&local.instanceId===remote.instanceId&&Number(local.chainId)===4663,'Same local Hardhat rehearsal node required');
    context.instanceId=local.instanceId;
   }
  }finally{reader.destroy();}
  return action();
 });
}
function executionAdmission(report){
 if(current().mode!=='robinhood-rehearsal')return report;
 const reasons=report.reasons.filter(r=>r!=='publicExecutionNotImplemented');
 return {...report,status:reasons.length?'blocked':'matched',reasons,releaseBlockers:report.reasons,executionScope:'local-robinhood-rehearsal',publicLaunchReady:false,authorizationToFreeze:false};
}
function rpcIdentity(url){return isRobinhood()?{origin:new URL(url).origin,endpointHash:ethers.id(url)}:url;}
module.exports={current,isRobinhood,schema,checkChain,checkRpc,beforeSend,withRobinhoodNetwork,executionAdmission,rpcIdentity};
