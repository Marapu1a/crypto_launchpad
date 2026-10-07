// Shared local-only setup for integration tests and repeatable gas measurements.
const {ethers}=require('ethers');
const hre=require('hardhat');
const outcome=require('../../scripts/short-outcome.cjs');
const {domainFor,snapshotFor}=require('../../scripts/attempt-lifecycle.cjs');
const rpc=(method,params=[])=>hre.network.provider.send(method,params);
const sent=async p=>(await p).wait();
const normalRules={version:1,pNumerator:2,pDenominator:5,hNumerator:1,hDenominator:1};
const nearCertainRules={version:1,pNumerator:4294967294,pDenominator:4294967295,hNumerator:1,hDenominator:4294967295};
function participants(n,entries){return Array.from({length:n},(_,i)=>({wallet:ethers.getAddress(ethers.zeroPadValue(ethers.toBeHex(i+100),20)),firstAttempt:1n,lastAttempt:BigInt(entries??(i%20+1))}));}
async function fixture(compiled){
  await rpc('hardhat_reset');
  const anchor=await rpc('eth_getBlockByNumber',['latest',false]);
  const provider=new ethers.BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1}),admin=await provider.getSigner();
  async function deploy(name,args=[]){const a=compiled[name],c=await new ethers.ContractFactory(a.abi,a.evm.bytecode.object,admin).deploy(...args);await c.waitForDeployment();return c;}
  const token=await deploy('MockToken'),quote=await deploy('MockToken'),registry=await deploy('ParticipantRegistry');
  const predicted=ethers.getCreateAddress({from:await admin.getAddress(),nonce:await provider.getTransactionCount(await admin.getAddress())+1});
  const source=await deploy('ShortOutcomeFixture',[predicted,registry.target,ethers.id('local outcome instance')]);
  const vault=await deploy('PromoVault',[token.target,quote.target,source.target,100]);
  await sent(registry.register());
  await sent(quote.mint(await admin.getAddress(),10n**24n));await sent(quote.approve(vault.target,ethers.MaxUint256));
  // Market fields are inherited only to construct a valid replay domain. Synthetic
  // nonempty participants below are NOT claims about actual buys or registration.
  const manifest=structuredClone(require('../../research/direct-buy/evidence.json').manifest);
  manifest.registry=registry.target;manifest.anchor={number:anchor.number,hash:anchor.hash};
  manifest.codeHashes.registry=ethers.keccak256(await provider.getCode(registry.target));
  const config={schema:'attempt-lifecycle-v1',instanceId:await source.instanceId(),source:source.target,sourceCodeHash:ethers.keccak256(await provider.getCode(source.target))};
  let sequence=0;
  async function freeze(ps,rules=normalRules,weights=[7,5,4,3,2,2,1,1,1,1],budget=1000000n){
    await sent(vault.fundUSDG(budget,1));
    const basket={weights,minimumUnit:1,remainingRulesHash:outcome.rulesHash(rules)};
    const b=await rpc('eth_getBlockByNumber',['latest',false]);
    const request={drawId:ethers.id('outcome '+(++sequence)),campaignId:1,cutoffBlockNumber:Number(BigInt(b.number)),cutoffBlockHash:b.hash,
      expectedRulesHash:await source.basketRulesHash(basket),budget};
    const snapshot=snapshotFor(domainFor(manifest,config),request.drawId,'SHORT',
      {blockNumber:request.cutoffBlockNumber,blockHash:request.cutoffBlockHash},request.expectedRulesHash,
      ps.map(p=>({wallet:p.wallet.toLowerCase(),count:String(BigInt(p.lastAttempt)-BigInt(p.firstAttempt)+1n),firstAttempt:String(p.firstAttempt),lastAttempt:String(p.lastAttempt)})));
    const commitments=outcome.commitmentsForSnapshot(snapshot);
    request.attemptSnapshotHash=commitments.attemptSnapshotHash;request.evmParticipantsHash=commitments.evmParticipantsHash;
    const receipt=await sent(source.freeze(request,basket,rules));
    const context=await source.shortCommitmentHash(request.drawId),prizes=Array.from((await source.shortBasket(request.drawId)).prizes);
    return {request,basket,rules,snapshot,context,prizes,receipt};
  }
  return {provider,admin,quote,registry,source,vault,freeze,anchor,manifest,config};
}
module.exports={fixture,participants,normalRules,nearCertainRules,rpc,sent};
