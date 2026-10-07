// Read-only by default; execution is restricted to a specifically identified local fork.
const fs=require('node:fs'),{ethers}=require('ethers');
const ABI=['function quoteToken() view returns(address)','function escrow() view returns(address)',
 'function promoVault() view returns(address)','function campaignId() view returns(uint64)',
 'function policy(uint64) view returns((uint64 endsAt,address[3] recipients,uint16[3] bps))',
 'function accounted() view returns(uint256)','function credit(address) view returns(uint256)',
 'function sweepState() view returns(uint8 phase,bool waiting,uint256 quoteDue)',
 'function sweepCurve()','function sweepPool()','function pull() returns(uint256)',
 'function sync()','function pay(address)'];
const err=e=>({message:e.shortMessage||e.message,data:e.data||null});
async function inspect(provider,address,from){
 const c=new ethers.Contract(ethers.getAddress(address),ABI,provider),b=await provider.getBlock('latest');
 const tag={blockTag:b.number},out={collector:c.target,from:ethers.getAddress(from),block:{number:b.number,hash:b.hash},actions:{}};
 async function action(name,fn){try{out.actions[name]=await fn();}catch(e){out.actions[name]={status:'unavailable',error:err(e)};}}
 await action('sweep',async()=>{const s=await c.sweepState(tag);return {status:s.waiting?'waiting':s.quoteDue===0n?'empty':'ready',phase:Number(s.phase),quoteDue:String(s.quoteDue),reason:s.waiting?(s.phase===2n?'awaiting-pons-operator':'graduation-incomplete'):null,method:s.phase===0n?'sweepCurve':'sweepPool'};});
 await action('pull',async()=>{const escrow=await c.escrow(tag),quote=await c.quoteToken(tag);
  const e=new ethers.Contract(escrow,['function balanceOfToken(address,address) view returns(uint256)'],provider);
  const due=await e.balanceOfToken(c.target,quote,tag);return {status:due>0n?'ready':'empty',due:String(due),method:'pull'};});
 await action('sync',async()=>{const q=new ethers.Contract(await c.quoteToken(tag),['function balanceOf(address) view returns(uint256)'],provider);
  const balance=await q.balanceOf(c.target,tag),accounted=await c.accounted(tag);if(balance<accounted)throw Error('Balance deficit');
  return {status:balance>accounted?'ready':'empty',amount:String(balance-accounted),method:'sync'};});
  // Credits belong to addresses, not only the current campaign's role names.
  let recipients;const known=new Map();out.policyScan={complete:true,errors:[]};out.payouts=[];
  try{
   const current=await c.campaignId(tag);out.policyScan.campaignId=String(current);
   for(let id=1n;id<=current;id++)try{
    const policy=await c.policy(id,tag);if(id===current)recipients=policy.recipients;
    for(const address of policy.recipients){const key=address.toLowerCase();if(!known.has(key))known.set(key,{recipient:address,campaigns:[]});const item=known.get(key);if(!item.campaigns.includes(String(id)))item.campaigns.push(String(id));}
   }catch(e){out.policyScan.complete=false;out.policyScan.errors.push({campaignId:String(id),error:err(e)});}
  }catch(e){out.policyScan.complete=false;out.policyError=err(e);}
  for(const [key,item]of known){const name='pay:'+key;await action(name,async()=>{
   const due=await c.credit(item.recipient,tag);return {status:due>0n?'ready':'empty',due:String(due),method:'pay',args:[item.recipient]};
  });out.payouts.push({...item,action:name});}
  for(const [i,name] of ['pay-prizes','pay-ops','pay-team'].entries()){
   out.actions[name]=recipients?out.actions['pay:'+recipients[i].toLowerCase()]:{status:'unavailable',error:{message:'Current recipients unavailable'}};
  }
 // Independently simulate each ready action; sweep failure must not hide claim/pay.
  for(const a of new Set(Object.values(out.actions)))if(a.status==='ready'){
  a.request={to:c.target,from:out.from,data:c.interface.encodeFunctionData(a.method,a.args||[])};
  try{await provider.call({...a.request,blockTag:b.number});a.simulated=true;}catch(e){a.status='blocked';a.error=err(e);}
 }
 return out;
}
async function executeLocal(provider,address,from,action,instanceId){
 const m=await provider.send('hardhat_metadata',[]);
 if(!instanceId||m.instanceId!==instanceId||Number(m.chainId)!==4663||Number(m.forkedNetwork?.chainId)!==4663)
  throw Error('Execution requires the explicitly selected Hardhat Robinhood fork instance');
 const plan=await inspect(provider,address,from),a=plan.actions[action];
 if(a?.status!=='ready'||!a.simulated)throw Error(`Action not ready: ${action}`);
 const signer=new ethers.JsonRpcSigner(provider,ethers.getAddress(from));
 const tx=await signer.sendTransaction(a.request),receipt=await tx.wait();
 if(receipt.status!==1)throw Error('Transaction failed');
 return {action,hash:receipt.hash,blockNumber:receipt.blockNumber,instanceId};
}
async function main(){
 const args=process.argv.slice(2),v=k=>args[args.indexOf(k)+1];
 for(const k of ['--rpc','--collector','--from'])if(!args.includes(k))throw Error('Required: --rpc URL --collector 0x --from 0x [--execute ACTION --instance ID --out NEW_FILE]');
 const u=new URL(v('--rpc')),execute=args.includes('--execute');
 if(execute&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('Execution is local-only');
 const file=args.includes('--out')?v('--out'):null;if(execute&&(!file||fs.existsSync(file)))throw Error('Execution requires a new --out receipt file');
 const p=new ethers.JsonRpcProvider(u.href);try{
  if(execute){
   // Persist intent before sending. An interrupted send is unresolved; never auto-retry it.
   fs.writeFileSync(file,JSON.stringify({status:'intent',instanceId:v('--instance'),action:v('--execute'),collector:v('--collector'),from:v('--from')},null,2),{flag:'wx'});
   const result=await executeLocal(p,v('--collector'),v('--from'),v('--execute'),v('--instance'));
   fs.writeFileSync(file,JSON.stringify({status:'confirmed',...result},null,2));console.log(JSON.stringify(result));
  }else console.log(JSON.stringify(await inspect(p,v('--collector'),v('--from')),null,2));
 }finally{p.destroy();}
}
module.exports={inspect,executeLocal,ABI};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
