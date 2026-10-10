import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {BrowserProvider,ContractFactory,ZeroAddress,id} from 'ethers';
import {compileProduction} from '../../src/worker/production-build.mjs';
import {qianqiPreset} from '../../src/draws/config.mjs';
import {upgradeProgramDraft} from '../../src/draws/program-config.mjs';
import {createFundingPreview,previewFundingReceipt} from '../../src/draws/funding-preview.mjs';
process.env.HARDHAT_CONFIG=resolve('tests/contracts/production-hardhat.config.cjs');
const {default:hre}=await import('hardhat');const provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
const root='.local/test-results/draw-router-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});
const report={scenarios:[],limits:['Isolated chain4663; no public sends','Funding integration only; no dual worker or launch UI','Recipient identity/version pinning remains a future deployment-policy responsibility']};
const tx=async p=>(await p).wait();const scenario=async(name,f)=>{await f();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);};
try{
 const b=compileProduction({'tests/contracts/DrawRouterFixtures.sol':{content:readFileSync('tests/contracts/DrawRouterFixtures.sol','utf8')}});report.sourceHashes=b.manifest.sourceHashes;
 const signer=await provider.getSigner(0),other=await provider.getSigner(1),team=await provider.getSigner(2),ops=await provider.getSigner(3),owner=await signer.getAddress();
 const deploy=async(file,name,args=[])=>{const a=b.contracts[file][name];assert.ok(a.evm.deployedBytecode.object.length/2<=24576);assert.ok(a.evm.bytecode.object.length/2<=49152);const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const prod=(name,args)=>deploy('contracts/production/'+name+'.sol',name,args);
 const quote=await deploy('tests/contracts/Fixtures.sol','TestUSDG');
 const fund=async(c,n)=>{await tx(quote.mint(owner,n));await tx(quote.approve(c.target,n));await tx(c.fund(n));};
 const timing={lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30};let first;
 await scenario('Three modes: actual FeeSplitter to router to independent Short/Monthly funds',async()=>{
  for(const [index,bps] of [10000,0,3700].entries()){
   const s=bps?await prod('ShortProgram',[{asset:quote.target,operator:owner,instance:id('s'+index),interval:604800,minimumFund:1,minimumUnit:1},[1],timing]):null;
   const m=bps<10000?await prod('MonthlyProgram',[{asset:quote.target,operator:owner,instance:id('m'+index),minimumFund:1,nextTarget:9},timing]):null;
   const router=await prod('DrawFundingRouter',[quote.target,s?.target??ZeroAddress,m?.target??ZeroAddress,bps]);
   const splitter=await prod('FeeSplitter',[quote.target,router.target,await team.getAddress(),await ops.getAddress(),[8000,1500,500]]);
   const c=qianqiPreset();c.short.enabled=!!s;c.monthly.enabled=!!m;c.monthly.nextReserve='0.000009';const config=upgradeProgramDraft(c,bps);let expected=createFundingPreview(config),prior=0n;
   for(const n of [1n,2n,7n,19n,1001n]){
    await fund(splitter,n);const credit=await splitter.credit(0);if(credit)await tx(splitter.connect(other).deliver(0));
    const total=await router.totalReceived();expected=previewFundingReceipt(expected,total-prior).state;prior=total;
    for(const lane of [1,0])if(await router.credit(lane))await tx(router.connect(other).deliver(lane));
    assert.equal(s?await s.freeFund():0n,expected.short);assert.equal(m?await m.freeFund():0n,expected.current);assert.equal(m?await m.freeNext():0n,expected.next);
    assert.equal(await quote.balanceOf(router.target),0n);assert.equal(await router.solvent(),true);
   }
   for(const lane of [1,2])if(await splitter.credit(lane))await tx(splitter.deliver(lane));
   const total=await splitter.totalReceived();assert.equal(await router.totalReceived(),total*8000n/10000n);
   assert.equal(await splitter.solvent(),true);await assert.rejects(router.deliver(0));await assert.rejects(router.deliver(1));
   if(!first)first={s,amount:await s.freeFund()};else assert.equal(await first.s.freeFund(),first.amount);
  }
 });
 await scenario('Invalid modes, same destination, wrong asset and unknown lane are rejected',async()=>{
  const a=await deploy('tests/contracts/DrawRouterFixtures.sol','ToggleFund',[quote.target]);
  const foreign=await deploy('tests/contracts/Fixtures.sol','TestUSDG');const f=await deploy('tests/contracts/DrawRouterFixtures.sol','ToggleFund',[foreign.target]);
  for(const args of [[ZeroAddress,ZeroAddress,5000],[a.target,ZeroAddress,5000],[a.target,a.target,5000],[a.target,f.target,5000],[a.target,ZeroAddress,10001]])await assert.rejects(prod('DrawFundingRouter',[quote.target,...args]));
  const r=await prod('DrawFundingRouter',[quote.target,a.target,ZeroAddress,10000]);await assert.rejects(r.deliver(2));await assert.rejects(r.fund(0));
 });
 await scenario('Failed or dishonest recipient retains credit; other lane continues; retry cannot double-deliver',async()=>{
  const a=await deploy('tests/contracts/DrawRouterFixtures.sol','ToggleFund',[quote.target]),b=await deploy('tests/contracts/DrawRouterFixtures.sol','ToggleFund',[quote.target]);
  const r=await prod('DrawFundingRouter',[quote.target,a.target,b.target,5000]);await fund(r,101n);await tx(a.setMode(1));await assert.rejects(r.deliver(0));assert.equal(await r.credit(0),51n);
  await tx(r.deliver(1));assert.equal(await quote.balanceOf(b.target),50n);await tx(a.setMode(2));await assert.rejects(r.deliver(0));assert.equal(await r.credit(0),51n);assert.equal(await quote.allowance(r.target,a.target),0n);
  await tx(a.setMode(0));await tx(r.deliver(0));await assert.rejects(r.deliver(0));assert.equal(await quote.balanceOf(a.target),51n);assert.equal(await quote.allowance(r.target,a.target),0n);
 });
 await scenario('Ceiling allocation uses full-precision math at uint256 maximum',async()=>{
  const a=await deploy('tests/contracts/DrawRouterFixtures.sol','ToggleFund',[quote.target]),b=await deploy('tests/contracts/DrawRouterFixtures.sol','ToggleFund',[quote.target]);
  // Fresh quote avoids overflowing totalSupply due to earlier fixtures.
  const q=await deploy('tests/contracts/Fixtures.sol','TestUSDG');const x=await deploy('tests/contracts/DrawRouterFixtures.sol','ToggleFund',[q.target]),y=await deploy('tests/contracts/DrawRouterFixtures.sol','ToggleFund',[q.target]);
  const r=await prod('DrawFundingRouter',[q.target,x.target,y.target,9999]),max=(1n<<256n)-1n;
  await tx(q.mint(owner,max));await tx(q.approve(r.target,max));await tx(r.fund(max));assert.equal(await r.credit(0),(max*9999n+9999n)/10000n);assert.equal(await r.credit(0)+await r.credit(1),max);assert.equal(await r.solvent(),true);
 });
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.shortMessage||e.message;console.error(e);process.exitCode=1;}
finally{writeFileSync(root+'/report.json',JSON.stringify(report,null,2));console.log(root+'/report.json');provider.destroy();}
