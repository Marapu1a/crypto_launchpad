// Shared by the Pons coordinator and process-crash integration tests.
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const check=(v,m)=>{if(!v)throw Error(m);};
// Keep the signed payload only while recovery may need it, never in CLI steps.
function resolvedIntent(p,receipt){const {signedTransaction,...intent}=p;return {...intent,status:receipt.status,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash};}
async function reconcilePending(state,save,provider,sender){
 const p=state.pending;if(!p)return null;
 if(!p.transactionHash)return {status:'blocked',reason:'unknownHash'};
 const r=await provider.getTransactionReceipt(p.transactionHash);if(!r)return {status:'blocked',reason:'pendingReceipt'};
 const tx=await provider.getTransaction(p.transactionHash),b=await provider.getBlock(r.blockNumber);
 if(!tx||!b||!same(b.hash,r.blockHash)||!same(r.hash,p.transactionHash)||!same(tx.hash,p.transactionHash)||tx.nonce!==p.nonce||!same(tx.from,sender)||!same(tx.to,p.target)||!same(tx.data,p.data)||BigInt(tx.value||0)!==BigInt(p.value||0)||![0,1].includes(r.status))return {status:'blocked',reason:'unconfirmedReceipt'};
 state.lastResolved=resolvedIntent(p,r);delete state.pending;save(state);return null;
}
function createBoundary({state,save,provider,sender,guard,onConfirmed,signer}){
 return {...(signer?{broadcast:async request=>{
  check(state.pending&&!state.pending.transactionHash,'Missing unsigned intent');
  const tx=await signer.populateTransaction(request),raw=await signer.signTransaction(tx);
  const {keccak256,Transaction}=require('ethers'),signed=Transaction.from(raw),p=state.pending;
  check(same(signed.from,sender)&&same(signed.to,p.target)&&same(signed.data,p.data)&&signed.value===BigInt(p.value||0)&&signed.nonce===tx.nonce,'Signed transaction differs from intent');
  const hash=keccak256(raw);
  state.pending={...state.pending,nonce:tx.nonce,transactionHash:hash,signedTransaction:raw};save(state);
  await require('../../fence.cjs').checkFence();
  const sent=await provider.broadcastTransaction(raw);check(same(sent.hash,hash),'Broadcast hash mismatch');return sent;
 }}:{}),preflight:guard,before:async(request,action)=>{await guard(request,action);check(!state.pending,'Unresolved intent');state.pending={action,target:request.to,data:request.data,value:String(request.value||0),from:sender};save(state);},sent:async tx=>{state.pending={...state.pending,transactionHash:tx.hash,nonce:tx.nonce};save(state);},confirmed:async r=>{
  check(state.pending&&same(r.hash,state.pending.transactionHash)&&same((await provider.getBlock(r.blockNumber))?.hash,r.blockHash),'Noncanonical receipt');
  const resolved=resolvedIntent(state.pending,r);state.lastResolved=resolved;delete state.pending;save(state);await onConfirmed(resolved);
 }};
}
module.exports={reconcilePending,createBoundary};
