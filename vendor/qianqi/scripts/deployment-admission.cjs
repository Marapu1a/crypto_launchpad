// Read-only deployment pin verification. A matching local profile is not release approval.
const {ethers}=require('ethers'),{hash}=require('./direct-buy.cjs');
const {PROFILE}=require('./drand-preflight.cjs');
const CHAIN_HASH='0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3';
const TIMING=['leadSeconds','maxClockLag','maxClockAhead','maxFinalizedLag','maxBeaconLag','shortInterval','monthlyInterval','cutoffDelayBlocks'];
const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,canonical(x)])):typeof v==='string'&&/^0x[0-9a-fA-F]+$/.test(v)?v.toLowerCase():v;
const configHash=c=>hash(canonical({fundingJob:c.fundingJob,deliveryJob:c.deliveryJob,schedulerConfig:c.schedulerConfig}));
function createDeploymentProfile(config,{scope,executor,timing,sourceCodeHash,operational}){
 const f=config.fundingJob,d=config.deliveryJob,s=config.schedulerConfig,m=s.manifest,l=s.lifecycle;
 const pins={collector:[f.collector,f.collectorCodeHash],source:[f.source,sourceCodeHash],token:[m.token,m.codeHashes.token],quote:[m.quote,m.codeHashes.quote],registry:[m.registry,m.codeHashes.registry],vault:[l.vault,l.vaultCodeHash],short:[d.short,d.shortCodeHash],monthly:[d.monthly,d.monthlyCodeHash],adapter:[d.adapter,d.adapterCodeHash]};
 const profile={schema:'promo-deployment-profile-v1',scope,chainId:String(f.chainId),configHash:configHash(config),executor,quoteDecimals:m.quoteDecimals,timing,pins};
 if(operational){profile.schema='promo-deployment-profile-v2';profile.operational=operational;}
 validateDeploymentProfile(profile,config);return profile;
}
function validateDeploymentProfile(p,config){
 check(['promo-deployment-profile-v1','promo-deployment-profile-v2'].includes(p?.schema)&&['local-rehearsal','public-launch'].includes(p.scope),'Explicit deployment profile required');
 if(p.schema==='promo-deployment-profile-v2')require('./operational-profile.cjs').validate(p.operational);
 else check(!p.operational,'Operational settings require deployment profile v2');
 check(typeof p.chainId==='string'&&/^[1-9][0-9]*$/.test(p.chainId),'Invalid profile chain');
 check(ethers.isAddress(p.executor)&&p.executor!==ethers.ZeroAddress,'Invalid expected executor');
 check(Number.isInteger(p.quoteDecimals)&&p.quoteDecimals>=0&&p.quoteDecimals<=36,'Invalid quote decimals');
 for(const key of ['collector','source','token','quote','registry','vault','short','monthly','adapter']){
  const pin=p.pins?.[key];check(Array.isArray(pin)&&pin.length===2&&ethers.isAddress(pin[0])&&pin[0]!==ethers.ZeroAddress&&/^0x[0-9a-fA-F]{64}$/.test(pin[1]),'Invalid pin '+key);
 }
 for(const key of TIMING)check(typeof p.timing?.[key]==='string'&&/^(0|[1-9][0-9]*)$/.test(p.timing[key]),'Explicit timing required: '+key);
 const t=Object.fromEntries(TIMING.map(k=>[k,BigInt(p.timing[k])]));
 check(t.leadSeconds>t.maxClockLag+t.maxClockAhead+t.maxFinalizedLag&&t.leadSeconds<=2592000n&&t.maxClockLag>0n&&t.maxFinalizedLag>0n&&t.maxBeaconLag>0n,'Incoherent drand timing');
 check(t.shortInterval===21600n&&t.monthlyInterval===2592000n&&t.cutoffDelayBlocks>0n&&t.cutoffDelayBlocks<=256n,'Unexpected product intervals/cutoff');
 if(config){
  check(p.configHash===configHash(config),'Deployment profile config mismatch');
  const f=config.fundingJob,d=config.deliveryJob,s=config.schedulerConfig,m=s.manifest,l=s.lifecycle;
  const expected={collector:[f.collector,f.collectorCodeHash],source:[f.source,p.pins.source[1]],token:[m.token,m.codeHashes.token],quote:[m.quote,m.codeHashes.quote],registry:[m.registry,m.codeHashes.registry],vault:[l.vault,l.vaultCodeHash],short:[d.short,d.shortCodeHash],monthly:[d.monthly,d.monthlyCodeHash],adapter:[d.adapter,d.adapterCodeHash]};
  check(hash(canonical(expected))===hash(canonical(p.pins)),'Pins differ from runtime configuration');
  check(p.chainId===String(f.chainId)&&p.chainId===String(m.chainId)&&p.chainId===String(d.chainId)&&p.quoteDecimals===m.quoteDecimals,'Profile network/assets mismatch');
 }
 return p;
}
async function inspectDeployment(provider,profile,config){
 validateDeploymentProfile(profile,config);const reasons=[],checks=[];
 const result=()=>({status:reasons.length?'blocked':'matched',scope:profile.scope,profileHash:hash(profile),checks,reasons,operationalCoverage:profile.schema==='promo-deployment-profile-v2'?'v2-explicit':'legacy-incomplete',publicLaunchReady:false,authorizationToFreeze:false});
 const test=(ok,label)=>{checks.push({check:label,ok:!!ok});if(!ok)reasons.push(label);};
 if(profile.scope==='public-launch')reasons.push('publicExecutionNotImplemented');
 try{
  test(String((await provider.getNetwork()).chainId)===profile.chainId,'chainId');
  if(profile.scope==='local-rehearsal')test(profile.chainId==='31337','localChainRequired');
  if(profile.scope==='public-launch'){
   test(profile.chainId==='4663','publicChainRequired');
   test(config.schedulerConfig.cutoffMode==='FINALIZED_CHECKPOINT','publicCheckpointMode');
  }
  if(reasons.some(r=>['chainId','publicChainRequired','publicCheckpointMode'].includes(r)))return result();
  const head=await provider.getBlock('latest');check(head,'Missing head');const at={blockTag:head.number};
  for(const [name,[address,digest]] of Object.entries(profile.pins)){
   const code=await provider.getCode(address,head.number);test(code!=='0x'&&same(ethers.keccak256(code),digest),'runtime:'+name);
  }
  if(reasons.some(r=>r.startsWith('runtime:')))return result();
  const address=name=>profile.pins[name][0];
  const read=async(name,method,type='address',args=[])=>new ethers.Contract(address(name),[`function ${method}(${args.map(a=>typeof a==='bigint'?'uint64':'uint256').join(',')}) view returns(${type})`],provider)[method](...args,at);
  const binding=async(name,method,expected,type='address')=>test(same(await read(name,method,type),expected),'binding:'+name+'.'+method);
  for(const [name,method,target] of [['vault','shortController','short'],['vault','monthlyController','monthly'],['short','datasetVault','vault'],['monthly','monthlyVault','vault'],['vault','quoteToken','quote'],['vault','projectToken','token'],['collector','promoVault','vault'],['collector','projectToken','token'],['collector','quoteToken','quote'],['collector','source','source'],['source','projectToken','token'],['short','datasetRegistry','registry'],['monthly','monthlyRegistry','registry'],['short','randomProvider','adapter'],['monthly','randomProvider','adapter'],['adapter','shortConsumer','short'],['adapter','monthlyConsumer','monthly']])await binding(name,method,address(target));
  for(const name of ['short','monthly'])await binding(name,'publisher',profile.executor);
  if(profile.scope==='public-launch')for(const name of ['short','monthly'])await binding(name,'CONTROLLER_PROFILE',ethers.id('promo-robinhood-'+name+'-drand-'+(name==='monthly'?'v2':'v1')),'bytes32');
  await binding('short','datasetInstance',config.schedulerConfig.lifecycle.instanceId,'bytes32');
  await binding('monthly','monthlyInstance',config.schedulerConfig.lifecycle.monthlyInstanceId,'bytes32');
  if(profile.scope==='public-launch')await binding('monthly','minimumMonthlyBudget','100000000','uint256');
  await binding('quote','decimals',String(profile.quoteDecimals),'uint8');
  await binding('adapter','PROFILE',PROFILE,'bytes32');await binding('adapter','CHAIN_HASH',CHAIN_HASH,'bytes32');
  for(const key of TIMING.slice(0,5))await binding('adapter',key,profile.timing[key],'uint256');
  await binding('short','SHORT_INTERVAL',profile.timing.shortInterval,'uint256');await binding('monthly','monthlyInterval',profile.timing.monthlyInterval,'uint256');
  for(const name of ['short','monthly'])await binding(name,'cutoffDelayBlocks',profile.timing.cutoffDelayBlocks,'uint256');
  const f=config.fundingJob;
  await binding('collector','sourceFingerprint',f.sourceFingerprint,'bytes32');await binding('collector','campaignId',f.campaignId,'uint64');
  const collector=new ethers.Contract(address('collector'),['function policy(uint64) view returns(tuple(uint64 endsAt,address[3] recipients,uint16[3] bps))'],provider),policy=await collector.policy(f.campaignId,at);
  if(profile.scope==='public-launch')test([9000n,500n,500n].every((bps,i)=>policy.bps[i]===bps&&BigInt(f.bps[i])===bps),'approvedCreatorAllocation');
  test(policy.recipients.every((x,i)=>same(x,f.recipients[i]))&&policy.bps.every((x,i)=>x===BigInt(f.bps[i])),'campaignPolicy');
  if(profile.schema==='promo-deployment-profile-v2')await require('./operational-profile.cjs').inspect({provider,profile,config,at,test});
  for(const anchor of [f.anchor,config.deliveryJob.anchor,config.schedulerConfig.manifest.anchor])test(anchor.number<=head.number&&same((await provider.getBlock(anchor.number))?.hash,anchor.hash),'deploymentAnchor');
  test(same((await provider.getBlock(head.number))?.hash,head.hash),'stableObservation');
  return {...result(),observedAtBlock:{number:head.number,hash:head.hash,timestamp:head.timestamp}};
 }catch(e){reasons.push('deploymentObservationUnavailable');return {...result(),detail:e.message,retryableRpcRead:require('./local-rpc-watch.cjs').retryableRead(e)};}
}
module.exports={createDeploymentProfile,validateDeploymentProfile,inspectDeployment,TIMING};
