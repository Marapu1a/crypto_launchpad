const {ethers}=require('ethers'),hre=require('hardhat');
const {normalRules}=require('./short-outcome.cjs');
const rpc=(m,p=[])=>hre.network.provider.send(m,p),sent=async p=>(await p).wait();
const advance=async(seconds=30*86400+1)=>{await rpc('evm_increaseTime',[seconds]);await rpc('evm_mine');};
async function fixture(compiled,{real=false,interval=30*86400,notice=3600,monthlyRules=normalRules,initialize}={}){
  await rpc('hardhat_reset');if(initialize)await initialize();const provider=new ethers.BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});
  const admin=await provider.getSigner(),other=await provider.getSigner(1);
  const deploy=async(name,args=[])=>{const a=compiled[name],c=await new ethers.ContractFactory(a.abi,a.evm.bytecode.object,admin).deploy(...args);await c.waitForDeployment();return c;};
  const token=await deploy('MockToken'),quote=await deploy('MockToken'),registry=await deploy('ParticipantRegistry');
  const wrong=await deploy('ScopedCallerFixture',[ethers.ZeroAddress]);
  const predicted=ethers.getCreateAddress({from:await admin.getAddress(),nonce:await provider.getTransactionCount(await admin.getAddress())+2});
  const short=await deploy(real?'ShortSettlementFixture':'ScopedCallerFixture',real?[predicted,registry.target,ethers.id('dual short'),3600,normalRules,[7,5,3]]:[predicted]);
  const monthly=await deploy(real?'MonthlySettlementFixture':'ScopedCallerFixture',real?[predicted,registry.target,ethers.id('dual monthly'),interval,notice,monthlyRules]:[predicted]);
  // Failed constructor simulations send no transactions, preserving the predicted address.
  for(const [s,m] of [[short.target,short.target],[short.target,await admin.getAddress()],[wrong.target,monthly.target],[short.target,wrong.target]])
    await require('node:assert/strict').rejects(()=>deploy('DualControllerPromoVault',[token.target,quote.target,s,m,100]));
  const vault=await deploy('DualControllerPromoVault',[token.target,quote.target,short.target,monthly.target,100]);
  require('node:assert/strict').equal(vault.target,predicted);
  await sent(quote.mint(await admin.getAddress(),100000));await sent(quote.approve(vault.target,ethers.MaxUint256));
  await sent(vault.fundUSDG(1000,1));await sent(vault.fundUSDG(1000,2));await sent(vault.fundUSDG(100,3));
  const attack=(actor,method,args,failAfter=false)=>sent(actor.attack(vault.interface.encodeFunctionData(method,args),failAfter));
  return {provider,admin,other,token,quote,registry,wrong,short,monthly,vault,deploy,attack};
}
const coder=ethers.AbiCoder.defaultAbiCoder();
function monthlyRoot(ps){return ps.reduce((root,p)=>ethers.keccak256(coder.encode(['bytes32','address','uint128','uint128'],[root,p.wallet,p.firstAttempt,p.lastAttempt])),ethers.id('MONTHLY_DATASET_V1'));}
module.exports={fixture,rpc,sent,advance,monthlyRoot};
