import {toQuantity} from 'ethers';

export async function sendPwBrowserStep(wallet,request,owner){
 if(!wallet?.request)throw Error('Откройте страницу в браузере с установленным кошельком.');
 const accounts=await wallet.request({method:'eth_requestAccounts'});
 if(accounts[0]?.toLowerCase()!==owner.toLowerCase())throw Error('Выберите кошелёк владельца '+owner);
 if(BigInt(await wallet.request({method:'eth_chainId'}))!==4663n){
  await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:toQuantity(4663)}]});
 }
 const current=await wallet.request({method:'eth_accounts'});
 if(current[0]?.toLowerCase()!==owner.toLowerCase()||BigInt(await wallet.request({method:'eth_chainId'}))!==4663n)throw Error('Кошелёк или сеть изменились.');
 for(const tag of ['latest','pending'])if(BigInt(await wallet.request({method:'eth_getTransactionCount',params:[owner,tag]}))!==BigInt(request.nonce))throw Error('Номер транзакции уже изменился. Найдите хеш отправленного шага в истории кошелька.');
 const tx={from:owner,data:request.data};
 if(request.to)tx.to=request.to;
 for(const [source,target] of [['chainId','chainId'],['nonce','nonce'],['value','value'],['type','type'],['gasLimit','gas'],['maxFeePerGas','maxFeePerGas'],['maxPriorityFeePerGas','maxPriorityFeePerGas']])tx[target]=toQuantity(request[source]);
 // This request was durably reserved by the server. Never choose another nonce
 // or silently retry eth_sendTransaction after a lost wallet response.
 const hash=await wallet.request({method:'eth_sendTransaction',params:[tx]});
 if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('Кошелёк не вернул хеш. Проверьте его историю.');
 return hash;
}
