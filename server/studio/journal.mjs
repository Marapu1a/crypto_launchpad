import {keccak256,Transaction} from 'ethers';
import {assertLocalFork} from '../../src/pons/local-execution.mjs';
import {digest} from '../../src/tickets/digest.mjs';
export async function transact({provider,signer,state,save,key,request,guard,hook=async()=>{}}){
 if(typeof guard!=='function')throw Error('Launch lease required');await guard();
 const fork=await assertLocalFork(provider);
 if(fork.instanceId!==state.instance)throw Error('Другой экземпляр стенда');
 const normalized={to:request.to?.toLowerCase()??null,data:request.data??'0x',value:String(request.value??0)};
 let intent=state.transactions[key];
 if(intent&&intent.requestHash!==digest(normalized))throw Error('Изменился сохранённый шаг запуска');
 if(!intent){
  const from=await signer.getAddress(),nonce=await provider.getTransactionCount(from,'latest');
  if(nonce!==await provider.getTransactionCount(from,'pending'))throw Error('Есть неподтверждённая транзакция');
  const fee=(await provider.getFeeData()).gasPrice;
  if(fee===null||fee>100000000000n)throw Error('Цена газа выше лимита стенда');
  const gas=(await provider.estimateGas({...request,from}))*120n/100n;
  if(gas>12000000n)throw Error('Лимит газа шаблона');
  await guard();const raw=await signer.signTransaction({...request,chainId:31337,nonce,type:0,gasPrice:fee,gasLimit:gas});
  intent=state.transactions[key]={raw,hash:keccak256(raw),nonce,requestHash:digest(normalized)};
  await save();await hook('signed',key);
 }
 const tx=Transaction.from(intent.raw);
 if(tx.chainId!==31337n||tx.nonce!==intent.nonce||tx.from.toLowerCase()!==(await signer.getAddress()).toLowerCase()||keccak256(intent.raw)!==intent.hash||digest({to:tx.to?.toLowerCase()??null,data:tx.data,value:String(tx.value)})!==intent.requestHash)throw Error('Повреждён журнал запуска');
 let receipt=await provider.getTransactionReceipt(intent.hash);
 if(intent.blockHash&&(!receipt||receipt.blockHash!==intent.blockHash))throw Error('Изменилась ветка подтверждённого запуска');
 if(!receipt){
  if(await provider.getTransactionCount(tx.from,'latest')>intent.nonce)throw Error('Nonce занят другой транзакцией');
  await guard();const sent=await provider.broadcastTransaction(intent.raw);
  if(sent.hash!==intent.hash)throw Error('Неверный hash отправки');
  await hook('broadcast',key);receipt=await sent.wait(1,30000);
 }
 if(!receipt||receipt.status!==1||(await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw Error('Запуск не подтверждён в канонической цепочке');
 intent.blockHash=receipt.blockHash;intent.blockNumber=receipt.blockNumber;await save();return receipt;
}
