process.env.HARDHAT_CONFIG=require.resolve('./fixtures/public-hardhat.config.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{ethers}=require('ethers'),hre=require('hardhat');
const {prepare,beacon,target}=require('./fixtures/robinhood-obligations.cjs');hre.config.networks.hardhat.initialDate=new Date((target-40*86400)*1000).toISOString();
const {setup,rpc,sent}=require('./fixtures/robinhood-runtime.cjs'),{hash}=require('../scripts/direct-buy.cjs');
const {runPonsAutomation:run,schedulerConfigFor}=require('../scripts/pons-automation.cjs');
const compiled=require('../scripts/compile.cjs').compile();
async function fixture(t){
 const f=await setup(t,compiled,{launchRules:true}),c=structuredClone(require('./fixtures/pons-public-config.json'));
 c.schema='pons-public-automation-v1';delete c.instanceId;c.executor=f.owner;c.vault=f.vault.target;c.lifecycle=f.options.schedulerConfig.lifecycle;c.deliveryJob=f.options.deliveryJob;
 const code=async address=>ethers.keccak256(await f.provider.getCode(address));
 const escrow=await f.deploy('PonsEscrowFixture'),collector=await f.deploy('LocalPonsCollector',[f.owner,f.token.target,f.quote.target,escrow.target]);
 c.escrow=escrow.target;c.collector=collector.target;c.codeHashes={escrow:await code(c.escrow),collector:await code(c.collector)};
 c.recipients=[c.vault,...f.options.fundingJob.recipients.slice(1)];
 await sent(collector.bindPromo([target+86400,c.recipients,[9000,500,500]]));
 // Distinct synthetic venue endpoints: full funding admission must reject this graph.
 for(const k of ['factory','curve','hook'])c.manifest[k]=(await f.deploy('MockToken')).target;
 c.manifest.token=f.token.target;c.manifest.quote=f.quote.target;c.manifest.registry=f.registry.target;
 c.manifest.poolKey=[...[f.token.target,f.quote.target].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1),0,200,c.manifest.hook];
 c.manifest.poolId=require('../scripts/pons-v4-buy.cjs').poolId(c.manifest.poolKey);
 for(const [a,bytes]of Object.entries(require('./fixtures/pons-public-venue-code.json')))await rpc('hardhat_setCode',[a,bytes]);
 const head=await f.provider.getBlock('latest');c.manifest.anchor={number:head.number,hash:head.hash};
 for(const k of Object.keys(c.manifest.codeHashes))c.manifest.codeHashes[k]=await code(c.manifest[k]);
 const bp=await f.deploy('BuyPolicySource',[c.lifecycle.instanceId,hash(c.manifest),f.owner,2,require('../scripts/buy-policy-format.cjs').initialAdapters(c.manifest)]);
 c.buyPolicy={chainId:4663,instanceId:c.lifecycle.instanceId,source:bp.target,publisher:f.owner,genesisHash:hash(c.manifest),noticeBlocks:2,sourceCodeHash:await code(bp.target)};
 c.indexer={statePath:path.join(f.directory,'unused-index.json'),maxAgeSeconds:60};c.maxTransactions=64;
 f.options.schedulerConfig=schedulerConfigFor(c);
 const operational={schema:'promo-operational-profile-v1',roles:{governor:f.owner,operations:c.recipients[1],project:c.recipients[2],buyPolicyPublisher:f.owner},controllers:Object.fromEntries(['short','monthly'].map(k=>[k,{noticeSeconds:'3600',maxGasPrice:'1000000000000',nativeFloor:'0'}])),buyPolicy:{source:bp.target,codeHash:c.buyPolicy.sourceCodeHash,noticeBlocks:'2'},genesis:require('../scripts/operational-profile.cjs').genesis()};
 const publicProfile={schema:'pons-public-profile-v1',configHash:hash(c),operational,timing:f.options.deploymentProfile.timing};
 const implementation=await f.deploy('MockToken');
 publicProfile.quoteImplementation={kind:'eip1967',address:implementation.target,codeHash:await code(implementation.target)};
 await rpc('hardhat_setStorageAt',[f.quote.target,require('../scripts/pons-public-profile.cjs').IMPLEMENTATION_SLOT,ethers.zeroPadValue(implementation.target,32)]);
 const options={provider:f.provider,executor:f.admin,config:c,publicProfile,schedulerConfig:f.options.schedulerConfig,rehearsalInstance:(await rpc('hardhat_metadata')).instanceId,rpcUrl:f.options.rpcUrl,statePath:f.options.statePath,drain:true};
 return {...f,c,options,collector};
}
test('public guard rehearsal drains both real frozen draws despite owner drift; restart does not repay',async t=>{
 const f=await fixture(t),getLogs=f.provider.getLogs.bind(f.provider),payoutWindows=[];
 const topic=f.short.interface.getEvent('AttemptsConsumed').topicHash;
 f.provider.getLogs=async filter=>{
  if(filter.topics?.[0]===topic){assert(BigInt(filter.toBlock)-BigInt(filter.fromBlock)<10000n);payoutWindows.push([filter.fromBlock,filter.toBlock]);}
  return getLogs(filter);
 };
 await rpc('hardhat_mine',['0x4e21']);
 await prepare(f);await sent(f.short.transferOwnership(f.other.address));
 const nonce=await f.provider.getTransactionCount(f.owner),balance=await f.provider.getBalance(f.owner);
 await rpc('hardhat_setBalance',[f.owner,'0x0']);const low=await run(f.options,{getBeacon:beacon});
 assert.equal(low.reason,'nativeFunding',JSON.stringify(low));assert.equal(await f.provider.getTransactionCount(f.owner),nonce);
 await rpc('hardhat_setBalance',[f.owner,ethers.toQuantity(balance)]);
 const r=await run(f.options,{getBeacon:beacon});assert.equal(r.status,'waiting',JSON.stringify(r));
 for(const action of ['prove','deliver','processShort','finishShort','processMonth','finishMonth','claim'])assert(r.steps.some(s=>s.action===action),action+' '+JSON.stringify(r));
 assert.equal(r.publicSends,false);assert.equal(await f.vault.reserved(f.quote.target),0n);assert.equal(await f.vault.claimable(f.quote.target),0n);
 const after=await f.provider.getTransactionCount(f.owner),again=await run(f.options,{getBeacon:beacon});
 assert.equal(again.status,'waiting',JSON.stringify(again));assert.equal(await f.provider.getTransactionCount(f.owner),after);
 assert(payoutWindows.length>=6,'real payout discovery crosses multiple bounded pages');
 const stored=fs.readFileSync(f.options.statePath,'utf8');assert(!stored.includes(f.options.rpcUrl));
 // Restoring an earlier chain cannot silently authorize continuation of paid jobs.
 await rpc('hardhat_reset');await assert.rejects(run(f.options,{getBeacon:beacon}),/Wrong local Robinhood fork|instance/);
});
test('runtime drift after estimation is rejected before durable intent or broadcast',async t=>{
 const f=await fixture(t),state={},guard=require('../scripts/pons-public-execution.cjs').createGuard({provider:f.provider,config:f.c,publicProfile:f.options.publicProfile,compiled});
 let sends=0,saves=0;const method=async()=>{sends++;throw Error('Must not send');};
 method.fragment={name:'claim'};method.populateTransaction=async(...args)=>({to:f.c.vault,data:f.vault.interface.encodeFunctionData('claim',[ethers.id('draw'),f.owner]),...args.at(-1)});
 method.estimateGas=async()=>{await rpc('hardhat_setCode',[f.c.vault,'0x00']);return 21000n;};
 const boundary=require('../scripts/pons-transaction-journal.cjs').createBoundary({state,save:()=>saves++,provider:f.provider,sender:f.owner,guard:async()=>{},onConfirmed:async()=>{}});
 const {sendLocalTransaction,withTransactionBoundary}=require('../scripts/local-receipt.cjs');
 await require('../scripts/runtime-network.cjs').withRobinhoodNetwork({provider:f.provider,rpcUrl:f.options.rpcUrl,mode:'robinhood-rehearsal',publicGuard:guard},async()=>{
  await assert.rejects(withTransactionBoundary(boundary,()=>sendLocalTransaction(method,[],{})),/Obligation runtime mismatch/);
 });
 assert.equal(sends,0);assert.equal(saves,0);assert.equal(state.pending,undefined);
});
test('exhausted pass budget stops before public admission reads or gas estimation',async t=>{
 const f=await fixture(t);let admission=0,estimates=0;
 const method=async()=>assert.fail('must not broadcast');method.fragment={name:'claim'};method.populateTransaction=async()=>({});method.estimateGas=async()=>{estimates++;return 1n;};
 const boundary={preflight:async()=>{throw Object.assign(Error('transactionLimit'),{code:'LOCAL_BUDGET_WAIT',budget:{reason:'transactionLimit'}});},before:async()=>assert.fail('must not save intent')};
 const {sendLocalTransaction,withTransactionBoundary}=require('../scripts/local-receipt.cjs');
 await require('../scripts/runtime-network.cjs').withRobinhoodNetwork({provider:f.provider,rpcUrl:f.options.rpcUrl,mode:'robinhood-rehearsal',publicGuard:async()=>{admission++;throw Error('stale observation');}},async()=>{
  await assert.rejects(withTransactionBoundary(boundary,()=>sendLocalTransaction(method,[],{})),e=>e.code==='LOCAL_BUDGET_WAIT'&&e.budget.reason==='transactionLimit');
 });
 assert.equal(admission,0);assert.equal(estimates,0);
});

test('USDG implementation drift after estimation is rejected before intent and send',async t=>{
 const f=await fixture(t),state={},guard=require('../scripts/pons-public-execution.cjs').createGuard({provider:f.provider,config:f.c,publicProfile:f.options.publicProfile,compiled});
 let sends=0,saves=0;const method=async()=>{sends++;throw Error('Must not send');};
 method.fragment={name:'claim'};method.populateTransaction=async(...args)=>({to:f.c.vault,data:f.vault.interface.encodeFunctionData('claim',[ethers.id('draw'),f.owner]),...args.at(-1)});
 method.estimateGas=async()=>{await rpc('hardhat_setStorageAt',[f.c.manifest.quote,require('../scripts/pons-public-profile.cjs').IMPLEMENTATION_SLOT,ethers.ZeroHash]);return 21000n;};
 const boundary=require('../scripts/pons-transaction-journal.cjs').createBoundary({state,save:()=>saves++,provider:f.provider,sender:f.owner,guard:async()=>{},onConfirmed:async()=>{}});
 const {sendLocalTransaction,withTransactionBoundary}=require('../scripts/local-receipt.cjs');
 await require('../scripts/runtime-network.cjs').withRobinhoodNetwork({provider:f.provider,rpcUrl:f.options.rpcUrl,mode:'robinhood-rehearsal',publicGuard:guard},async()=>{
  await assert.rejects(withTransactionBoundary(boundary,()=>sendLocalTransaction(method,[],{})),/USDG implementation slot mismatch/);
 });
 assert.equal(sends,0);assert.equal(saves,0);assert.equal(state.pending,undefined);
});
