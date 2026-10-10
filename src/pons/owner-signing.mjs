import {getAddress,toQuantity} from 'ethers';
import {walletAccount} from './wallet.mjs';

export async function signReservedOwnerStep(wallet,state){
 const step=state.pending,r=step?.request;
 if(!r||step.hash||step.state!=='requesting'||r.chainId!==4663||!state.instanceId)throw Error('Нет сохранённого шага для подписи');
 await walletAccount(wallet,4663,{account:state.owner});
 const meta=await wallet.request({method:'hardhat_metadata',params:[]});
 if(meta.instanceId!==state.instanceId||Number(meta.chainId)!==4663||Number(meta.forkedNetwork?.chainId)!==4663)throw Error('Кошелёк должен быть подключён к тому же изолированному стенду');
 if(getAddress(r.from)!==getAddress(state.owner))throw Error('Кошелёк запроса изменился');
 const tx={from:r.from,data:r.data,chainId:toQuantity(4663),nonce:toQuantity(r.nonce),value:toQuantity(r.value),gas:toQuantity(r.gasLimit),gasPrice:toQuantity(r.gasPrice)};
 if(r.to)tx.to=getAddress(r.to);
 const hash=await wallet.request({method:'eth_sendTransaction',params:[tx]});
 if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Кошелёк не вернул hash; проверьте историю отправок');
 return hash;
}
