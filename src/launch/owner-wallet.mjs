// Connection is read-only. Transaction approval stays in owner-signing.mjs.
export function ownerWallet({owner,changed,provider=()=>window.ethereum}) {
 let wallet,account='',chain='',message='Кошелёк не подключён',busy=false;
 const expected=owner.toLowerCase();
 const validChain=value=>{try{return BigInt(value)===4663n;}catch{return false;}};
 const state=()=>({account,chain,message,busy,ready:account.toLowerCase()===expected&&validChain(chain)});
 const emit=()=>changed(state());
 const accountsChanged=accounts=>{account=accounts?.[0]??'';message=account?'':'Кошелёк отключён';emit();};
 const chainChanged=value=>{chain=value;emit();};
 const disconnected=()=>{account='';chain='';message='Кошелёк отключён';emit();};
 function bind(){
  const next=provider();if(!next?.request)throw Error('Расширение кошелька не найдено. Откройте страницу в браузере с установленным кошельком.');
  if(next!==wallet){for(const [event,fn] of [['accountsChanged',accountsChanged],['chainChanged',chainChanged],['disconnect',disconnected]]){wallet?.removeListener?.(event,fn);next.on?.(event,fn);}wallet=next;}
  return wallet;
 }
 async function check(prompt=false){
  const w=bind();const accounts=await w.request({method:prompt?'eth_requestAccounts':'eth_accounts'});
  account=accounts?.[0]??'';chain=await w.request({method:'eth_chainId'});message=account?'':'Кошелёк не подключён';emit();return state();
 }
 async function run(fn){if(busy)return;busy=true;emit();try{await fn();}catch(e){account='';message=e.code===4001?'Подключение или смена сети отменены. Можно повторить.':e.message;}finally{busy=false;emit();}}
 return {state,connect:()=>run(()=>check(true)),restore:()=>run(()=>check(false)),switchChain:()=>run(async()=>{await bind().request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});await check();}),
  async requireReady(){const s=await check();if(!s.ready)throw Error('Выберите кошелёк владельца и сеть Robinhood Chain (4663).');return wallet;}};
}
