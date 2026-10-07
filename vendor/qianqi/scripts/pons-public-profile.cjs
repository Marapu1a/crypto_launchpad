// Pons-specific, read-only release admission. No signer and no sending API.
const {ethers}=require('ethers'),{hash}=require('./direct-buy.cjs');
const {TIMING}=require('./deployment-admission.cjs');
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const check=(ok,label)=>{if(!ok)throw Error(label);};
function pins(c){return {...Object.fromEntries(Object.entries(c.manifest.codeHashes).map(([k,v])=>[k,[c.manifest[k],v]])),
 token:[c.manifest.token,c.manifest.codeHashes.token],quote:[c.manifest.quote,c.manifest.codeHashes.quote],
 registry:[c.manifest.registry,c.manifest.codeHashes.registry],collector:[c.collector,c.codeHashes.collector],escrow:[c.escrow,c.codeHashes.escrow],
 vault:[c.vault,c.lifecycle.vaultCodeHash],short:[c.lifecycle.source,c.lifecycle.sourceCodeHash],monthly:[c.lifecycle.monthlySource,c.lifecycle.monthlySourceCodeHash],
 adapter:[c.deliveryJob.adapter,c.deliveryJob.adapterCodeHash],buyPolicy:[c.buyPolicy.source,c.buyPolicy.sourceCodeHash]};}
const IMPLEMENTATION_SLOT=ethers.toBeHex(BigInt(ethers.id('eip1967.proxy.implementation'))-1n,32);
function validateQuote(profile,c){
 const q=profile.quoteImplementation;
 check(q?.kind==='eip1967'&&ethers.isAddress(q.address)&&q.address!==ethers.ZeroAddress&&!same(q.address,c.manifest.quote)&&ethers.isHexString(q.codeHash,32),'Explicit USDG implementation pin required');
}
async function inspectQuote(provider,profile,c,blockTag){
 validateQuote(profile,c);const q=profile.quoteImplementation;
 const stored=await provider.getStorage(c.manifest.quote,IMPLEMENTATION_SLOT,blockTag);
 check(same(stored,ethers.zeroPadValue(q.address,32)),'USDG implementation slot mismatch');
 const code=await provider.getCode(q.address,blockTag);
 check(code!=='0x'&&same(ethers.keccak256(code),q.codeHash),'USDG implementation runtime mismatch');
}
function validate(profile,c){
 check(profile?.schema==='pons-public-profile-v1'&&profile.configHash===hash(c),'Pons profile/config mismatch');
 check(String(c.manifest.chainId)==='4663'&&String(c.deliveryJob.chainId)==='4663','Robinhood chain required');
 check(c.buyPolicy&&c.indexer&&String(c.manifest.entryThresholdRaw)==='100000000'&&c.manifest.quoteDecimals===6,'Admitted USDG policy required');
 validateQuote(profile,c);
 const route=require('./pons-profiles.cjs').pool(c.manifest.schema);check(route,'Pons route required');route.validate(c.manifest);
 const scheduler=require('./pons-automation.cjs').schedulerConfigFor(c);check(scheduler.cutoffMode==='FINALIZED_CHECKPOINT','Finalized index required');
 require('./operational-profile.cjs').validate(profile.operational);
 check(ethers.isAddress(c.executor)&&c.executor!==ethers.ZeroAddress,'Executor required');
 check(c.campaignId==='1'&&c.recipients?.length===3&&same(c.recipients[0],c.vault)&&same(c.recipients[1],profile.operational.roles.operations)&&same(c.recipients[2],profile.operational.roles.project),'Recipient roles mismatch');
 for(const [name,[address,digest]] of Object.entries(pins(c)))check(ethers.isAddress(address)&&address!==ethers.ZeroAddress&&ethers.isHexString(digest,32),'Invalid pin '+name);
 check(same(c.lifecycle.vault,c.vault)&&same(c.deliveryJob.short,c.lifecycle.source)&&same(c.deliveryJob.monthly,c.lifecycle.monthlySource),'Lifecycle binding mismatch');
 check(same(c.deliveryJob.shortCodeHash,c.lifecycle.sourceCodeHash)&&same(c.deliveryJob.monthlyCodeHash,c.lifecycle.monthlySourceCodeHash),'Delivery runtime mismatch');
 const addresses=Object.values(pins(c)).map(([a])=>a.toLowerCase());check(new Set(addresses).size===addresses.length,'Overlapping contract identities');
 for(const k of TIMING)check(typeof profile.timing?.[k]==='string'&&/^(0|[1-9][0-9]*)$/.test(profile.timing[k]),'Explicit timing required: '+k);
 const t=Object.fromEntries(TIMING.map(k=>[k,BigInt(profile.timing[k])]));
 check(t.shortInterval===21600n&&t.monthlyInterval===2592000n&&t.cutoffDelayBlocks>0n&&t.cutoffDelayBlocks<=256n,'Product intervals mismatch');
 check(t.maxClockLag>0n&&t.maxFinalizedLag>0n&&t.maxBeaconLag>0n&&t.leadSeconds>t.maxClockLag+t.maxClockAhead+t.maxFinalizedLag&&t.leadSeconds<=2592000n,'Incoherent timing');
 check(BigInt(c.maxGasPrice)>0n&&BigInt(c.gasLimit)>0n&&['short','monthly'].every(k=>BigInt(c.maxGasPrice)<=BigInt(profile.operational.controllers[k].maxGasPrice)),'Worker gas ceiling mismatch');
 return profile;
}
async function inspect(provider,profile,c,{now=Math.floor(Date.now()/1000)}={}){
 validate(profile,c);const checks=[],reasons=[],record=(ok,label)=>{checks.push({check:label,ok:!!ok});if(!ok)reasons.push(label);};
 const result=()=>({schema:'pons-public-admission-v1',status:reasons.length?'blocked':'matched',profileHash:hash(profile),checks,reasons,publicExecution:false,authorizationToFreeze:false});
 try{
  record(String((await provider.getNetwork()).chainId)==='4663','chain');if(reasons.length)return result();
  const head=await provider.getBlock('latest'),final=await provider.getBlock('finalized');check(head&&final,'Missing head/finality');
  const t=profile.timing;
  record(now-head.timestamp<=Number(t.maxClockLag)&&head.timestamp-now<=Number(t.maxClockAhead),'clock');
  record(final.number<=head.number&&head.timestamp-final.timestamp>=0&&head.timestamp-final.timestamp<=Number(t.maxFinalizedLag),'finalityLag');
  record(same((await provider.getBlock(final.number))?.hash,final.hash),'finalityBranch');
  const at={blockTag:head.number},map=pins(c),address=k=>map[k][0];
  for(const [k,[a,h]] of Object.entries(map)){const code=await provider.getCode(a,head.number);record(code!=='0x'&&same(ethers.keccak256(code),h),'runtime:'+k);}
  if(reasons.length)return result();
  try{await inspectQuote(provider,profile,c,head.number);record(true,'quoteImplementation');}catch{record(false,'quoteImplementation');return result();}
  const read=(k,method,type='address',args=[],inputs='')=>new ethers.Contract(address(k),[`function ${method}(${inputs}) view returns(${type})`],provider)[method](...args,at);
  const match=async(k,method,value,type='address')=>record(same(await read(k,method,type),value),'binding:'+k+'.'+method);
  for(const [k,method,target]of [['vault','shortController','short'],['vault','monthlyController','monthly'],['vault','projectToken','token'],['vault','quoteToken','quote'],['collector','promoVault','vault'],['collector','projectToken','token'],['collector','quoteToken','quote'],['collector','escrow','escrow'],['short','datasetVault','vault'],['monthly','monthlyVault','vault'],['short','datasetRegistry','registry'],['monthly','monthlyRegistry','registry'],['short','randomProvider','adapter'],['monthly','randomProvider','adapter'],['adapter','shortConsumer','short'],['adapter','monthlyConsumer','monthly']])await match(k,method,address(target));
  for(const k of ['short','monthly']){await match(k,'publisher',c.executor);await match(k,'CONTROLLER_PROFILE',ethers.id('promo-robinhood-'+k+'-drand-'+(k==='short'?'v1':'v2')),'bytes32');}
  await match('short','datasetInstance',c.lifecycle.instanceId,'bytes32');await match('monthly','monthlyInstance',c.lifecycle.monthlyInstanceId,'bytes32');
  await match('quote','decimals',6,'uint8');await match('monthly','minimumMonthlyBudget','100000000','uint256');
  await match('adapter','PROFILE',require('./drand-preflight.cjs').PROFILE,'bytes32');await match('adapter','CHAIN_HASH','0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3','bytes32');
  for(const k of TIMING.slice(0,5))await match('adapter',k,t[k],'uint256');
  await match('short','SHORT_INTERVAL',t.shortInterval,'uint256');await match('monthly','monthlyInterval',t.monthlyInterval,'uint256');
  for(const k of ['short','monthly'])await match(k,'cutoffDelayBlocks',t.cutoffDelayBlocks,'uint256');
  await match('collector','campaignId',c.campaignId,'uint64');
  for(const k of ['factory','curve','hook'])await match('collector',k,c.manifest[k]);
  await match('collector','poolId',c.manifest.poolId,'bytes32');
  await match('collector','escrowCodeHash',c.codeHashes.escrow,'bytes32');
  await match('collector','venueCodeHash',ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32','bytes32','bytes32'],['factory','curve','hook'].map(k=>c.manifest.codeHashes[k]))),'bytes32');
  const policy=await read('collector','policy','tuple(uint64 endsAt,address[3] recipients,uint16[3] bps)',[c.campaignId],'uint64');
  record(policy.recipients.every((a,i)=>same(a,c.recipients[i]))&&policy.bps.every((b,i)=>b===BigInt([9000,500,500][i])),'creatorAllocation');
  await match('buyPolicy','instanceId',c.lifecycle.instanceId,'bytes32');
  // Reuse existing genesis, roles and gas checks without pretending Pons is Infinity.
  const compatible={fundingJob:{recipients:c.recipients},schedulerConfig:{...require('./pons-automation.cjs').schedulerConfigFor(c)},ops:{maxGasPrice:c.maxGasPrice,reserveGasPrice:c.maxGasPrice}};
  await require('./operational-profile.cjs').inspect({provider,profile:{pins:map,operational:profile.operational},config:compatible,at,test:record});
  for(const anchor of [c.manifest.anchor,c.deliveryJob.anchor])record(anchor.number<=final.number&&same((await provider.getBlock(anchor.number))?.hash,anchor.hash),'anchor');
  record(same((await provider.getBlock(head.number))?.hash,head.hash),'stableObservation');
  return {...result(),observedBlock:{number:head.number,hash:head.hash}};
 }catch(e){return {...result(),status:'blocked',reasons:[...reasons,'observationUnavailable'],retryable:require('./local-rpc-watch.cjs').retryableRead(e)};}
}
module.exports={validate,inspect,pins,inspectQuote,IMPLEMENTATION_SLOT};
