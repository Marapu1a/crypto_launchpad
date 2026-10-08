import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import solc from 'solc';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Contract, ContractFactory, id } from 'ethers';
import { providerFor, NETWORK, stringify } from '../../src/pons/client.mjs';
import { initialDraft, preparePlan, simulatePlan } from '../../src/pons/plan.mjs';
import { assertLocalFork, executeLocalLaunch, sendLocal } from '../../src/pons/local-execution.mjs';
import { createProfile, scanTickets, freezeTicketSnapshot, verifyTicketSettlement } from '../../src/tickets/scanner.mjs';
const provider=providerFor('http://127.0.0.1:8545');
const report={startedAt:new Date().toISOString(),scenarios:[],limits:['Local Pons fork only; USDG curve and launch router; synthetic USDG funding and test RNG.']};
const stamp=report.startedAt.replace(/[:.]/g,'-'),dir=`.local/test-results/tickets-${stamp}`;
mkdirSync(dir,{recursive:true});
const tx=async p=>(await p).wait();
const scenario=async(name,fn)=>{await fn();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);};
try{
  await assertLocalFork(provider);report.fork=await provider.send('hardhat_metadata',[]);
  const alice=await provider.getSigner(0),bob=await provider.getSigner(1),a=await alice.getAddress(),b=await bob.getAddress();
  const quote=new Contract('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',['function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)'],alice);
  const holder='0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e';
  await provider.send('hardhat_impersonateAccount',[holder]);await provider.send('hardhat_setBalance',[holder,'0x56bc75e2d63100000']);
  try{for(const [recipient,value] of [[a,500000000],[b,50000000]]){const hash=await provider.send('eth_sendTransaction',[{from:holder,to:quote.target,data:quote.interface.encodeFunctionData('transfer',[recipient,value])}]);await provider.waitForTransaction(hash);}}
  finally{await provider.send('hardhat_stopImpersonatingAccount',[holder]);}
  const source='contracts/draws/LocalShortProgram.sol';
  const compilation=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{[source]:{content:readFileSync(source,'utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:p=>{try{return {contents:readFileSync(p.startsWith('@')?resolve('node_modules',p):resolve(p),'utf8')};}catch{return {error:p};}}}));
  assert.equal((compilation.errors??[]).filter(e=>e.severity==='error').length,0);
  const artifact=compilation.contracts[source].LocalShortProgram;
  const program=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,alice).deploy(quote.target,a,1,1000000,1,[1]);await program.waitForDeployment();
  const launch=async opening=>{
    const draft={...initialDraft(),name:'Ticket Test',symbol:'TICK',logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee',pair:quote.target,creatorFee:'1',openingBuy:opening};
    let plan=await preparePlan(provider,draft,a);const journal=[];
    for(const step of plan.steps)await sendLocal(provider,a,step,journal,async()=>{},step.kind);
    plan=await simulatePlan(provider,await preparePlan(provider,draft,a));
    return executeLocalLaunch(provider,plan,journal,async()=>{});
  };
  const result=await launch('6');report.token=result.token;
  const profile=await createProfile(provider,{token:result.token,program:program.target,launchBlock:result.block,thresholdRaw:'10000000',instance:'ticket-test'});
  writeFileSync(dir+'/profile.json',JSON.stringify(profile,null,2));
  const path=dir+'/state.json';const head=async()=>Number(BigInt(await provider.send('eth_blockNumber',[])));
  const curve=new Contract(result.curve,['function buy(uint256,uint256,address) returns(uint256)','function sell(uint256,uint256,address) returns(uint256)'],alice);
  const token=new Contract(result.token,['function transfer(address,uint256) returns(bool)','function approve(address,uint256) returns(bool)','function balanceOf(address) view returns(uint256)'],alice);
  let cutoff,snapshot;
  await scenario('Opening buy and accumulated direct buys: 6 + 4 USDG = one ticket',async()=>{
    await tx(quote.approve(curve.target,100000000));await tx(curve.buy(4000000,1,a));
    let state=await scanTickets(provider,profile,path,await head());
    assert.equal(state.wallets[a.toLowerCase()].tickets,'1');assert.equal(state.wallets[a.toLowerCase()].remainder,'0');
    assert.ok(state.blocks.flatMap(x=>x.events).some(e=>e.reason==='OPENING_BUY'&&e.status==='ELIGIBLE'));
  });
  await scenario('Separate buyers; transfers and sells do not issue or revoke tickets',async()=>{
    await tx(quote.connect(bob).approve(curve.target,25000000));await tx(curve.connect(bob).buy(25000000,1,b));
    const part=(await token.balanceOf(a))/10n;
    await tx(token.transfer(b,part));await tx(token.approve(curve.target,part));await tx(curve.sell(part,0,a));
    cutoff=await head();const state=await scanTickets(provider,profile,path,cutoff);
    assert.equal(state.wallets[a.toLowerCase()].tickets,'1');assert.equal(state.wallets[b.toLowerCase()].tickets,'2');assert.equal(state.wallets[b.toLowerCase()].remainder,'5000000');
    assert.ok(state.blocks.flatMap(x=>x.events).some(e=>e.reason==='SELL'));
  });
  await scenario('Restart/repeated scan preserves totals and immutable cutoff',async()=>{
    const state=await scanTickets(provider,profile,path,cutoff);const again=await scanTickets(provider,profile,path,cutoff);
    assert.deepEqual(state,again);
    const child=await promisify(execFile)(process.execPath,['scripts/index-tickets.mjs',dir+'/profile.json',path,String(cutoff)],{windowsHide:true});
    assert.deepEqual(JSON.parse(child.stdout).wallets,state.wallets);
    const corrupted=JSON.parse(readFileSync(path,'utf8'));corrupted.head.number++;
    writeFileSync(dir+'/corrupt.json',JSON.stringify(corrupted));
    await assert.rejects(scanTickets(provider,profile,dir+'/corrupt.json',cutoff),/checksum/);
    snapshot=await freezeTicketSnapshot(provider,profile,path,'cycle1',cutoff);
    await tx(curve.buy(10000000,1,a));await scanTickets(provider,profile,path,await head());
    assert.deepEqual(await freezeTicketSnapshot(provider,profile,path,'cycle1',cutoff),snapshot);
    await assert.rejects(freezeTicketSnapshot(provider,profile,path,'cycle1',await head()),/already frozen/);
    await assert.rejects(freezeTicketSnapshot(provider,profile,path,'replacement-cycle1',await head()),/already has a frozen/);
  });
  await scenario('Indexed participants drive Solidity freeze and settlement; next cycle excludes spent tickets',async()=>{
    await tx(quote.approve(program.target,100000000));await tx(program.fund(100000000));
    await tx(program.freeze(snapshot.participants));await tx(program.settle(snapshot.participants,id('tickets')));
    await verifyTicketSettlement(provider,snapshot);
    await scanTickets(provider,profile,path,await head());
    const next=await freezeTicketSnapshot(provider,profile,path,'cycle2',await head());
    assert.deepEqual(next.participants,[{wallet:a.toLowerCase(),firstAttempt:'2',lastAttempt:'2'}]);
  });
  await scenario('Two tokens, thresholds and state files remain independent',async()=>{
    const otherProgram=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,alice).deploy(quote.target,a,1,1000000,1,[1]);await otherProgram.waitForDeployment();
    const other=await launch('1');const p2=await createProfile(provider,{token:other.token,program:otherProgram.target,launchBlock:other.block,thresholdRaw:'1000000',instance:'other'});
    const second=await scanTickets(provider,p2,dir+'/other.json',await head());assert.equal(second.wallets[a.toLowerCase()].tickets,'1');
    await assert.rejects(scanTickets(provider,p2,path,await head()),/profile mismatch/);
    const first=await scanTickets(provider,profile,path,await head());assert.equal(first.wallets[a.toLowerCase()].tickets,'2');
  });
  await scenario('Changed branch stops indexing and snapshots without modifying saved state',async()=>{
    const evm=await provider.send('evm_snapshot',[]);
    await tx(curve.buy(1000000,1,a));await scanTickets(provider,profile,path,await head());
    const before=readFileSync(path,'utf8');await provider.send('evm_revert',[evm]);
    await assert.rejects(scanTickets(provider,profile,path,await head()));
    await assert.rejects(freezeTicketSnapshot(provider,profile,path,'after-reorg',cutoff),/branch changed/);
    assert.equal(readFileSync(path,'utf8'),before);
  });
  report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error.shortMessage||error.message).replace(/https?:\/\/\S+/g,'[endpoint]');console.log('FAIL '+report.error);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();writeFileSync(dir+'/report.json',stringify(report));console.log(dir+'/report.json');provider.destroy();}
