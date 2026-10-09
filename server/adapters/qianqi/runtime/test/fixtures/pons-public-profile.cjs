const {ethers}=require('ethers'),path=require('node:path');
const {hash}=require('../../scripts/direct-buy.cjs'),{inspect,pins}=require('../../scripts/pons-public-profile.cjs');
function fixture(){
 const c=structuredClone(require('./pons-public-config.json')),codeHash=ethers.keccak256('0x01');
 c.indexer.statePath=path.resolve('.local/unused-public-inspect.json');
 for(const k of Object.keys(c.manifest.codeHashes))if(!['router','manager','permit2'].includes(k))c.manifest.codeHashes[k]=codeHash;
 c.buyPolicy.genesisHash=hash(c.manifest);c.buyPolicy.sourceCodeHash=codeHash;
 for(const k of Object.keys(c.codeHashes))c.codeHashes[k]=codeHash;
 for(const k of ['vaultCodeHash','sourceCodeHash','monthlySourceCodeHash'])c.lifecycle[k]=codeHash;
 c.deliveryJob.adapterCodeHash=codeHash;
 c.deliveryJob.shortCodeHash=codeHash;c.deliveryJob.monthlyCodeHash=codeHash;
 const op={schema:'promo-operational-profile-v1',roles:{governor:c.executor,operations:c.recipients[1],project:c.recipients[2],buyPolicyPublisher:c.buyPolicy.publisher},controllers:Object.fromEntries(['short','monthly'].map(k=>[k,{noticeSeconds:'3600',maxGasPrice:'1000000000000',nativeFloor:'0'}])),buyPolicy:{source:c.buyPolicy.source,codeHash,noticeBlocks:String(c.buyPolicy.noticeBlocks)},genesis:require('../../scripts/operational-profile.cjs').genesis()};
 const p={schema:'pons-public-profile-v1',configHash:hash(c),operational:op,timing:{leadSeconds:'1800',maxClockLag:'30',maxClockAhead:'5',maxFinalizedLag:'1200',maxBeaconLag:'15',shortInterval:'21600',monthlyInterval:'2592000',cutoffDelayBlocks:'1'}};
 p.quoteImplementation={kind:'eip1967',address:'0x0000000000000000000000000000000000000123',codeHash};
 const views=new Map(),map=pins(c),add=(k,name,type,value,inputs='')=>{const i=new ethers.Interface([`function ${name}(${inputs}) view returns(${type})`]);views.set(map[k][0].toLowerCase()+i.getFunction(name).selector,{i,name,value});};
 for(const [k,name,target]of [['vault','shortController','short'],['vault','monthlyController','monthly'],['vault','projectToken','token'],['vault','quoteToken','quote'],['collector','promoVault','vault'],['collector','projectToken','token'],['collector','quoteToken','quote'],['collector','escrow','escrow'],['short','datasetVault','vault'],['monthly','monthlyVault','vault'],['short','datasetRegistry','registry'],['monthly','monthlyRegistry','registry'],['short','randomProvider','adapter'],['monthly','randomProvider','adapter'],['adapter','shortConsumer','short'],['adapter','monthlyConsumer','monthly']])add(k,name,'address',map[target][0]);
 for(const k of ['short','monthly']){
  add(k,'publisher','address',c.executor);add(k,'CONTROLLER_PROFILE','bytes32',ethers.id('promo-robinhood-'+k+'-drand-'+(k==='short'?'v1':'v2')));
  add(k,'cutoffDelayBlocks','uint256',1);add(k,k==='short'?'shortRulesNotice':'monthlyRulesNotice','uint256',3600);
  add(k,'maxGasPrice','uint256',op.controllers[k].maxGasPrice);add(k,'nativeFloor','uint256',0);
 }
 for(const k of ['short','monthly','collector']){add(k,'owner','address',c.executor);add(k,'pendingOwner','address',ethers.ZeroAddress);}
 add('short','datasetInstance','bytes32',c.lifecycle.instanceId);add('monthly','monthlyInstance','bytes32',c.lifecycle.monthlyInstanceId);
 add('quote','decimals','uint8',6);add('monthly','minimumMonthlyBudget','uint256',100000000);add('vault','nextStartTarget','uint256',100000000);add('short','maxBudget','uint256',ethers.MaxUint256);
 add('short','SHORT_INTERVAL','uint256',21600);add('monthly','monthlyInterval','uint256',2592000);
 add('adapter','PROFILE','bytes32',require('../../scripts/drand-preflight.cjs').PROFILE);add('adapter','CHAIN_HASH','bytes32','0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3');
 for(const k of ['leadSeconds','maxClockLag','maxClockAhead','maxFinalizedLag','maxBeaconLag'])add('adapter',k,'uint256',p.timing[k]);
 for(const k of ['factory','curve','hook'])add('collector',k,'address',c.manifest[k]);add('collector','poolId','bytes32',c.manifest.poolId);
 add('collector','campaignId','uint64',1);add('collector','policy','tuple(uint64 endsAt,address[3] recipients,uint16[3] bps)',[0,c.recipients,[9000,500,500]],'uint64');
 add('collector','escrowCodeHash','bytes32',codeHash);add('collector','venueCodeHash','bytes32',ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','bytes32','bytes32'],[codeHash,codeHash,codeHash])));
 for(const [k,type,value]of [['instanceId','bytes32',c.lifecycle.instanceId],['genesisHash','bytes32',c.buyPolicy.genesisHash],['publisher','address',c.buyPolicy.publisher],['noticeBlocks','uint256',c.buyPolicy.noticeBlocks]])add('buyPolicy',k,type,value);
 const rules='tuple(uint32 version,uint32 pNumerator,uint32 pDenominator,uint32 hNumerator,uint32 hDenominator)';
 add('short','shortEpochPolicy',`tuple(${rules} outcome,uint256[] weights,uint256 minimumUnit,bytes32 hash,uint256 firstBlock)`,[[1,4,5,1,1],[7,4,2,1,1,1,1,1,1,1],5000000,op.genesis.short,1],'uint64');
 add('monthly','monthlyEpochPolicy',`tuple(${rules} outcome,bytes32 hash,uint256 firstBlock)`,[[1,3,4,1,1],op.genesis.monthly,1],'uint64');
 const head={number:c.deliveryJob.anchor.number+5,hash:ethers.id('head'),timestamp:10000};
 const provider={getStorage:async()=>ethers.zeroPadValue(p.quoteImplementation.address,32),getNetwork:async()=>({chainId:4663n}),getCode:async a=>require('./pons-public-venue-code.json')[a.toLowerCase()]||'0x01',getBlock:async n=>n==='latest'||n==='finalized'||n===head.number?head:n===c.manifest.anchor.number?c.manifest.anchor:c.deliveryJob.anchor,call:async req=>{const v=views.get(req.to.toLowerCase()+req.data.slice(0,10));if(!v)throw Error('Unexpected read');return v.i.encodeFunctionResult(v.name,[v.value]);}};
 return {c,p,provider,head,add,run:()=>inspect(provider,p,c,{now:10000})};
}
module.exports={fixture};
