import {toQuantity} from 'ethers';
import {withOwnerLaunch,check,same} from './store.mjs';
import {digest} from '../../src/tickets/digest.mjs';

// The only server wallet is Hardhat's public test account on a pinned local fork.
export function rehearsalSigner({pool,provider,profile}){
 check(profile.mode==='rehearsal'&&same(profile.owner,'0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'),'Fixture owner required');
 return (projectId,requestId)=>withOwnerLaunch({pool,projectId,owner:profile.owner},async({state,lease})=>{
  const meta=await provider.send('hardhat_metadata',[]);
  check(meta.instanceId===profile.instanceId&&Number(meta.chainId)===4663&&Number(meta.forkedNetwork?.chainId)===4663,'Wrong rehearsal instance');
  check(state?.profileHash===digest(profile),'Launch profile changed');
  const pending=state.pending,r=pending?.request;
  check(r&&pending.id===requestId&&pending.state==='requesting'&&!pending.hash&&same(r.from,profile.owner)&&r.chainId===4663,'Reserved request required');
  check(await provider.getTransactionCount(profile.owner,'pending')===r.nonce,'Nonce already used; recover transaction hash');
  const tx={from:profile.owner,data:r.data,value:toQuantity(r.value),nonce:toQuantity(r.nonce),gas:toQuantity(r.gasLimit),gasPrice:toQuantity(r.gasPrice),chainId:toQuantity(4663)};
  if(r.to)tx.to=r.to;
  await lease();return {hash:await provider.send('eth_sendTransaction',[tx])};
 });
}
