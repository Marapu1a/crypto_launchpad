import {Contract,ZeroAddress,id,keccak256,isAddress} from 'ethers';
import {validatePolicy} from './production-policy.mjs';
import {ABI} from './production-template.mjs';
import {validateProgramConfig} from '../draws/program-config.mjs';
import {amount} from '../draws/config.mjs';
import {compileDrawPrograms,matchesArtifact} from './draw-build.mjs';
const check=(x,m)=>{if(!x)throw Error(m);};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
let trustedBuild;
const build=()=>trustedBuild??=compileDrawPrograms();
const baseRoles=['quote','token','hook','factory','router','curve','escrow','collector','splitter','recognition','fundingRouter'];
export function validateDrawPolicy(p){
 check(p?.schema==='draw-production-policy-v2','Invalid v2 policy');
 check(Object.keys(p).every(k=>['schema','chainId','projectId','executor','publisher','buildHash','anchor','contracts','limits','timing','template'].includes(k)),'Unexpected policy field');
 validatePolicy({...p,schema:'short-production-policy-v1'});
 const t=p.template;check(t?.schema==='draw-template-v2'&&Object.keys(t).every(k=>['schema','instanceId','config','team','operations','creatorTaxBps'].includes(k)),'Invalid template');
 check(/^0x[0-9a-f]{64}$/i.test(t.instanceId)&&t.instanceId!=='0x'+'0'.repeat(64),'Invalid instance');
 const c=validateProgramConfig(t.config);
 for(const key of ['team','operations'])check(isAddress(t[key])&&t[key]!==ZeroAddress,'Invalid recipient');
 check(Number.isInteger(t.creatorTaxBps)&&t.creatorTaxBps>=0&&t.creatorTaxBps<=1000,'Invalid creator fee');
 const roles=[...baseRoles,...(c.short.enabled?['short','shortAdapter']:[]),...(c.monthly.enabled?['monthly','monthlyAdapter']:[])];
 check(Object.keys(p.contracts).length===roles.length&&roles.every(k=>p.contracts[k]),'Contracts do not match mode');
 check(p.buildHash===build().manifest.buildHash,'Untrusted v2 build');
 return c;
}
// Read-only verification at one explicit block. Does not authorize signing or prove dataset truth.
export async function verifyDrawPolicy(provider,p){
 const config=validateDrawPolicy(p),artifacts=build().artifacts;
 check((await provider.getNetwork()).chainId===4663n,'Wrong chain');
 const block=await provider.getBlock('latest');check(block&&block.number>=p.anchor.number,'Missing observation');const at={blockTag:block.number};
 check(same((await provider.getBlock(p.anchor.number))?.hash,p.anchor.hash),'Anchor changed');
 const own={collector:'PonsFeeCollector',splitter:'FeeSplitter',recognition:'PurchaseRecognition',fundingRouter:'DrawFundingRouter',...(config.short.enabled?{short:'ShortProgram',shortAdapter:'ShortDrandAdapter'}:{}),...(config.monthly.enabled?{monthly:'MonthlyProgram',monthlyAdapter:'ShortDrandAdapter'}:{})};
 for(const [role,pin] of Object.entries(p.contracts)){
  const code=await provider.getCode(pin.address,block.number);check(code!=='0x'&&same(keccak256(code),pin.codeHash),'Runtime pin mismatch: '+role);
  if(own[role])check(matchesArtifact(code,artifacts[own[role]]),'Untrusted artifact: '+role);
 }
 const contracts=Object.fromEntries(Object.entries(p.contracts).filter(([role])=>own[role]||ABI[role]).map(([role,pin])=>[role,new Contract(pin.address,own[role]?artifacts[own[role]].abi:ABI[role],provider)]));
 const address=role=>p.contracts[role]?.address??ZeroAddress;
 const read=async(role,getter,value,...args)=>check(same(await contracts[role][getter](...args,at),value),'Binding mismatch: '+role+'.'+getter);
 for(const [r,g,v] of [
  ['quote','decimals',6],['collector','quote',address('quote')],['collector','destination',address('splitter')],['collector','escrow',address('escrow')],['collector','factory',address('factory')],['collector','token',address('token')],['collector','curve',address('curve')],
  ['splitter','quote',address('quote')],['splitter','prizeFund',address('fundingRouter')],['splitter','team',p.template.team],['splitter','operations',p.template.operations],
  ['fundingRouter','quote',address('quote')],['fundingRouter','shortFund',address('short')],['fundingRouter','monthlyFund',address('monthly')],['fundingRouter','shortBps',config.allocation.shortBps],
  ['recognition','instanceId',p.template.instanceId],['recognition','publisher',p.publisher],
  ['curve','token',address('token')],['curve','factory',address('factory')],['curve','pairToken',address('quote')],['curve','deployer',address('collector')],['curve','feeEscrow',address('escrow')],['router','factory',address('factory')],['factory','memeHook',address('hook')]
 ])await read(r,g,v);
 for(const [i,key] of ['prizesBps','teamBps','operationsBps'].entries())await read('splitter','bps',config.fees[key],i);
 for(const lane of ['short','monthly'])if(config[lane].enabled){
  const adapter=lane+'Adapter',settings=config[lane];
  for(const [getter,value] of [['PROFILE',id(lane==='short'?'launchpad-short-usdg-v1':'launchpad-monthly-usdg-v2')],['quote',address('quote')],['operator',p.executor],['instanceId',p.template.instanceId],['randomness',address(adapter)],['interval',settings.intervalSeconds],['minimumFund',amount(settings.minimumFund)]])await read(lane,getter,value);
  await read(adapter,'shortConsumer',address(lane));
  for(const [getter,key] of Object.entries({leadSeconds:'lead',maxClockLag:'clockLag',maxClockAhead:'clockAhead',maxFinalizedLag:'finalizedLag',maxBeaconLag:'beaconLag'}))await read(adapter,getter,p.timing[key]);
  if(lane==='monthly')await read(lane,'nextTarget',amount(settings.nextReserve));
  else{
   await read(lane,'minimumUnit',amount(settings.basket.minimumUnit));
   for(const [i,w] of settings.basket.weights.entries())await read(lane,'weights',w,i);
   let extra=false;try{await contracts.short.weights(settings.basket.weights.length,at);extra=true;}catch(e){if(e.code!=='CALL_EXCEPTION')throw e;}check(!extra,'Extra weight');
  }
  check(await contracts[lane].solvent(at),'Insolvent '+lane);
 }
 for(const r of ['splitter','fundingRouter'])check(await contracts[r].solvent(at),'Insolvent '+r);
 const launch=await contracts.factory.getLaunchedToken(address('token'),at);
 check(launch.exists&&same(launch.token,address('token'))&&same(launch.curve,address('curve'))&&same(launch.pairToken,address('quote'))&&same(launch.creatorFeeRecipient,address('collector'))&&!launch.buybackEnabled&&launch.creatorTaxBps===BigInt(p.template.creatorTaxBps),'Factory launch mismatch');
 check(same((await provider.getBlock(block.number))?.hash,block.hash),'Observation branch changed');
 return {schema:p.schema,blockNumber:block.number,blockHash:block.hash,authorizationToSend:false};
}

export function drawContracts(provider,p){
 const config=validateDrawPolicy(p),artifacts=build().artifacts;
 const own={collector:'PonsFeeCollector',splitter:'FeeSplitter',recognition:'PurchaseRecognition',fundingRouter:'DrawFundingRouter',...(config.short.enabled?{short:'ShortProgram',shortAdapter:'ShortDrandAdapter'}:{}),...(config.monthly.enabled?{monthly:'MonthlyProgram',monthlyAdapter:'ShortDrandAdapter'}:{})};
 return Object.fromEntries(Object.entries(p.contracts).filter(([role])=>own[role]||ABI[role]).map(([role,pin])=>[role,new Contract(pin.address,own[role]?artifacts[own[role]].abi:ABI[role],provider)]));
}
