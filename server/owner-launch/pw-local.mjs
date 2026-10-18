import {ContractFactory,ZeroAddress,keccak256} from 'ethers';
import {compileHolderFunding,compileHolderPayout} from '../../src/holders/build.mjs';
import {compileNativePrograms} from '../../src/worker/native-build.mjs';
import {address,check,identity,uint} from '../../src/holders/values.mjs';
import {holderFundingInstance} from '../../src/holders/funding-receipt.mjs';
import {PW_FEE_POLICY} from '../../src/launch/fee-policy.mjs';

// Local deployment adapter, deliberately separate from the public owner launcher.
// launchFixture models Pons; this does not certify the real Pons factory/CREATE2 path.
export async function deployPwLocalGraph({provider,signer,preparation,parameters,scope,externals,launchFixture,localInstanceId}){
 check(preparation.schema==='pattern-watcher-preparation-v1'&&preparation.executionEnabled===false&&preparation.feePolicyKind===PW_FEE_POLICY,'PW preparation required');
 check(parameters.mode==='local-rehearsal'&&parameters.executionEnabled===false,'Local PW rehearsal only');
 check(preparation.chainId===4663&&scope.chainId===4663&&scope.asset===ZeroAddress&&preparation.quoteAsset==='ETH'&&preparation.creatorTaxBps===300,'PW asset/tax mismatch');
 check(identity(preparation.feeSplitBps)===identity({holders:6000,draw:2000,operations:2000})&&!preparation.buyback.enabled&&!preparation.burn.enabled,'PW fee graph mismatch');
 check(preparation.draw.intervalSeconds===2592000&&preparation.holders.intervalSeconds===2592000&&identity(preparation.draw.prizeWeights)===identity([1])&&preparation.draw.mechanism==='igw-short-outcome-v1','PW monthly mechanics mismatch');
 for(const field of ['holderMinimum','drawMinimum','drawUnit','ticketRaw'])check(uint(parameters[field])>0n,'Explicit local amount required');
 const meta=await provider.send('hardhat_metadata',[]);
 check(meta.instanceId===localInstanceId&&meta.chainId===4663&&!meta.forkedNetwork,'Fresh isolated Hardhat required');
 check(Number((await provider.getNetwork()).chainId)===4663,'Wrong local chain');
 const funding=compileHolderFunding(),payout=compileHolderPayout({managed:true}),native=compileNativePrograms(),instance=holderFundingInstance(scope);
 const deploy=async(a,args)=>{const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const vault=await deploy(payout.artifact,[instance,address(parameters.owner),address(parameters.publisher),parameters.holderMinimum]);
 const draw=await deploy(native.artifacts.ShortProgram,[{asset:ZeroAddress,operator:address(parameters.operator),instance,interval:preparation.draw.intervalSeconds,minimumFund:parameters.drawMinimum,minimumUnit:parameters.drawUnit},preparation.draw.prizeWeights,parameters.timing]);
 const split=await deploy(funding.artifacts.NativeHolderFeeSplitter,[instance,vault.target,draw.target,address(parameters.project),[6000,2000,2000]]);
 const collector=await deploy(funding.artifacts.NativeHolderCollector,[externals.escrow,split.target,externals.factory]);
 const launched=await launchFixture(collector.target);
 check(address(launched.token.target)===scope.token,'Predicted token mismatch');
 await (await collector.bind(launched.token.target)).wait();
 await (await vault.bindSource(split.target)).wait();await (await split.bindSource(collector.target)).wait();
 const contracts={vault,draw,splitter:split,collector,token:launched.token,curve:launched.curve};
 const pins={};for(const [name,c] of Object.entries(contracts))pins[name]={address:c.target,codeHash:keccak256(await provider.getCode(c.target))};
 return {...contracts,split,launchAt:launched.launchAt,manifest:{schema:'pw-local-graph-v1',executionEnabled:false,scope,preparationHash:identity(preparation),parameters,localInstanceId,pins,
  builds:{funding:funding.manifest.buildHash,payout:payout.manifest.buildHash,draw:native.manifest.buildHash},limits:['Local modeled Pons factory, not public launch admission']}};
}
