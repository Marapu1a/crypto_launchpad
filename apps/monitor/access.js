// Retired subscription/wallet-alert prototype. Not part of the free monitor deployment.
/* Wallet identity is proved by a nonce signature; the server alone grants access. */
window.PWAccess=(()=>{
 const words={
 title:['Wallets · subscription','钱包 · 订阅','Кошельки · подписка'],
 intro:['Token charts stay free. A subscription unlocks wallet rankings, saved activity and holdings. Activity alerts are not included.','代币图表永久免费。订阅可解锁钱包排名、已保存的活动和持仓。不包含活动通知。','Графики токенов остаются бесплатными. Подписка открывает топ кошельков, сохранённую историю и позиции. Уведомления об активности не входят в подписку.'],
 connect:['Connect and sign in','连接钱包并登录','Подключить кошелёк и войти'],logout:['Sign out','退出','Выйти'],
 unavailable:['Subscriptions are being prepared. Payments are not open yet.','订阅准备中，暂不接受付款。','Подписка готовится. Приём оплаты пока не открыт.'],
 missing:['Open this page in a wallet browser or install an Ethereum wallet extension.','请在钱包浏览器中打开，或安装以太坊钱包扩展。','Открой страницу в браузере кошелька или установи расширение Ethereum-кошелька.'],
 day:['24 hours','24 小时','24 часа'],week:['7 days','7 天','7 дней'],month:['30 days','30 天','30 дней'],
 pay:['Pay in ETH','使用 ETH 支付','Оплатить ETH'],send:['Confirm in wallet','在钱包中确认','Подтвердить в кошельке'],check:['Check payment','检查付款','Проверить платёж'],
 terms:['Robinhood Chain · ETH only. Network gas is extra. The quoted amount is fixed for 10 minutes. Access starts after finality; renewals extend existing access.','仅限 Robinhood Chain 的 ETH，另付网络手续费。报价锁定 10 分钟，最终确认后开通；续费叠加时长。','Robinhood Chain · только ETH. Газ оплачивается отдельно. Сумма фиксируется на 10 минут. Доступ — после финализации, продление добавляет время.'],
 expiry:['Quote valid until','报价有效期至','Счёт действует до'],active:['Access until','访问权限至','Доступ до'],operator:['Project owner access','项目所有者访问权限','Доступ владельца проекта'],
 expired:['Quote expired. Request a new quote if you have not sent payment.','报价已过期。若尚未付款，请获取新报价。','Счёт истёк. Если ещё не платил — получи новую сумму.'],
 pending:['Payment submitted. Waiting for finality. You can return to this page later.','付款已提交，等待最终确认。可稍后返回此页。','Платёж отправлен, ждём финализации. Можно вернуться на эту страницу позже.'],
 paid:['Payment confirmed. Access granted.','付款已确认，权限已开通。','Платёж подтверждён. Доступ открыт.'],
 review:['Payment needs review (late or different amount). Do not pay again. Contact support with the invoice and transaction below.','付款需要人工核查（超时或金额不符）。请勿重复付款，联系支持并提供下方订单与交易。','Платёж требует проверки: срок или сумма не совпали. Повторно не плати. Напиши в поддержку, приложив счёт и транзакцию ниже.'],
 failed:['Could not complete the request. Check your wallet and try again. No automatic payment is made.','请求未完成，请检查钱包后重试。不会自动扣款。','Не удалось выполнить запрос. Проверь кошелёк и попробуй снова. Автоматического списания нет.'],
 wrong:['Switch to the signed-in wallet and Robinhood Chain (4663).','请切换到已登录的钱包及 Robinhood Chain（4663）。','Переключись на кошелёк, с которым вошёл, и Robinhood Chain (4663).'],
 history:['Your invoices','你的订单','Твои счета'],demo:['Example only · no live wallet data','仅为示例 · 非实时钱包数据','Пример · это не данные реального кошелька'],
 demoText:['Buyer address · 12 buys · 3 sells · 4 tokens. Sign in to view your access options.','买家地址 · 12 次买入 · 3 次卖出 · 4 种代币。登录后查看访问选项。','Адрес покупателя · 12 покупок · 3 продажи · 4 токена. Войди, чтобы проверить доступ.'],
 closed:['The subscription has ended. Renew to continue.','订阅已到期，请续费。','Подписка закончилась. Продли её для доступа.'],
 checking:['Checking…','检查中…','Проверяем…'],recipient:['Recipient','收款地址','Получатель'],rate:['ETH / USD rate','ETH / USD 汇率','Курс ETH / USD']
 };
 words.recover=['Already sent a payment? Paste its transaction hash instead of paying again.','已付款？请粘贴交易哈希，不要重复付款。','Уже отправил платёж? Вставь хеш транзакции вместо повторной оплаты.'];
 const t=k=>words[k]?.[U.locale().startsWith('ru')?2:U.locale().startsWith('zh')?1:0]??k;
 let clockOffset=0;const nowSeconds=()=>Math.floor(Date.now()/1000)+clockOffset;
 let state={active:false,wallet:null},invoice=null,working=false,message='',checkTimer=null,checks=0;
 const root=document.getElementById('subscription'),workspace=document.getElementById('wallet-workspace');
 const n=U.node;
 async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(40000)});const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error),{code:d.error});return d}
 const button=(label,action)=>{const b=n('button',label);b.type='button';b.disabled=working;b.onclick=()=>run(action);return b};
 async function run(fn){if(working)return;working=true;message='checking';draw();try{await fn()}catch(e){message=e.code==='NO_WALLET'?'missing':e.code==='WRONG_ACCOUNT'?'wrong':'failed'}finally{working=false;draw()}}
 function reveal(){workspace.hidden=!state.active;document.dispatchEvent(new CustomEvent('pw-access',{detail:state}));}
 async function refresh(){state=await api('/api/access');if(Number.isFinite(state.serverTime))clockOffset=state.serverTime-Math.floor(Date.now()/1000);reveal();draw();return state}
 async function connect(){if(!window.ethereum)throw Object.assign(Error(),{code:'NO_WALLET'});const [address]=await ethereum.request({method:'eth_requestAccounts'});const c=await api('/api/auth/challenge',{wallet:address});const bytes='0x'+Array.from(new TextEncoder().encode(c.message),v=>v.toString(16).padStart(2,'0')).join('');const signature=await ethereum.request({method:'personal_sign',params:[bytes,address]});await api('/api/auth/verify',{id:c.id,signature});message='';await refresh();await history()}
 async function history(){if(!state.wallet)return;const d=await api('/api/billing/invoices');invoices=d.invoices;const pending=invoices.find(x=>x.state==='pending');if(!invoice&&pending){invoice=pending;message='pending';schedule()}draw()}
 let invoices=[];
 async function check(){if(!invoice?.txHash)return;invoice=await api('/api/billing/confirm',{invoiceId:invoice.id,txHash:invoice.txHash});message=invoice.state==='paid'?'paid':invoice.state==='review'?'review':'pending';if(invoice.state==='paid'){await refresh();await history()}else if(invoice.state!=='review')schedule()}
 function schedule(){clearTimeout(checkTimer);if(++checks<=6)checkTimer=setTimeout(()=>run(check),15000)}
 async function send(){if(!window.ethereum)throw Object.assign(Error(),{code:'NO_WALLET'});if(nowSeconds()>=invoice.expiresAt){message='expired';return}const accounts=await ethereum.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!==state.wallet)throw Object.assign(Error(),{code:'WRONG_ACCOUNT'});await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});if(nowSeconds()>=invoice.expiresAt){message='expired';return}
  const txHash=await ethereum.request({method:'eth_sendTransaction',params:[{from:state.wallet,to:invoice.recipient,value:'0x'+BigInt(invoice.amountWei).toString(16),data:invoice.data}]});invoice={...invoice,txHash};try{localStorage.setItem('pw-payment-'+state.wallet,JSON.stringify({id:invoice.id,txHash}))}catch{}message='pending';checks=0;await check();
 }
 function draw(){root.replaceChildren();root.append(n('h2',t('title')),n('p',t('intro')));
  const account=n('div','','billing-account');if(state.wallet){account.append(n('span',state.wallet,'address'),button(t('logout'),async()=>{await api('/api/auth/logout',{});invoice=null;invoices=[];clearTimeout(checkTimer);message='';await refresh()}));if(state.active)account.append(n('strong',state.operator?t('operator'):t('active')+' '+U.clock(state.expiresAt)));}else {const login=button(t('connect'),connect);login.disabled=working||state.preview===true;account.append(login)}root.append(account);
  if(!state.active){const demo=n('div','','billing-demo');demo.append(n('strong',t('demo')),n('p',t('demoText')));root.append(demo)}
  const plans=n('div','','billing-plans');for(const [key,cost] of [['day',1],['week',4],['month',10]]){const card=n('div','','billing-plan');card.append(n('h3',t(key)),n('strong','$'+cost));const pay=button(t('pay'),async()=>{if(!state.wallet)await connect();invoice=await api('/api/billing/quote',{plan:key});message='';checks=0;clearTimeout(checkTimer)});pay.disabled=working||!state.paymentsEnabled;card.append(pay);plans.append(card)}root.append(plans,n('p',t('terms'),'definition'));if(!state.paymentsEnabled)root.append(n('p',t('unavailable'),'quality'));
  if(invoice){const box=n('section','','billing-invoice');box.append(n('strong',invoice.amountETH+' ETH'),n('p',t('rate')+': $'+invoice.rateUsd),n('p',t('recipient')+': '+invoice.recipient,'address'),n('p',t('expiry')+': '+U.clock(invoice.expiresAt)),n('small','ID: '+invoice.id));if(invoice.txHash){const a=n('a',invoice.txHash,'address');a.href='https://robinhoodchain.blockscout.com/tx/'+invoice.txHash;a.target='_blank';a.rel='noopener noreferrer';box.append(a);if(invoice.state!=='paid')box.append(button(t('check'),check))}else if(invoice.state==='quoted'){const b=button(t('send'),send);b.disabled=working||!state.paymentsEnabled||nowSeconds()>=invoice.expiresAt;box.append(b);const remaining=n('small','','quote-countdown');remaining.dataset.expires=invoice.expiresAt;box.append(remaining);if(nowSeconds()>=invoice.expiresAt)box.append(n('p',t('expired')))}if(!invoice.txHash&&invoice.state!=='paid'){const help=n('details','');help.append(n('summary',t('recover')));const input=n('input','');input.placeholder='0x…';input.setAttribute('aria-label',t('recover'));input.maxLength=66;help.append(input,button(t('check'),async()=>{if(!/^0x[0-9a-f]{64}$/i.test(input.value.trim()))throw Error();invoice.txHash=input.value.trim();await check()}));box.append(help)}root.append(box)}
  const status=n('p',message?t(message):'','billing-status');status.setAttribute('role','status');root.append(status);
  if(invoices.length){const list=n('details','');list.append(n('summary',t('history')));for(const x of invoices)list.append(button(t(x.plan)+' · '+U.clock(x.createdAt)+' · '+x.state,async()=>{invoice=x;message=x.state==='paid'?'paid':x.state==='review'?'review':''}));root.append(list)}
 }
 document.addEventListener('languagechange',draw);
 if(window.ethereum?.on)ethereum.on('accountsChanged',()=>run(async()=>{await api('/api/auth/logout',{});invoice=null;invoices=[];await refresh()}));
 setInterval(()=>{const el=root.querySelector('.quote-countdown');if(el){const seconds=Math.max(0,Number(el.dataset.expires)-nowSeconds());el.textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');if(!seconds&&!working)draw()}},1000);
 const ready=refresh().then(async()=>{await history();try{const saved=JSON.parse(localStorage.getItem('pw-payment-'+state.wallet)??'null');if(saved&&!invoice){invoice=invoices.find(x=>x.id===saved.id);if(invoice&&invoice.state!=='paid'){invoice.txHash=saved.txHash;await check()}}}catch{}return state}).catch(()=>{message='failed';draw();return state});
 setInterval(()=>{if(!working)void refresh().catch(()=>{state.active=false;reveal()})},60000);
 return {ready,active:()=>state.active,refresh};
})();
