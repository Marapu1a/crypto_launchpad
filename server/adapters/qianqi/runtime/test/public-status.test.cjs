const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {id}=require('ethers');
const {history,addr}=require('./fixtures/attempt-history.cjs');
const {hash}=require('../scripts/direct-buy.cjs');
const {replayAttempts}=require('../scripts/attempt-lifecycle.cjs');
const {abi,projectRewards}=require('../scripts/reward-observation.cjs');
const {createReader,createServer}=require('../scripts/user-status-api.cjs');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-status-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const h=history(),vault=addr(777);h.config.vault=vault;h.buy(300_000000n);
 const draw=h.freeze('public status','SHORT',h.head(),[h.participant(4)]);
 function append(name,args){const event=abi.encodeEventLog(abi.getEvent(name),args);h.append(name,vault,'0x',[{address:vault,...event}]);}
 append('DrawReserved',[draw.drawId,1,h.manifest.quote,100_000000]);
 const config={manifest:h.manifest,lifecycle:h.config,publicStatus:true,indexer:{statePath:path.join(dir,'state.json'),maxAgeSeconds:60}};
 let state;
 function write(){const ledger=replayAttempts(h.manifest,h.config,h.blocks),head=h.blocks.at(-1);state={configHash:hash({kind:'persistent-buy-indexer-v1',config}),status:{state:'caughtUp'},index:{manifest:h.manifest,head:ledger.head.number,observedAt:new Date().toISOString(),ledgerHash:hash(ledger.buyLedger),blocks:h.blocks,policyStatus:{mode:'admitted'},rewards:{...projectRewards(h.blocks,vault),blockTag:head.number},publicObservation:{schema:'promo-public-observation-v1',blockTag:head.number,blockHash:head.hash,manifestHash:hash(h.manifest),vault,asset:{address:h.manifest.quote.toLowerCase(),decimals:h.manifest.quoteDecimals,symbol:'USDG',codeHash:h.manifest.codeHashes.quote},reserves:{freeShort:'0',freeCurrent:'100000000',freeNext:'100000000',nextStartTarget:'100000000',reserved:'100000000',claimable:'0',balance:'300000000'},timing:{SHORT:{earliestAt:'1',minimumRaw:'100000000'},MONTHLY:{earliestAt:'9999999999',minimumRaw:'100000000'}}}}};save();return state;}
 function save(){fs.writeFileSync(config.indexer.statePath,JSON.stringify({...state,checksum:hash(state)}));}
 write();return {h,config,draw,append,write,save,get state(){return state}};
}
test('one snapshot exposes locked tickets, reserves, history, asset and freshness',t=>{
 const f=fixture(t),r=createReader(f.config),overview=r.read({}),wallet=r.read({wallet:f.h.wallet});
 assert.equal(overview.status,'observed');assert.deepEqual(overview.provenance.head,wallet.provenance.head);
 assert.equal(overview.draws.SHORT.state,'inProgress');assert.equal(overview.draws.MONTHLY.state,'awaitingTime');
 assert.equal(wallet.balances.SHORT.frozenByDraw[f.draw.drawId].count,'4');assert.equal(wallet.asset.decimals,6);
 const stale=r.read({now:Date.now()+61000});assert.equal(stale.status,'stale');assert.deepEqual(stale.reserves,overview.reserves);
 const old=f.state.index.publicObservation.blockHash;f.state.index.publicObservation.blockHash=id('wrong branch');f.save();assert.equal(r.read({}).status,'unavailable');
 f.state.index.publicObservation.blockHash=old;f.save();assert.equal(r.read({}).status,'observed');
});
test('terminal no-winner, pagination and outage stay honest',async t=>{
 const f=fixture(t);f.h.terminal(f.draw,0);f.append('DrawFinalized',[f.draw.drawId,0,100_000000]);f.write();
 const r=createReader(f.config);assert.equal(r.read({}).history.items[0].status,'noWinner');const item=r.read({}).history.items[0];assert.equal(item.completedAt,BigInt(f.h.blocks.find(b=>b.hash===item.terminal.source.blockHash).timestamp).toString());assert.equal(item.startedAt,BigInt(f.h.blocks.find(b=>b.hash===item.freeze.blockHash).timestamp).toString());assert.equal(r.read({}).draws.SHORT.state,'awaitingFunding');
 const s=createServer(f.config);await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));const base='http://127.0.0.1:'+s.address().port;
 assert.equal((await fetch(base+'/v1/overview')).status,200);assert.equal((await fetch(base+'/v1/overview?limit=101')).status,400);
 assert.equal((await fetch(base+'/v1/overview',{method:'POST'})).status,405);
 fs.unlinkSync(f.config.indexer.statePath);const res=await fetch(base+'/v1/overview');assert.equal(res.status,503);assert.equal((await res.json()).reserves,null);
});
test('standby server has no fake balances or ready health',async t=>{
 const s=createServer(null,{health:()=>({ready:false,status:'awaitingDeployment'})});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));const base='http://127.0.0.1:'+s.address().port;
 for(const route of ['/v1/overview','/v1/wallets/'+addr(1),'/healthz'])assert.equal((await fetch(base+route)).status,503);
});
