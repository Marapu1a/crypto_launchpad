import {getAddress,toQuantity,keccak256} from 'ethers';
import {walletAccount} from './wallet.mjs';

export async function signReservedOwnerStep(wallet,state){
 const step=state.pending,r=step?.request;
 if(!r||step.hash||step.state!=='requesting'||r.chainId!==4663||!state.instanceId)throw Error('Нет сохранённого шага для подписи');
 await walletAccount(wallet,4663,{account:state.owner});
 if(state.mode==='production'){
  if(state.signingEnabled!==true||!state.instanceId.startsWith('production:'))throw Error('Боевые подписи ещё не включены');
  const g=state.walletGuard,now=Math.floor(Date.now()/1000),roles=['factory','router','quote','escrow','hook'];
  if(!Number.isSafeInteger(g?.anchor?.number)||g.anchor.number<0||!/^0x[0-9a-f]{64}$/i.test(g.anchor.hash)||!roles.every(k=>g.externals?.[k])||!['clockLag','clockAhead','finalizedLag'].every(k=>Number.isSafeInteger(g.timing?.[k])&&g.timing[k]>=0))throw Error('Нет проверенного профиля сети');
  const client=await wallet.request({method:'web3_clientVersion',params:[]});
  if(typeof client!=='string'||/hardhat|anvil|ganache/i.test(client))throw Error('Кошелёк подключён к тестовой сети');
  const block=n=>wallet.request({method:'eth_getBlockByNumber',params:[n,false]});
  const [anchor,latest,finalized]=await Promise.all([block(toQuantity(g.anchor.number)),block('latest'),block('finalized')]);
  if(anchor?.hash?.toLowerCase()!==g.anchor.hash.toLowerCase()||!latest||!finalized||BigInt(finalized.number)<BigInt(g.anchor.number)||BigInt(finalized.number)>BigInt(latest.number)||BigInt(finalized.timestamp)>BigInt(latest.timestamp)||now-Number(BigInt(finalized.timestamp))>g.timing.finalizedLag||now-Number(BigInt(latest.timestamp))>g.timing.clockLag||Number(BigInt(latest.timestamp))-now>g.timing.clockAhead)throw Error('Сеть или финальность кошелька не совпадают с профилем');
  for(const role of roles){const pin=g.externals[role],code=await wallet.request({method:'eth_getCode',params:[getAddress(pin.address),'latest']});if(keccak256(code).toLowerCase()!==pin.codeHash.toLowerCase())throw Error('Код контракта изменился: '+role);}
  await walletAccount(wallet,4663,{account:state.owner});
 }else{
  if(state.mode!==undefined&&state.mode!=='rehearsal')throw Error('Неизвестный режим подписи');
  const meta=await wallet.request({method:'hardhat_metadata',params:[]});
  if(meta.instanceId!==state.instanceId||Number(meta.chainId)!==4663||Number(meta.forkedNetwork?.chainId)!==4663)throw Error('Кошелёк должен быть подключён к тому же изолированному стенду');
 }
 if(getAddress(r.from)!==getAddress(state.owner))throw Error('Кошелёк запроса изменился');
 const tx={from:r.from,data:r.data,chainId:toQuantity(4663),nonce:toQuantity(r.nonce),value:toQuantity(r.value),gas:toQuantity(r.gasLimit),gasPrice:toQuantity(r.gasPrice)};
 if(r.to)tx.to=getAddress(r.to);
 const hash=await wallet.request({method:'eth_sendTransaction',params:[tx]});
 if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Кошелёк не вернул hash; проверьте историю отправок');
 return hash;
}
