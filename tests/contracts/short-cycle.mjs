import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import solc from 'solc';
import { BrowserProvider, ContractFactory, id } from 'ethers';
import { compute, QIANQI_RULES } from '../../src/draws/short-outcome.mjs';
process.env.HARDHAT_CONFIG = resolve('tests/contracts/hardhat.config.cjs');
const { default: hre } = await import('hardhat');
const provider = new BrowserProvider(hre.network.provider, undefined, { cacheTimeout: -1 });
const signer = await provider.getSigner(0), stranger = await provider.getSigner(1);
const sources = Object.fromEntries(['contracts/draws/LocalShortProgram.sol','contracts/draws/LocalFeeCollector.sol','tests/contracts/Fixtures.sol'].map(f=>[f,{content:readFileSync(f,'utf8')}]));
const compiled = JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:p=>{try{return {contents:readFileSync(p.startsWith('@')?resolve('node_modules',p):resolve(p),'utf8')};}catch{return {error:'Missing '+p};}}}));
const errors = compiled.errors?.filter(e=>e.severity==='error')||[]; assert.deepEqual(errors,[]);
async function deploy(file,name,args=[]) { const c=compiled.contracts[file][name]; const contract=await new ContractFactory(c.abi,c.evm.bytecode.object,signer).deploy(...args); await contract.waitForDeployment(); return contract; }
const tx = async p => (await p).wait();
const report={date:new Date().toISOString(),chain:'isolated in-process Hardhat 31337; no fork/RPC',scenarios:[],compiler:solc.version()};
async function scenario(name,fn){await fn();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);}
const token=await deploy('tests/contracts/Fixtures.sol','TestUSDG');
const program=await deploy('contracts/draws/LocalShortProgram.sol','LocalShortProgram',[await token.getAddress(),await signer.getAddress(),60,100000000,5000000,[7,4,2,1,1,1,1,1,1,1]]);
const addr=await program.getAddress();
await tx(token.mint(await signer.getAddress(),1000000000));await tx(token.approve(addr,1000000000));
const escrow=await deploy('tests/contracts/Fixtures.sol','TestEscrow',[await token.getAddress()]);
const collector=await deploy('contracts/draws/LocalFeeCollector.sol','LocalFeeCollector',[await token.getAddress(),await escrow.getAddress(),addr]);
const participants=Array.from({length:30},(_,i)=>({wallet:'0x'+(i+100).toString(16).padStart(40,'0'),firstAttempt:1n,lastAttempt:20n}));
const waitInterval=()=>hre.network.provider.send('evm_increaseTime',[61]);
let expected;
await scenario('Solidity outcome matches JS in 24 vectors including 64 slots and zero admission',async()=>{
  const harness=await deploy('tests/contracts/Fixtures.sol','OutcomeHarness');
  for(const size of [0,1,3,30])for(const slots of [1,10,64])for(const seed of [id('a'),id('b')]){
    const people=participants.slice(0,size),prizes=Array.from({length:slots},(_,i)=>BigInt(i+1));
    const expected=compute(id('context'),seed,people,QIANQI_RULES,prizes);
    const actual=await harness.compute(id('context'),seed,people,prizes);
    assert.deepEqual([...actual.winners].map(s=>s.toLowerCase()),expected.winners);
    assert.deepEqual([...actual.amounts],expected.amounts);assert.deepEqual([...actual.prizeIndices],expected.prizeIndices);
    assert.equal(actual.admittedCount,expected.admittedCount);assert.equal(actual.resultHash,expected.resultHash);
  }
});
await scenario('Funding is accounted once; freeze waits for interval',async()=>{
  await tx(token.approve(await escrow.getAddress(),100000000));
  await tx(escrow.deposit(await collector.getAddress(),100000000));
  await tx(collector.connect(stranger).collect());
  await tx(collector.collect()); // Empty repeat must not credit the program twice.
  await tx(collector.connect(stranger).forward());
  await assert.rejects(collector.forward());
  assert.equal(await token.allowance(await collector.getAddress(),addr),0n);
  assert.equal(await program.freeFund(),100000000n);
  await assert.rejects(program.freeze(participants)); await waitInterval(); await hre.network.provider.send('evm_mine');
  await assert.rejects(program.connect(stranger).freeze(participants));
  await tx(program.freeze(participants));assert.equal(await program.reserved(),100000000n);
  assert.equal(await program.consumedThrough(participants[0].wallet),0n);
});
await scenario('Frozen snapshot immutable; late funding goes to next cycle',async()=>{
  await tx(program.fund(25000000));assert.equal(await program.freeFund(),25000000n);
  await assert.rejects(program.freeze(participants));
  await assert.rejects(program.settle(participants.slice(1),id('seed')));
  await assert.rejects(program.connect(stranger).settle(participants,id('seed')));
  const d=await program.draws(1);
  expected=compute(d.context,id('seed'),participants,QIANQI_RULES,[35,20,10,5,5,5,5,5,5,5].map(n=>BigInt(n)*1000000n));
  await tx(program.settle(participants,id('seed')));
  const settled=await program.draws(1);assert.equal(settled.resultHash,expected.resultHash);
  assert.equal(await program.consumedThrough(participants[0].wallet),20n);
  assert.equal(await program.freeFund(),125000000n-expected.amounts.reduce((a,b)=>a+b,0n));
  await assert.rejects(program.settle(participants,id('another-seed')));
});
await scenario('Failed recipient preserves debt; other winners claim; retry cannot double pay',async()=>{
  assert.ok(expected.winners.length>=2);
  const bad=expected.winners[0];await tx(token.blockRecipient(bad,true));
  await assert.rejects(program.claim(1,bad));assert.equal(await program.rewards(1,bad),expected.amounts[0]);
  for(let i=1;i<expected.winners.length;i++){await tx(program.connect(stranger).claim(1,expected.winners[i]));assert.equal(await token.balanceOf(expected.winners[i]),expected.amounts[i]);}
  await tx(token.blockRecipient(bad,false));await tx(program.claim(1,bad));
  await assert.rejects(program.claim(1,bad));assert.equal(await program.liabilities(),0n);assert.equal(await program.solvent(),true);
});
await scenario('Second cycle requires fresh attempts and keeps independent history',async()=>{
  await tx(program.fund(100000000));await waitInterval();await hre.network.provider.send('evm_mine');
  await assert.rejects(program.freeze(participants));
  const next=participants.map(p=>({...p,firstAttempt:21n,lastAttempt:40n}));
  await tx(program.freeze(next));await tx(program.settle(next,id('second')));
  assert.equal(await program.cycle(),2n);assert.equal((await program.draws(1)).resultHash,expected.resultHash);
  assert.equal(await program.solvent(),true);
});
await scenario('Independent program cannot spend another program funds or rewards',async()=>{
  const other=await deploy('contracts/draws/LocalShortProgram.sol','LocalShortProgram',[await token.getAddress(),await signer.getAddress(),1,1,1,[1]]);
  assert.equal(await other.freeFund(),0n);await assert.rejects(other.claim(1,expected.winners[0]));
  assert.equal(await program.cycle(),2n);
});
await scenario('No admitted wallets returns entire frozen fund; empty list cannot start a draw',async()=>{
  const p=await deploy('contracts/draws/LocalShortProgram.sol','LocalShortProgram',[await token.getAddress(),await signer.getAddress(),1,1,1,[1]]);
  await tx(token.approve(await p.getAddress(),101));await tx(p.fund(101));
  await hre.network.provider.send('evm_increaseTime',[2]);await hre.network.provider.send('evm_mine');
  await assert.rejects(p.freeze([]));
  const people=[{wallet:participants[0].wallet,firstAttempt:1n,lastAttempt:1n}];
  await tx(p.freeze(people));const d=await p.draws(1);
  let seed;for(let i=0;i<100;i++){const candidate=id('no-admission-'+i);if(compute(d.context,candidate,people,QIANQI_RULES,[101n]).admittedCount===0n){seed=candidate;break;}}
  assert.ok(seed);await tx(p.settle(people,seed));
  assert.equal(await p.freeFund(),101n);assert.equal(await p.liabilities(),0n);assert.equal(await p.reserved(),0n);
  assert.equal(await p.consumedThrough(people[0].wallet),1n);
});
mkdirSync('.local/test-results',{recursive:true});
const path=`.local/test-results/short-cycle-${report.date.replace(/[:.]/g,'-')}.json`;
writeFileSync(path,JSON.stringify(report,null,2));console.log(path);
await provider.destroy();
