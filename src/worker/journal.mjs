import { Transaction, keccak256 } from 'ethers';
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const check=(value,message)=>{if(!value)throw Error(message);};

// Persist the exact signed bytes before broadcasting; every retry has the same nonce/hash.
export async function advanceTransaction({provider,signer,state,save,request,action,limits,guard,hook=async()=>{}}) {
  await guard();
  check(!state.failure,'Worker stopped after reverted transaction');
  if(!state.pending){
    if(!request)return {status:'idle'};
    const sender=await signer.getAddress();
    const [latest,pending]=await Promise.all([provider.getTransactionCount(sender,'latest'),provider.getTransactionCount(sender,'pending')]);
    if(latest!==pending)return {status:'waiting',reason:'external-pending-nonce'};
    const price=(await provider.getFeeData()).gasPrice;
    if(price===null||price>BigInt(limits.maxGasPrice))return {status:'waiting',reason:'gas-price'};
    const estimate=await provider.estimateGas({...request,from:sender});
    const gasLimit=(estimate*120n+99n)/100n;
    if(gasLimit>BigInt(limits.maxGasLimit))return {status:'waiting',reason:'gas-limit'};
    if(await provider.getBalance(sender)<gasLimit*price+BigInt(limits.nativeFloor))return {status:'waiting',reason:'native-balance'};
    check(BigInt(request.value??0)===0n,'Worker cannot send native value');
    const raw=await signer.signTransaction({...request,value:0,nonce:latest,chainId:31337,type:0,gasPrice:price,gasLimit});
    const signed=Transaction.from(raw);
    check(same(signed.from,sender)&&same(signed.to,request.to)&&same(signed.data,request.data)&&signed.value===0n&&signed.nonce===latest&&signed.chainId===31337n,'Signed intent mismatch');
    state.pending={action,hash:keccak256(raw),raw,from:sender,to:signed.to,data:signed.data,nonce:latest,anchor:await provider.getBlockNumber()};
    await save();await hook('prepared',state.pending);
  }
  const pending=state.pending,signed=Transaction.from(pending.raw);
  check(keccak256(pending.raw)===pending.hash&&same(signed.from,await signer.getAddress())&&same(signed.from,pending.from)
    &&same(signed.to,pending.to)&&same(signed.data,pending.data)&&signed.nonce===pending.nonce&&signed.value===0n&&signed.chainId===31337n,'Pending intent mismatch');
  let receipt=await provider.getTransactionReceipt(pending.hash);
  if(!receipt){
    check(await provider.getTransactionCount(pending.from,'latest')<=pending.nonce,'Nonce consumed by another transaction');
    // An unavailable RPC or lost response leaves the persisted signed intent untouched.
    try{await guard();const sent=await provider.broadcastTransaction(pending.raw);check(same(sent.hash,pending.hash),'Broadcast hash mismatch');}
    catch(error){if(!await provider.getTransactionReceipt(pending.hash))throw error;}
    await hook('broadcast',pending);
    receipt=await provider.getTransactionReceipt(pending.hash);
    if(!receipt)return {status:'waiting',reason:'receipt',hash:pending.hash};
  }
  const [transaction,block]=await Promise.all([provider.getTransaction(pending.hash),provider.getBlock(receipt.blockNumber)]);
  check(transaction&&block&&same(block.hash,receipt.blockHash)&&same(receipt.hash,pending.hash)&&same(transaction.from,pending.from)
    &&same(transaction.to,pending.to)&&same(transaction.data,pending.data)&&transaction.nonce===pending.nonce&&transaction.value===0n
    &&[0,1].includes(receipt.status),'Noncanonical or mismatched receipt');
  await hook('receipt',pending);
  const resolved={action:pending.action,hash:pending.hash,nonce:pending.nonce,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,status:receipt.status};
  state.history.push(resolved);delete state.pending;
  if(receipt.status===0)state.failure=resolved;
  await save();await hook('confirmed',resolved);
  return {...resolved,receiptStatus:resolved.status,status:receipt.status===1?'confirmed':'blocked'};
}
