const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{ethers}=require('ethers');
const {fixture,rpc,sent}=require('./public-controllers.cjs');
const I=require('../../scripts/infinity-buy.cjs'),{hash}=require('../../scripts/direct-buy.cjs');
const {initialAdapters}=require('../../scripts/buy-policy-format.cjs');
async function setup(t,compiled,{launchRules=false}={}){
 await rpc('hardhat_reset');const usd='0x5fc5360d0400a0fd4f2af552add042d716f1d168';
 await rpc('hardhat_setCode',[usd,'0x'+compiled.LocalUSDGFixture.evm.deployedBytecode.object]);
 const f=await fixture(compiled,{reset:false,quoteAddress:usd,offset:false,launchRules});
 const code=async c=>ethers.keccak256(await f.provider.getCode(c.target));
 for(const [a,c]of Object.entries(require('../../research/public-deployment/infinity-rpc-test-runtimes.json')))await rpc('hardhat_setCode',[a,c]);
 const settlement='0x4f922d5b15e6691e0469663e4f5c4177f23c5faf';await rpc('hardhat_setCode',[settlement,'0x6000']);
 const hook=await f.deploy('InfinityHookFixture'),factory=await f.deploy('InfinityFactoryFixture');
 const collector=await f.deploy('InfinityCollector',[f.owner,f.token.target,usd,hook.target,factory.target]);
 const source=await f.deploy('InfinityVaultFixture',[f.token.target,hook.target,factory.target,collector.target]);
 await sent(hook.configure(source.target,300));const recipients=[f.vault.target,await (await f.provider.getSigner(3)).getAddress(),await (await f.provider.getSigner(4)).getAddress()],bps=[9000,500,500];
 await sent(collector.bindSource(source.target,[(await f.provider.getBlock('latest')).timestamp+100,recipients,bps]));
 const b=await f.provider.getBlock('latest'),anchor={number:b.number,hash:b.hash};
 const key=[...[f.token.target,usd].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1),I.PINS.hook[0],I.PINS.manager[0],10000,ethers.ZeroHash];
 const manifest={schema:I.SCHEMA,routeVersion:I.ID,eligibility:'automatic-buy-v1',quoteBasis:'wallet-net-debit-v1',chainId:4663,token:f.token.target,quote:usd,registry:f.registry.target,settlement,poolKey:key,poolId:I.poolId(key),quoteDecimals:6,entryThresholdRaw:'100000000',anchor,codeHashes:{}};
 for(const [k,[a]]of Object.entries(I.PINS))manifest[k]=a;
 for(const k of ['router','manager','hook','token','quote','registry','settlement'])manifest.codeHashes[k]=ethers.keccak256(await f.provider.getCode(manifest[k]));
 const sg=await f.short.shortEpochPolicy(1),mg=await f.monthly.monthlyEpochPolicy(1);
 const lifecycle={schema:'attempt-lifecycle-v4',source:f.short.target,sourceCodeHash:await code(f.short),instanceId:await f.short.datasetInstance(),monthlySource:f.monthly.target,monthlySourceCodeHash:await code(f.monthly),monthlyInstanceId:await f.monthly.monthlyInstance(),vault:f.vault.target,vaultCodeHash:await code(f.vault),shortRules:{rulesHash:sg.hash,noticeSeconds:String(await f.short.shortRulesNotice()),startedAt:String(await f.short.shortRulesStartedAt()),firstBlock:String(sg.firstBlock)},monthlyPolicy:{rulesHash:mg.hash,interval:String(await f.monthly.monthlyInterval()),startedAt:String(await f.monthly.monthlyStartedAt())},monthlyRules:{noticeSeconds:String(await f.monthly.monthlyRulesNotice()),firstBlock:String(mg.firstBlock)}};
 const policy=await f.deploy('BuyPolicySource',[lifecycle.instanceId,hash(manifest),f.owner,2,initialAdapters(manifest)]);
 const buyPolicy={chainId:4663,instanceId:lifecycle.instanceId,source:policy.target,publisher:f.owner,genesisHash:hash(manifest),noticeBlocks:2,sourceCodeHash:await code(policy)};
 const fundingJob={schema:'robinhood-infinity-worker-v1',chainId:4663,collector:collector.target,token:f.token.target,quote:usd,promo:f.vault.target,source:source.target,collectorCodeHash:await code(collector),sourceFingerprint:await collector.sourceFingerprint(),anchor,campaignId:'1',recipients,bps,legacy:[],maxGasPrice:'1000000000000',nativeFloor:'1000',gasUnits:{pull:'600000',pay:'600000'},pollSeconds:60};
 const deliveryJob={schema:'robinhood-drand-delivery-v1',chainId:4663,adapter:f.random.target,short:f.short.target,monthly:f.monthly.target,adapterCodeHash:await code(f.random),shortCodeHash:await code(f.short),monthlyCodeHash:await code(f.monthly),anchor,maxGasPrice:fundingJob.maxGasPrice,nativeFloor:'1000',gasUnits:{prove:'500000',deliver:'500000'},pollSeconds:10};
 // Fixture gas bounds only; the tested executor is pons-automation, not legacy Infinity automation.
 const ACTIONS=['pull','pay','prove','deliver','begin','publish','seal','processShort','finishShort','closeEmpty','claim'],MONTHLY_ACTIONS=['beginMonth','publishMonth','sealMonth','processMonth','finishMonth'];
 const ops={schema:'robinhood-promo-automation-v1',maxGasPrice:fundingJob.maxGasPrice,reserveGasPrice:fundingJob.maxGasPrice,nativeFloor:'1000',extraFeePerTx:'0',safetyBps:12000,maxTransactions:32,maxClaims:64,scanBlocks:2000,pollSeconds:10,gasUnits:Object.fromEntries([...ACTIONS,...MONTHLY_ACTIONS,'checkpointCutoff'].map(a=>[a,'3000000']))};
 const schedulerConfig={schema:'robinhood-promo-scheduler-v1',manifest,lifecycle,buyPolicy,cutoffMode:'FINALIZED_CHECKPOINT',campaignId:'1',shortBudget:'100000000',chunkSize:1};
 if(launchRules){schedulerConfig.shortBudgetMode='FREE_SHORT';delete schedulerConfig.shortBudget;}
 const config={fundingJob,deliveryJob,schedulerConfig,ops};
 const deploymentProfile=require('../../scripts/deployment-admission.cjs').createDeploymentProfile(config,{scope:'public-launch',executor:f.owner,sourceCodeHash:await code(source),timing:{leadSeconds:'1800',maxClockLag:'30',maxClockAhead:'5',maxFinalizedLag:'1200',maxBeaconLag:'15',shortInterval:'21600',monthlyInterval:'2592000',cutoffDelayBlocks:'1'}});
 const server=http.createServer(async(req,res)=>{let body='';for await(const p of req)body+=p;const data=JSON.parse(body);const handle=async q=>{try{return {jsonrpc:'2.0',id:q.id,result:await rpc(q.method,q.params)};}catch(e){return {jsonrpc:'2.0',id:q.id,error:{code:-32000,message:e.message}};}};res.setHeader('content-type','application/json');res.end(JSON.stringify(Array.isArray(data)?await Promise.all(data.map(handle)):await handle(data)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const directory=fs.mkdtempSync(path.resolve('.local','robinhood-runtime-'));t.after(()=>{for(const name of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);});
 const options={...config,deploymentProfile,provider:f.provider,executor:f.admin,collector:collector.connect(f.provider),adapter:f.random.connect(f.provider),vault:f.vault.connect(f.provider),short:f.short.connect(f.provider),monthly:f.monthly.connect(f.provider),rpcUrl:'http://127.0.0.1:'+server.address().port,statePath:path.join(directory,'runtime.json'),mode:'robinhood-rehearsal'};
 await sent(f.quote.mint(source.target,6000000));await sent(source.fund(usd,6000000));
 return {...f,collector,source,options,directory};
}
module.exports={setup,rpc,sent};
