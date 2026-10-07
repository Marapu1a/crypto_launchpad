/* Shared browser/Node claim boundary. No signer, approvals or automatic sends. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('ethers'));else root.QianqiClaim=factory(root.ethers);})(globalThis,function(E){
 'use strict';
 const abi=new E.Interface(['function claim(bytes32,address)','function reward(bytes32,address) view returns(uint256)','function draws(bytes32) view returns(address,uint64,uint8,uint256,uint256,uint256)','function quoteToken() view returns(address)']);
 const addr=v=>typeof v==='string'&&/^0x[\da-f]{40}$/i.test(v),hash=v=>typeof v==='string'&&/^0x[\da-f]{64}$/i.test(v),same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
 function config(c){
  if(c?.schema!=='qianqi-site-actions-v1'||c.mode!=='local-test'||c.chainId!==31337||!addr(c.vault)||!addr(c.asset)||same(c.vault,E.ZeroAddress)||same(c.asset,E.ZeroAddress)||!hash(c.vaultCodeHash)||!hash(c.assetCodeHash)||!Number.isInteger(c.decimals)||c.decimals<0||c.decimals>36||!hash(c.anchor?.hash)||!Number.isSafeInteger(c.anchor?.number)||c.anchor.number<0)throw Error('Test deployment is not configured.');
  return Object.freeze(JSON.parse(JSON.stringify(c)));
 }
 function create({deployment,provider,storage,lock,current=()=>true,readTimeoutMs=20000}){
  const c=config(deployment);
  function call(method,params=[]){
   const response=Promise.resolve().then(()=>provider.request({method,params}));
   // Never time out a send and silently release its journal/lock. Reads are safe to abandon.
   if(method==='eth_sendTransaction')return response;
   let timer;return Promise.race([response,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Wallet read timed out. Check its connection and try checking again.')),readTimeoutMs);})]).finally(()=>clearTimeout(timer));
  }
  const key=r=>`qianqi.claim.v1:${c.chainId}:${c.anchor.hash}:${c.vault.toLowerCase()}:${r.drawId.toLowerCase()}:${r.winner.toLowerCase()}`;
  function read(r){const raw=storage.getItem(key(r));return raw?JSON.parse(raw):null;}
  function write(r,v){storage.setItem(key(r),JSON.stringify(v));}
  function exclusive(r,fn){if(!lock)throw Error('This browser cannot safely track claims across tabs.');return lock(key(r),fn);}
  async function context(r){
   if(!addr(r.winner)||!hash(r.drawId)||!same(r.asset,c.asset)||!/^\d+$/.test(r.amountRaw)||BigInt(r.amountRaw)<=0n)throw Error('Invalid prize.');
   const network=await call('eth_chainId'),accounts=await call('eth_accounts');
   if(!current()||BigInt(network)!==BigInt(c.chainId)||!accounts.some(a=>same(a,r.winner)))throw Error('Wallet or network changed. Reopen the prize.');
   const anchor=await call('eth_getBlockByNumber',[E.toQuantity(c.anchor.number),false]);
   if(!same(anchor?.hash,c.anchor.hash))throw Error('This wallet is not on the configured test chain.');
   for(const [address,expected] of [[c.vault,c.vaultCodeHash],[c.asset,c.assetCodeHash]])if(!same(E.keccak256(await call('eth_getCode',[address,'latest'])),expected))throw Error('Deployment code does not match.');
  }
  async function value(name,args){return abi.decodeFunctionResult(name,await call('eth_call',[{to:c.vault,data:abi.encodeFunctionData(name,args)},'latest']));}
  async function prepare(r){
   await context(r);
   if(!same((await value('quoteToken',[]))[0],c.asset))throw Error('Prize asset does not match.');
   const due=(await value('reward',[r.drawId,r.winner]))[0],draw=await value('draws',[r.drawId]);
   if(due===0n)throw Error('No unpaid prize remains. Refresh to check for an automatic payment.');
   if(due!==BigInt(r.amountRaw)||draw[2]!==2n||!same(draw[0],c.asset))throw Error('Prize changed. Refresh before claiming.');
   const tx={from:r.winner,to:c.vault,data:abi.encodeFunctionData('claim',[r.drawId,r.winner]),value:'0x0',chainId:E.toQuantity(c.chainId)};
   await call('eth_call',[tx,'latest']);
   const gas=await call('eth_estimateGas',[tx]);
   if(!current())throw Error('Wallet changed. Reopen the prize.');
   return {tx,gas,amount:E.formatUnits(due,c.decimals)};
  }
  async function send(r){
   if(!lock)throw Error('This browser cannot safely track claims across tabs.');
   return lock(key(r),async()=>{
    const previous=read(r);if(previous&&!['rejected','reverted'].includes(previous.state))throw Error('A claim is already pending or its outcome is unknown. Check its status first.');
    const prepared=await prepare(r);await context(r);
    if(!current())throw Error('Wallet changed. Reopen the prize.');
    // Persist before the wallet prompt. Reload/errors must never turn into a second send.
    write(r,{state:'submitting',tx:prepared.tx});
    try{
     const txHash=await call('eth_sendTransaction',[prepared.tx]);
     if(!hash(txHash))throw Error('Wallet returned no transaction hash.');
     write(r,{state:'pending',hash:txHash,tx:prepared.tx});return read(r);
    }catch(e){write(r,{state:Number(e?.code)===4001?'rejected':'unknown',tx:prepared.tx});throw Error(Number(e?.code)===4001?'Claim declined. No claim was submitted by this request.':'The outcome is unknown. Check your wallet activity; do not send another claim.');}
   });
  }
  async function inspect(r,saved){
   await context(r);
   const receipt=await call('eth_getTransactionReceipt',[saved.hash]);
   if(!current())throw Error('Wallet changed. Check the prize again.');
   if(!receipt)return {...saved,state:'pending'};
   const tx=await call('eth_getTransactionByHash',[saved.hash]),block=await call('eth_getBlockByNumber',[receipt.blockNumber,false]);
   if(!same(receipt.transactionHash,saved.hash)||!same(tx?.hash,saved.hash)||!same(tx?.blockHash,receipt.blockHash)||!same(block?.hash,receipt.blockHash)||!same(tx?.from,r.winner)||!same(tx?.to,c.vault)||!same(tx?.input??tx?.data,abi.encodeFunctionData('claim',[r.drawId,r.winner]))||BigInt(tx?.value??-1)!==0n||!['0x0','0x1'].includes(receipt.status))throw Error('Transaction confirmation does not match.');
   const success=BigInt(receipt.status)===1n;
   if(success&&(await value('reward',[r.drawId,r.winner]))[0]!==0n)throw Error('Payment is not confirmed yet.');
   if(!current())throw Error('Wallet changed. Check the prize again.');
   return {...saved,state:success?'confirmed':'reverted'};
  }
  async function check(r){return exclusive(r,async()=>{
   const saved=read(r);if(!saved?.hash)return saved;
   const result=await inspect(r,saved);
   if(JSON.stringify(read(r))!==JSON.stringify(saved))return read(r);
   write(r,result);return result;
  });}
  async function recover(r,txHash){return exclusive(r,async()=>{
   if(!hash(txHash))throw Error('Enter a complete transaction hash (0x and 64 hex characters).');
   const saved=read(r),result=await inspect(r,{...saved,hash:txHash});
   // A mined successful exact claim proves the prize is spent. An arbitrary failed
   // or pending hash proves nothing about a lost request and must never unlock retry.
   if(result.state!=='confirmed')throw Error('This hash does not prove a completed payment. The previous request remains blocked.');
   if(JSON.stringify(read(r))!==JSON.stringify(saved))throw Error('Claim status changed. Check it again.');
   write(r,result);return result;
  });}
  return {prepare,send,check,recover,read};
 }
 return {config,create};
});
