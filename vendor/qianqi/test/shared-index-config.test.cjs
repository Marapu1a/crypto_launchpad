const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildIndexConfigs,validateIndexConfig}=require('../scripts/shared-index-config.cjs');
const {schedulerConfigFor}=require('../scripts/pons-automation.cjs'),{hash}=require('../scripts/direct-buy.cjs');
test('shared builder preserves scheduler identity, isolates mutations and refuses any extra drift',()=>{
 const manifest={chainId:4663},lifecycle={instanceId:'id'};
 const c={manifest,lifecycle,buyPolicy:{chainId:4663,instanceId:'id',genesisHash:hash(manifest)},indexer:{statePath:require('path').resolve('.local/shared.json'),maxAgeSeconds:120}};
 const old={schema:'robinhood-promo-scheduler-v1',manifest,lifecycle,campaignId:'1',shortBudgetMode:'FREE_SHORT',chunkSize:64,cutoffMode:'FINALIZED_CHECKPOINT',buyPolicyMode:'admitted',buyPolicy:c.buyPolicy,indexer:c.indexer};
 const parentHash=hash(c),pair=buildIndexConfigs(schedulerConfigFor(c));
 assert.equal(hash(pair.schedulerConfig),hash(old));assert.equal(hash(c),parentHash);assert(Object.isFrozen(pair.indexConfig.manifest));
 validateIndexConfig(old,pair.indexConfig);
 for(const changed of [{...pair.indexConfig,chunkSize:65},{...pair.indexConfig,publicStatus:false},{...pair.indexConfig,extra:true},{...pair.indexConfig,indexer:{...c.indexer,maxAgeSeconds:121}}])assert.throws(()=>validateIndexConfig(old,changed),/mismatch/);
 c.manifest.chainId=1;assert.equal(pair.indexConfig.manifest.chainId,4663);
});
