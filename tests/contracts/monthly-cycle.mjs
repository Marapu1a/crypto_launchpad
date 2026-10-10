import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {BrowserProvider,Contract,ContractFactory,id,ZeroAddress} from 'ethers';
import {compileProduction} from '../../src/worker/production-build.mjs';
import {computeMonthly} from '../../src/draws/monthly-outcome.mjs';
import {GENESIS,PERIOD,validateBeacon} from '../../src/randomness/drand.mjs';
const require=createRequire(import.meta.url),reference=require('../../server/adapters/qianqi/runtime/scripts/monthly-outcome.cjs');
const vector=JSON.parse(readFileSync('vendor/qianqi/research/drand-feasibility/vector.json'));
const time=GENESIS+(vector.beacon.round-1)*PERIOD,month=2592000;
process.env.PRODUCTION_TEST_START=new Date((time-month-100000)*1000).toISOString();
process.env.HARDHAT_CONFIG=resolve('tests/contracts/production-hardhat.config.cjs');
const {default:hre}=await import('hardhat');
const provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
const root='.local/test-results/monthly-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});
const report={scenarios:[],limits:['Isolated chain4663, no public sends','Historical BLS vector; finality/dataset truth remain operator responsibilities','Harness-only seed injection for branch tests; real candidate uses authenticated adapter','No shared worker/UI/Short routing integration yet']};
const scenario=async(name,f)=>{await f();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);};
const tx=async p=>(await p).wait();
try{
 const build=compileProduction({'tests/contracts/MonthlyFixtures.sol':{content:readFileSync('tests/contracts/MonthlyFixtures.sol','utf8')}});report.sourceHashes=build.manifest.sourceHashes;
 const signer=await provider.getSigner(0),other=await provider.getSigner(1),owner=await signer.getAddress();
 const artifact=(file,name)=>build.contracts[file][name];
 const deploy=async(file,name,args=[])=>{const a=artifact(file,name),c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const quote=await deploy('tests/contracts/Fixtures.sol','TestUSDG');
 const timing={lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30};
 const setup={asset:quote.target,operator:owner,instance:id('monthly-a'),minimumFund:100n,nextTarget:100n};
 const actual=await deploy('contracts/production/MonthlyProgram.sol','MonthlyProgram',[setup,timing]);
 const h=await deploy('tests/contracts/MonthlyFixtures.sol','MonthlyHarness',[{...setup,instance:id('monthly-b')},timing]);
 const fund=async(c,n)=>{await tx(quote.mint(owner,n));await tx(quote.approve(c.target,n));await tx(c.fund(n));};
 const move=async(t)=>{await hre.network.provider.send('evm_setNextBlockTimestamp',[t]);await hre.network.provider.send('evm_mine');};
 const people=[{wallet:owner,firstAttempt:1,lastAttempt:10}];
 const checkpoint=async()=>{const b=await provider.getBlock('latest');return {number:b.number,blockHash:b.hash,timestamp:b.timestamp,ledgerHash:id('ledger-'+b.number)};};
 await scenario('Constructor, interval, readiness, reserve cap and authority',async()=>{
  assert.equal(await actual.interval(),BigInt(month));
  await assert.rejects(deploy('contracts/production/MonthlyProgram.sol','MonthlyProgram',[{...setup,nextTarget:0},timing]));
  await fund(actual,299n);assert.equal(await actual.freeNext(),99n);await assert.rejects(actual.freeze(people,await checkpoint()));
  await fund(actual,301n);assert.equal(await actual.freeNext(),100n);assert.equal(await actual.freeFund(),500n);
  await assert.rejects(actual.connect(other).freeze(people,await checkpoint()));await assert.rejects(actual.fulfill(1,id('fake')));
  assert.equal(actual.interface.fragments.some(f=>f.name==='testSeed'),false);
 });
 for(const name of ['MonthlyProgram','MonthlyOutcome']){const a=artifact('contracts/production/'+name+'.sol',name);assert.ok(a.evm.deployedBytecode.object.length/2<=24576);assert.ok(a.evm.bytecode.object.length/2<=49152);}
 let draw;
 await scenario('Real adapter binds snapshot and verifies historical BLS before monthly settlement',async()=>{
  await move(time-timing.lead-2);await tx(actual.freeze(people,await checkpoint()));draw=await actual.draws(1);
  const adapter=new Contract(await actual.randomness(),artifact('contracts/production/ShortDrandAdapter.sol','ShortDrandAdapter').abi,signer);
  const request=await actual.requestForCycle(1);assert.equal((await adapter.requests(request)).round,BigInt(vector.beacon.round));
  await assert.rejects(actual.settle(people));await fund(actual,60n);assert.equal((await actual.draws(1)).budget,500n);
  await move(time+10);await assert.rejects(adapter.prove(request,'0x'+'00'.repeat(64)));
  await tx(adapter.prove(request,validateBeacon(vector.beacon,vector.beacon.round)));await tx(adapter.deliver(request));
  const expected=computeMonthly(draw.context,await actual.verifiedSeed(1),people,draw.budget);
  await assert.rejects(actual.settle([{...people[0],lastAttempt:11}]));await tx(actual.settle(people));
  assert.equal((await actual.draws(1)).resultHash,expected.resultHash);assert.equal(await actual.consumedThrough(owner),10n);
  await assert.rejects(actual.settle(people));await tx(adapter.deliver(request));
  if(expected.winner!==ZeroAddress){await tx(actual.connect(other).claim(1,expected.winner));await assert.rejects(actual.claim(1,expected.winner));}
  assert.equal(await actual.solvent(),true);assert.equal(await h.freeFund(),0n);assert.equal(await h.cycle(),0n);
 });
 await scenario('Monthly outcome matches independent QIANQI reference across gates and weighted ranges',async()=>{
  const p=[{wallet:owner,firstAttempt:1,lastAttempt:10},{wallet:await other.getAddress(),firstAttempt:5,lastAttempt:100}].sort((a,b)=>BigInt(a.wallet)<BigInt(b.wallet)?-1:1);
  const hits=new Set();for(let i=0;i<24;i++){const context=id('context-'+i),seed=id('seed-'+i),r=computeMonthly(context,seed,p,100n),q=reference.compute(context,seed,p,reference.RULES,100n),on=await h.outcome(context,seed,p);assert.equal(r.winner,q.winner);assert.equal(r.winner,on[0].toLowerCase());assert.equal(r.admitted,on[1]);hits.add(r.winner===ZeroAddress?'no':'yes');}assert.equal(hits.size,2);
 });
 await scenario('No-winner consumes attempts, resets timer, retains Next; win moves reserve without changing frozen prize',async()=>{
  await assert.rejects(h.freeze(people,await checkpoint()));
  for(const n of [1n,1n,1n,296n])await fund(h,n);assert.equal(await h.freeNext(),99n);assert.equal(await h.fundingRemainder(),2n);await assert.rejects(h.freeze(people,await checkpoint()));
  await fund(h,301n);
  for(const win of [false,true]){
   await move(Math.max(Number(await h.lastTerminal())+month,Number((await provider.getBlock('latest')).timestamp)+1));const consumed=Number(await h.consumedThrough(owner));const p=[{wallet:owner,firstAttempt:consumed+1,lastAttempt:consumed+10}];
   if(consumed)await assert.rejects(h.freeze(people,await checkpoint()));
   await tx(h.freeze(p,await checkpoint()));const cycle=await h.cycle(),d=await h.draws(cycle);let seed;
   for(let i=0;i<100;i++){const candidate=id('branch-'+i);if((computeMonthly(d.context,candidate,p,d.budget).winner!==ZeroAddress)===win){seed=candidate;break;}}assert.ok(seed);
   await fund(h,60n);await tx(h.testSeed(seed));await tx(h.settle(p));
   assert.equal(await h.freeNext(),win?0n:100n);assert.equal(await h.freeFund(),win?160n:d.budget+60n);assert.equal(await h.consumedThrough(owner),BigInt(consumed+10));
   await assert.rejects(h.freeze(p,await checkpoint()));
   if(win){assert.equal(await h.liabilities(),d.budget);await move(Number(await h.lastTerminal())+month);await assert.rejects(h.freeze([{wallet:owner,firstAttempt:21,lastAttempt:30}],await checkpoint()));await fund(h,300n);assert.equal(await h.freeNext(),100n);assert.equal(await h.freeFund(),360n);await tx(h.claim(cycle,owner));assert.equal(await h.liabilities(),0n);await assert.rejects(h.claim(cycle,owner));}
   assert.equal(await h.solvent(),true);
  }
 });
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.shortMessage||e.message;console.error(e);process.exitCode=1;}
finally{writeFileSync(root+'/report.json',JSON.stringify(report,null,2));console.log(root+'/report.json');provider.destroy();}
