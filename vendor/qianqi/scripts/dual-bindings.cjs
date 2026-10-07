const {Contract,keccak256}=require('ethers'),{hash}=require('./direct-buy.cjs');
async function verifyDualBindings(provider,domain){
  if(!['attempt-lifecycle-v3','attempt-lifecycle-v4'].includes(domain.schema))return;
  const check=(ok,msg)=>{if(!ok)throw Error(msg);},same=(a,b)=>a.toLowerCase()===b.toLowerCase();
  check(domain.drawIdScheme==='kind-bit-v1','Dual draw ID scheme mismatch');
  check((await provider.getNetwork()).chainId===BigInt(domain.chainId),'Dual chain mismatch');
  for(const [address,digest] of [[domain.source,domain.sourceCodeHash],[domain.monthlySource,domain.monthlySourceCodeHash],[domain.vault,domain.vaultCodeHash]])
    check(keccak256(await provider.getCode(address))===digest,'Dual runtime mismatch');
  const s=new Contract(domain.source,['function datasetVault() view returns(address)','function datasetRegistry() view returns(address)','function datasetInstance() view returns(bytes32)'],provider);
  const m=new Contract(domain.monthlySource,['function monthlyVault() view returns(address)','function monthlyRegistry() view returns(address)',
    'function monthlyInstance() view returns(bytes32)','function monthlyRulesHash() view returns(bytes32)','function monthlyInterval() view returns(uint256)','function monthlyStartedAt() view returns(uint256)',
    'function monthlyRulesNotice() view returns(uint256)',
    'function monthlyEpochPolicy(uint64) view returns(tuple(tuple(uint32 version,uint32 pNumerator,uint32 pDenominator,uint32 hNumerator,uint32 hDenominator) outcome,bytes32 hash,uint256 firstBlock))'],provider);
  const v=new Contract(domain.vault,['function shortController() view returns(address)','function monthlyController() view returns(address)',
    'function quoteToken() view returns(address)','function projectToken() view returns(address)'],provider);
  check(same(await s.datasetVault(),domain.vault)&&same(await m.monthlyVault(),domain.vault)
    &&same(await v.shortController(),domain.source)&&same(await v.monthlyController(),domain.monthlySource),'Dual reverse binding mismatch');
  check(same(await s.datasetRegistry(),domain.registry)&&same(await m.monthlyRegistry(),domain.registry)
    &&same(await s.datasetInstance(),domain.instanceId)&&same(await m.monthlyInstance(),domain.monthlyInstanceId),'Dual instance mismatch');
  check(same(await v.quoteToken(),domain.vaultQuote)&&same(await v.projectToken(),domain.vaultProjectToken),'Dual asset mismatch');
  check(hash({rulesHash:(await m.monthlyRulesHash()).toLowerCase(),interval:String(await m.monthlyInterval()),startedAt:String(await m.monthlyStartedAt())})===domain.monthlyPolicyHash,'Monthly policy mismatch');
  if(domain.schema==='attempt-lifecycle-v4'){
    const genesis=await m.monthlyEpochPolicy(1);
    check(hash({rulesHash:genesis.hash.toLowerCase(),noticeSeconds:String(await m.monthlyRulesNotice()),startedAt:String(await m.monthlyStartedAt()),
      firstBlock:String(genesis.firstBlock),interval:String(await m.monthlyInterval())})===domain.monthlyRulesGenesisHash,'Monthly epoch genesis mismatch');
  }
}
module.exports={verifyDualBindings};
