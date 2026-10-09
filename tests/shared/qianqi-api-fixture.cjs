const {history,addr}=require('../../server/adapters/qianqi/runtime/test/fixtures/attempt-history.cjs');
const {hash}=require('../../server/adapters/qianqi/runtime/scripts/direct-buy.cjs');
const {replayAttempts}=require('../../server/adapters/qianqi/runtime/scripts/attempt-lifecycle.cjs');
const {projectRewards}=require('../../server/adapters/qianqi/runtime/scripts/reward-observation.cjs');
module.exports=function(){
 const h=history(),vault=addr(777);h.config.vault=vault;h.buy(300_000000n);
 const config={manifest:h.manifest,lifecycle:h.config,publicStatus:true,indexer:{statePath:require('node:path').resolve('.local/nonexistent-private-index.json'),maxAgeSeconds:60}};
 const ledger=replayAttempts(h.manifest,h.config,h.blocks),head=h.blocks.at(-1);
 const state={schema:'local-scheduler-state-v1',jobs:{SHORT:[],MONTHLY:[]},configHash:hash({kind:'persistent-buy-indexer-v1',config}),status:{state:'caughtUp'},index:{manifest:h.manifest,head:ledger.head.number,observedAt:new Date().toISOString(),ledgerHash:hash(ledger.buyLedger),blocks:h.blocks,policyStatus:{mode:'admitted'},rewards:{...projectRewards(h.blocks,vault),blockTag:head.number},publicObservation:{schema:'promo-public-observation-v1',blockTag:head.number,blockHash:head.hash,manifestHash:hash(h.manifest),vault,asset:{address:h.manifest.quote.toLowerCase(),decimals:h.manifest.quoteDecimals,symbol:'USDG',codeHash:h.manifest.codeHashes.quote},reserves:{freeShort:'100000000',freeCurrent:'100000000',freeNext:'100000000',nextStartTarget:'100000000',reserved:'0',claimable:'0',balance:'300000000'},timing:{SHORT:{earliestAt:'1',minimumRaw:'100000000'},MONTHLY:{earliestAt:'9999999999',minimumRaw:'100000000'}}}}};
 const raw=JSON.stringify({...state,checksum:hash(state)});
 return {config,raw,wallet:ledger.wallets[0].wallet};
};
