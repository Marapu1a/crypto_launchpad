// Read-only reserve observation at the same block as the BUY/reward snapshot.
const {Interface,keccak256}=require('ethers');
const {hash}=require('./direct-buy.cjs');
const abi=new Interface([
 ...['quoteToken','shortController','monthlyController'].map(n=>`function ${n}() view returns(address)`),
 ...['freeShort','freeCurrent','freeNext','nextStartTarget','SHORT_INTERVAL','lastShortTerminalAt','monthlyInterval','lastMonthAt','minimumMonthlyBudget','currentShortEpoch','drainingShortEpoch'].map(n=>`function ${n}() view returns(uint256)`),
 'function decimals() view returns(uint8)',
 'function reserved(address) view returns(uint256)','function claimable(address) view returns(uint256)',
 'function balanceOf(address) view returns(uint256)',
 'function shortEpochPolicy(uint64) view returns(tuple(tuple(uint32 version,uint32 pNumerator,uint32 pDenominator,uint32 hNumerator,uint32 hDenominator) outcome,uint256[] weights,uint256 minimumUnit,bytes32 hash,uint256 firstBlock))'
]);
async function observePublic({config,manifest,rpc,blockTag,blockHash}){
 const manifestHash=hash(manifest);if(manifest.schema==='buy-policy-history-v1')manifest=require('./direct-buy.cjs').buyPolicyHistory(manifest).at(Number(BigInt(blockTag)));
 const l=config.lifecycle;
 if(!l?.monthlySource||!l.vault)throw Error('Public observation requires dual controllers');
 for(const [address,digest] of [[manifest.quote,manifest.codeHashes.quote],[l.vault,l.vaultCodeHash],[l.source,l.sourceCodeHash],[l.monthlySource,l.monthlySourceCodeHash]]){
  const code=await rpc('eth_getCode',[address,blockTag]);if(code==='0x'||keccak256(code)!==digest.toLowerCase())throw Error('Public runtime mismatch');
 }
 const read=async(to,name,args=[])=>abi.decodeFunctionResult(name,await rpc('eth_call',[{to,data:abi.encodeFunctionData(name,args)},blockTag]))[0];
 const [quote,short,monthly,decimals]=await Promise.all([read(l.vault,'quoteToken'),read(l.vault,'shortController'),read(l.vault,'monthlyController'),read(manifest.quote,'decimals')]);
 if(quote.toLowerCase()!==manifest.quote.toLowerCase()||short.toLowerCase()!==l.source.toLowerCase()||monthly.toLowerCase()!==l.monthlySource.toLowerCase()||Number(decimals)!==manifest.quoteDecimals)throw Error('Public binding mismatch');
 const reserves={};for(const name of ['freeShort','freeCurrent','freeNext','nextStartTarget'])reserves[name]=String(await read(l.vault,name));
 reserves.reserved=String(await read(l.vault,'reserved',[quote]));reserves.claimable=String(await read(l.vault,'claimable',[quote]));
 reserves.balance=String(await read(quote,'balanceOf',[l.vault]));
 if(['freeShort','freeCurrent','freeNext','reserved','claimable'].reduce((n,k)=>n+BigInt(reserves[k]),0n)>BigInt(reserves.balance))throw Error('Reserve deficit');
 const epoch=await read(short,'currentShortEpoch'),draining=await read(short,'drainingShortEpoch');
 const policy=await read(short,'shortEpochPolicy',[draining||epoch]);
 const minimumShort=policy.weights.reduce((n,w)=>n+w,0n)*policy.minimumUnit;
 const timing={SHORT:{earliestAt:String(await read(short,'lastShortTerminalAt')+await read(short,'SHORT_INTERVAL')),minimumRaw:String(minimumShort)},MONTHLY:{earliestAt:String(await read(monthly,'lastMonthAt')+await read(monthly,'monthlyInterval')),minimumRaw:String(await read(monthly,'minimumMonthlyBudget'))}};
 return {schema:'promo-public-observation-v1',blockTag,blockHash,manifestHash,asset:{address:quote.toLowerCase(),decimals:Number(decimals),symbol:'USDG',codeHash:manifest.codeHashes.quote},vault:l.vault.toLowerCase(),reserves,timing};
}
module.exports={observePublic,abi};
