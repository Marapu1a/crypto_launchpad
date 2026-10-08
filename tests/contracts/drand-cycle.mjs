import { readFileSync,mkdirSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import solc from 'solc';
import { BrowserProvider,Contract,ContractFactory,id } from 'ethers';
import { GENESIS,PERIOD,fetchInfo,fetchLatest,fetchBeacon,deliverRequest,validateBeacon } from '../../src/randomness/drand.mjs';
import { compute,QIANQI_RULES } from '../../src/draws/short-outcome.mjs';
const live=process.argv.includes('--live');
const vector=JSON.parse(readFileSync('vendor/qianqi/research/drand-feasibility/vector.json','utf8'));
const timing={lead:60,clockLag:5,clockAhead:5,finalizedLag:5,beaconLag:10};
const fixtureTime=GENESIS+(vector.beacon.round-1)*PERIOD;
process.env.DRAND_TEST_START=new Date((live?Date.now()-30000:(fixtureTime-120)*1000)).toISOString();
process.env.HARDHAT_CONFIG=resolve('tests/contracts/drand-hardhat.config.cjs');
const {default:hre}=await import('hardhat');
const provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});
const report={startedAt:new Date().toISOString(),live,scenarios:[],limits:['Local31337; clock/finality policy not admitted for production','Operator still supplies participants; no real purchases in this test']};
mkdirSync('.local/test-results',{recursive:true});const path=`.local/test-results/drand-${report.startedAt.replace(/[:.]/g,'-')}.json`;
const save=()=>writeFileSync(path,JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2));
const tx=async p=>(await p).wait();
const scenario=async(name,fn)=>{await fn();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);save();};
try{
  const source='contracts/draws/LocalDrandShortProgram.sol';
  const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{[source]:{content:readFileSync(source,'utf8')},'tests/contracts/Fixtures.sol':{content:readFileSync('tests/contracts/Fixtures.sol','utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}}),{import:p=>{try{return {contents:readFileSync(p.startsWith('@')?resolve('node_modules',p):resolve(p),'utf8')};}catch{return {error:p};}}}));
  assert.deepEqual((output.errors??[]).filter(e=>e.severity==='error'),[]);
  const signer=await provider.getSigner(0),other=await provider.getSigner(1);
  const deploy=async(file,name,args=[])=>{const a=output.contracts[file][name];assert.ok(a.evm.deployedBytecode.object.length/2<=24576);const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
  const token=await deploy('tests/contracts/Fixtures.sol','TestUSDG');
  const program=await deploy(source,'LocalDrandShortProgram',[token.target,await signer.getAddress(),1,100000000,5000000,[7,4,2,1,1,1,1,1,1,1],timing]);
  const adapter=new Contract(await program.randomness(),output.contracts['contracts/draws/LocalDrandAdapter.sol'].LocalDrandAdapter.abi,signer);
  await tx(token.mint(await signer.getAddress(),200000000));await tx(token.approve(program.target,200000000));await tx(program.fund(100000000));
  const people=Array.from({length:30},(_,i)=>({wallet:'0x'+(i+100).toString(16).padStart(40,'0'),firstAttempt:1n,lastAttempt:20n}));
  if(live){report.info=await fetchInfo();report.before=await fetchLatest();assert.ok(Math.abs(Date.now()/1000-(GENESIS+(report.before.round-1)*PERIOD))<20,'Stale beacon or clock');}
  const freezeTime=live?Math.max(Math.floor(Date.now()/1000),(await provider.getBlock('latest')).timestamp+1):fixtureTime-timing.lead-1;
  await hre.network.provider.send('evm_setNextBlockTimestamp',[freezeTime]);await tx(program.freeze(people));
  const requestId=await program.requestForCycle(1),request=await adapter.requests(requestId),draw=await program.draws(1);
  report.request={id:requestId,round:request.round,context:request.context,freezeTime,wallAtFreeze:new Date().toISOString()};
  await scenario('Freeze binds one future round; operator cannot replace seed or request',async()=>{
    assert.equal(request.context,draw.context);assert.equal(request.consumer,program.target);
    if(live){assert.ok(Number(request.round)>report.before.round);assert.ok(GENESIS+(Number(request.round)-1)*PERIOD>Date.now()/1000);}
    else assert.equal(Number(request.round),vector.beacon.round);
    await assert.rejects(program.settle(people,id('manual')));
    await assert.rejects(program.fulfill(requestId,id('manual')));
    await assert.rejects(program.freeze(people));await assert.rejects(adapter.request(id('other-context')));
    assert.equal(await program.reserved(),100000000n);
  });
  let beacon=vector.beacon;
  if(live){
    console.log('Waiting for the fixed future drand round '+request.round+' (about one minute).');
    save();const deadline=Date.now()+100000;
    for(;;){try{beacon=await fetchBeacon(Number(request.round));break;}catch(e){if(Date.now()>deadline)throw e;await new Promise(r=>setTimeout(r,2000));}}
  }
  report.beacon=beacon;const signature=validateBeacon(beacon,Number(request.round));
  await hre.network.provider.send('evm_setNextBlockTimestamp',[GENESIS+(Number(request.round)-1)*PERIOD]);await hre.network.provider.send('evm_mine');
  await scenario('BLS accepts drand signature; bad signature and wrong round rejected',async()=>{
    assert.equal(await adapter.verify(request.round,signature),true);
    assert.equal(await adapter.verify(request.round+1n,signature),false);
    await assert.rejects(adapter.prove(requestId,'0x'+'00'.repeat(64)));
    await tx(adapter.prove(requestId,signature));
    const proven=await adapter.requests(requestId);assert.equal(proven.proven,true);assert.equal(proven.delivered,false);
    await tx(adapter.prove(requestId,signature));assert.equal((await adapter.requests(requestId)).seed,proven.seed);
    await assert.rejects(tx(adapter.deliver(requestId,{gasLimit:30000})));
    assert.equal((await adapter.requests(requestId)).proven,true);assert.equal((await adapter.requests(requestId)).delivered,false);
  });
  let seed;
  await scenario('Delivery resumes from proof; repeated delivery preserves seed',async()=>{
    seed=await deliverRequest(adapter.connect(other),requestId,beacon);
    assert.equal(await program.verifiedSeed(1),seed);assert.equal(await program.fulfilled(1),true);
    assert.equal(await deliverRequest(adapter,requestId,beacon),seed);
    await assert.rejects(program.settle(people,id('replacement')));
  });
  await scenario('Verified seed produces expected prizes and payouts with no reroll',async()=>{
    const result=compute(draw.context,seed,people,QIANQI_RULES,[35,20,10,5,5,5,5,5,5,5].map(n=>BigInt(n)*1000000n));
    await tx(program.connect(other).settle(people,seed));assert.equal((await program.draws(1)).resultHash,result.resultHash);
    let total=0n;for(let i=0;i<result.winners.length;i++){await tx(program.claim(1,result.winners[i]));assert.equal(await token.balanceOf(result.winners[i]),result.amounts[i]);total+=result.amounts[i];}
    assert.equal(total+await program.freeFund(),100000000n);await assert.rejects(program.settle(people,seed));
    report.result={winners:result.winners,amounts:result.amounts,resultHash:result.resultHash,seed};
  });
  report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.shortMessage||e.message;console.log('FAIL '+report.error);process.exitCode=1;}
finally{save();console.log(path);provider.destroy();}
