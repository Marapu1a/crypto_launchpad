const {ethers}=require('ethers'),hre=require('hardhat');
const {normalRules,participants}=require('./short-outcome.cjs');
const dataset=require('../../scripts/short-dataset.cjs');
const {drawIdFor}=require('../../scripts/draw-id.cjs');
const {monthlyRoot}=require('./dual-controller.cjs');
const rpc=(method,params=[])=>hre.network.provider.send(method,params);
const sent=async tx=>(await tx).wait();
async function advance(seconds=6*3600+1){await rpc('evm_increaseTime',[seconds]);await rpc('evm_mine');}

async function fixture(compiled,{quoteName='MockToken',rules=normalRules,monthlyRules=rules,weights=[7,5,3],drandTiming=null,cutoffDelayBlocks=1,maxBudget=10000}={}){
  await rpc('hardhat_reset');
  const anchor=await rpc('eth_getBlockByNumber',['latest',false]);
  const provider=new ethers.BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});
  const admin=await provider.getSigner(),executor=await provider.getSigner(1),owner=await admin.getAddress();
  async function deploy(name,args=[]){
    const a=compiled[name],c=await new ethers.ContractFactory(a.abi,a.evm.bytecode.object,admin).deploy(...args);
    await c.waitForDeployment();return c;
  }
  const token=await deploy('MockToken'),quote=await deploy(quoteName),registry=await deploy('ParticipantRegistry');
  const nonce=await provider.getTransactionCount(owner);
  const random=drandTiming?await deploy('DrandRandomAdapter',[ethers.getCreateAddress({from:owner,nonce:nonce+1}),ethers.getCreateAddress({from:owner,nonce:nonce+2}),drandTiming]):await deploy('LocalRandomFixture');
  const predicted=ethers.getCreateAddress({from:owner,nonce:await provider.getTransactionCount(owner)+2});
  const setup={vault:predicted,registry:registry.target,instance:ethers.id('local short'),governor:owner,
    publisher:owner,provider:random.target,notice:3600,cutoffDelayBlocks,maxGasPrice:10n**12n,nativeFloor:10};
  const short=await deploy('LocalShortController',[{...setup,maxBudget},rules,weights]);
  const monthly=await deploy('LocalMonthlyController',[{...setup,instance:ethers.id('local monthly'),interval:30*86400},monthlyRules]);
  const vault=await deploy('DualControllerPromoVault',[token.target,quote.target,short.target,monthly.target,100]);
  require('node:assert/strict').equal(vault.target,predicted);
  await sent(quote.mint(owner,10000));await sent(quote.approve(vault.target,10000));
  await sent(vault.fundUSDG(1000,1));await sent(vault.fundUSDG(1000,2));await sent(vault.fundUSDG(100,3));
  const ps=participants(24,5); // Synthetic attempts, not a claim about BUY provenance.
  async function prepare(label,kind='SHORT',data=ps){
    const b=await provider.getBlock('latest'),drawId=drawIdFor(kind,ethers.id(label)),proposalId=ethers.id(label+' proposal');
    const attempts=data.reduce((sum,p)=>sum+p.lastAttempt-p.firstAttempt+1n,0n);
    if(kind==='SHORT'){
      await sent(short.begin(proposalId,{drawId,campaignId:1,rulesEpoch:1,cutoffBlockNumber:b.number,cutoffBlockHash:b.hash,
        snapshotHash:ethers.id(label+' synthetic snapshot'),expectedRoot:dataset.rootFor(data),expectedCount:data.length,expectedAttempts:attempts,budget:101}));
      for(let i=0;i<data.length;i+=8)await sent(short.publish(proposalId,data.slice(i,i+8)));
    }else{
      await sent(monthly.beginMonth({drawId,campaign:1,rulesEpoch:1,cutoff:b.number,cutoffHash:b.hash,
        snapshotHash:ethers.id(label+' synthetic snapshot'),root:monthlyRoot(data),count:data.length,attempts}));
      for(let i=0;i<data.length;i+=8)await sent(monthly.publishMonth(drawId,data.slice(i,i+8)));
    }
    return {drawId,proposalId,data};
  }
  async function fundExecution(){for(const c of [short,monthly])await sent(admin.sendTransaction({to:c.target,value:1000}));}
  return {provider,admin,executor,token,quote,registry,random,short,monthly,vault,prepare,fundExecution,ps,anchor,deploy};
}
module.exports={fixture,rpc,sent,advance};
