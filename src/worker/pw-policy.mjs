import {Contract,ZeroAddress,keccak256,parseEther} from 'ethers';
import {compilePwLaunch} from '../launch/pw-build.mjs';
import {compileNativePrograms} from './native-build.mjs';
import {matchesArtifact} from './draw-build.mjs';
import {validatePolicy} from './production-policy.mjs';
import {ABI} from './production-template.mjs';
import {check,same} from '../../server/owner-launch/store.mjs';
import {validatePwProductionProfile,verifyPwProductionEnvironment} from '../../server/owner-launch/pw-profile.mjs';
import {cachedVerification,rememberVerification} from './verification-cache.mjs';
import {digest} from '../tickets/digest.mjs';
let built,native;
const own={short:'PwNativeShortProgram',vault:'ManagedNativeHolderPayoutVault',splitter:'NativeHolderFeeSplitter',collector:'NativeHolderCollector'};
const build=()=>built??=compilePwLaunch();
const adapter=()=> (native??=compileNativePrograms()).artifacts.ShortDrandAdapter;
export function validatePwPolicy(p){
 check(p?.schema==='pw-service-policy-v1'&&['production','rehearsal'].includes(p.mode),'Explicit PW service policy required');
 validatePolicy({...p,schema:'short-production-policy-v1'});
 check(p.buildHash===build().manifest.buildHash,'PW service build changed');
 const t=p.template;
 check(t?.instanceId&&/^0x[0-9a-f]{64}$/i.test(t.instanceId)&&t.config?.asset==='ETH','PW native instance required');
 check(t.config.ticketPurchase==='0.001'&&t.config.short?.enabled===true&&t.config.monthly?.enabled===false,'PW ticket/draw mode changed');
 check(t.config.short.intervalSeconds===2592000&&t.config.short.minimumFund==='0.005'&&digest(t.config.short.basket)===digest({weights:[1],minimumUnit:'0.005'}),'PW monthly rules changed');
 check(Number.isSafeInteger(p.launchAt)&&p.launchAt>0&&p.project&&p.owner,'PW launch/roles required');
 const required=['token','curve','factory','escrow','short','shortAdapter','vault','splitter','collector'];
 check(required.every(k=>p.contracts[k]),'Incomplete PW graph');
 if(p.mode==='production'){
  validatePwProductionProfile(p.environment,p.buildHash);
  check(p.environment.id===p.projectId&&same(p.environment.owner,p.owner)&&same(p.environment.executor,p.executor)&&same(p.environment.publisher,p.publisher)&&same(p.environment.project,p.project),'PW environment roles changed');
  check(digest(p.environment.timing)===digest(p.timing),'PW timing differs from launch');
  for(const [k,v] of Object.entries(p.environment.externals))check(digest(v)===digest(p.contracts[k]),'PW external differs from launch');
 }else check(typeof p.instanceId==='string'&&/^0x[0-9a-f]{64}$/i.test(p.instanceId),'PW rehearsal instance required');
 return p;
}
export function pwContracts(provider,p){
 const result={};
 for(const [role,name] of Object.entries(own))result[role]=new Contract(p.contracts[role].address,build().artifacts[name].abi,provider);
 result.shortAdapter=new Contract(p.contracts.shortAdapter.address,adapter().abi,provider);
 for(const role of ['token','curve','factory','escrow']){
  const abi=role==='token'?['function balanceOf(address) view returns(uint256)']:role==='escrow'?['function balanceOf(address) view returns(uint256)']:ABI[role];
  result[role]=new Contract(p.contracts[role].address,abi,provider);
 }
 result.quote={target:ZeroAddress,balanceOf:(wallet,o={})=>provider.getBalance(wallet,o.blockTag)};
 return result;
}
export async function verifyPwPolicy(provider,p){
 validatePwPolicy(p);
 check((await provider.getNetwork()).chainId===4663n,'Wrong PW chain');
 if(p.mode==='production')await verifyPwProductionEnvironment(provider,p.environment,p.buildHash);
 else{const m=await provider.send('hardhat_metadata',[]);check(m.instanceId===p.instanceId&&Number(m.chainId)===4663,'Wrong PW rehearsal instance');}
 const b=await provider.getBlock('latest');check(b&&b.number>=p.anchor.number&&same((await provider.getBlock(p.anchor.number))?.hash,p.anchor.hash),'PW anchor changed');
 const key=digest(p),cached=cachedVerification(provider,key,b);if(cached)return cached;
 for(const [role,pin] of Object.entries(p.contracts)){
  const code=await provider.getCode(pin.address,b.number);check(code!=='0x'&&same(keccak256(code),pin.codeHash),'PW runtime changed: '+role);
  if(own[role]||role==='shortAdapter')check(matchesArtifact(code,role==='shortAdapter'?adapter():build().artifacts[own[role]]),'Untrusted PW artifact: '+role);
 }
 const c=pwContracts(provider,p),at={blockTag:b.number},a=role=>p.contracts[role].address;
 const read=async(role,getter,value,...args)=>check(same(await c[role][getter](...args,at),value),'PW binding changed: '+role+'.'+getter);
 for(const [r,g,v] of [
  ['short','launchBound',true],['short','launchAt',p.launchAt],['short','operator',p.executor],['short','instanceId',p.template.instanceId],['short','randomness',a('shortAdapter')],['short','quote',ZeroAddress],['short','interval',2592000],['short','minimumFund',parseEther('0.005')],['short','minimumUnit',parseEther('0.005')],
  ['short','factory',a('factory')],['short','expectedToken',a('token')],['short','expectedCollector',a('collector')],
  ['shortAdapter','shortConsumer',a('short')],['vault','instance',p.template.instanceId],['vault','source',a('splitter')],['vault','initialOwner',p.owner],['vault','initialPublisher',p.publisher],['vault','minimumPayment',parseEther('0.0005')],
  ['splitter','instance',p.template.instanceId],['splitter','source',a('collector')],['splitter','holderFund',a('vault')],['splitter','drawFund',a('short')],['splitter','project',p.project],
  ['collector','token',a('token')],['collector','curve',a('curve')],['collector','factory',a('factory')],['collector','escrow',a('escrow')],['collector','destination',a('splitter')],['collector','quote',ZeroAddress],
  ['curve','token',a('token')],['curve','factory',a('factory')],['curve','pairToken',ZeroAddress],['curve','deployer',a('collector')],['curve','feeEscrow',a('escrow')]
 ])await read(r,g,v);
 for(const [i,bps] of [6000,2000,2000].entries())await read('splitter','bps',bps,i);
 await read('short','weights',1,0);let extra=false;try{await c.short.weights(1,at);extra=true;}catch(e){if(e.code!=='CALL_EXCEPTION')throw e;}check(!extra,'Extra PW prize weight');
 for(const [getter,key] of Object.entries({leadSeconds:'lead',maxClockLag:'clockLag',maxClockAhead:'clockAhead',maxFinalizedLag:'finalizedLag',maxBeaconLag:'beaconLag'}))await read('shortAdapter',getter,p.timing[key]);
 for(const role of ['vault','splitter','short'])check(await c[role].solvent(at),'PW insolvency: '+role);
 const launch=await c.factory.getLaunchedToken(a('token'),at);
 check(launch.exists&&same(launch.token,a('token'))&&same(launch.curve,a('curve'))&&same(launch.creatorFeeRecipient,a('collector'))&&same(launch.pairToken,ZeroAddress)&&launch.creatorTaxBps===300n&&!launch.buybackEnabled,'PW factory record changed');
 check(same((await provider.getBlock(b.number))?.hash,b.hash),'PW observation reorg');
 const result={schema:p.schema,blockNumber:b.number,blockHash:b.hash,authorizationToSend:false};rememberVerification(provider,key,result);return result;
}
