import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import solc from 'solc';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Contract, ContractFactory, id } from 'ethers';
import { providerFor, NETWORK, stringify } from '../../src/pons/client.mjs';
import { initialDraft, preparePlan, simulatePlan } from '../../src/pons/plan.mjs';
import { assertLocalFork, executeLocalLaunch, sendLocal } from '../../src/pons/local-execution.mjs';
import { createProfile, scanTickets, freezeTicketSnapshot, verifyTicketSettlement } from '../../src/tickets/scanner.mjs';
import { digest, snapshotTickets } from '../../src/tickets/ledger.mjs';
import { bundleHash, creditedEvents } from '../../src/tickets/late-recognition.mjs';
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
  const recognitionSource='contracts/draws/LocalPurchaseRecognition.sol';
  const compilation=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{[source]:{content:readFileSync(source,'utf8')},[recognitionSource]:{content:readFileSync(recognitionSource,'utf8')}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:p=>{try{return {contents:readFileSync(p.startsWith('@')?resolve('node_modules',p):resolve(p),'utf8')};}catch{return {error:p};}}}));
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
  await scenario('Late commitment: cutoff, carry, durable proof, retry, validation and reorg halt',async()=>{
    const nextProgram=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,alice).deploy(quote.target,a,1,1000000,1,[1]);await nextProgram.waitForDeployment();
    const art=compilation.contracts[recognitionSource].LocalPurchaseRecognition;
    const instanceId=id('late-'+result.token);
    const sourceContract=await new ContractFactory(art.abi,art.evm.bytecode.object,alice).deploy(instanceId,a);await sourceContract.waitForDeployment();
    const p=await createProfile(provider,{token:result.token,program:nextProgram.target,launchBlock:result.block,thresholdRaw:'10000000',instance:'late-test',recognition:{
      adapter:'local-verified-curve-v1',source:sourceContract.target,publisher:a,instanceId,deferDirectBuys:true,
    }});
    const latePath=dir+'/late.json',profilePath=dir+'/late-profile.json',bundleDirectory=dir+'/bundles';mkdirSync(bundleDirectory);writeFileSync(profilePath,JSON.stringify(p));
    let state=await scanTickets(provider,p,latePath,await head());
    assert.equal(state.wallets[a.toLowerCase()].tickets,'0');assert.equal(state.wallets[a.toLowerCase()].remainder,'6000000');
    const original=state.blocks.flatMap(block=>block.events).find(e=>e.status==='WAITING_RECOGNITION'&&e.netQuoteDebitRaw==='4000000');assert.ok(original);
    const frozen=await freezeTicketSnapshot(provider,p,latePath,'before-credit',state.head.number);
    const bundle={schema:'launchpad-local-recognition-v1',profileHash:digest(p),candidates:[original.candidateId]};
    const key=bundleHash(bundle),bundlePath=bundleDirectory+'/'+key+'.json';
    await assert.rejects(sourceContract.connect(bob).confirm(key,1),/publisher/);
    await assert.rejects(sourceContract.confirm(key,0),/bundle/);
    await assert.rejects(sourceContract.confirm(key,51),/bundle/);
    const before=readFileSync(latePath,'utf8');
    const receipt=await tx(sourceContract.confirm(key,1));
    await assert.rejects(scanTickets(provider,p,latePath,await head(),{bundleDirectory}),/ENOENT/);
    assert.equal(readFileSync(latePath,'utf8'),before);
    writeFileSync(bundlePath,JSON.stringify({...bundle,profileHash:'wrong'}));
    await assert.rejects(scanTickets(provider,p,latePath,await head(),{bundleDirectory}),/hash mismatch/);
    assert.equal(readFileSync(latePath,'utf8'),before);
    writeFileSync(bundlePath,JSON.stringify(bundle));
    await promisify(execFile)(process.execPath,['scripts/index-tickets.mjs',profilePath,latePath,String(await head()),'-',bundleDirectory],{windowsHide:true});
    state=await scanTickets(provider,p,latePath,await head(),{bundleDirectory});
    assert.equal(state.wallets[a.toLowerCase()].tickets,'1');assert.equal(state.wallets[a.toLowerCase()].remainder,'0');
    assert.deepEqual(await freezeTicketSnapshot(provider,p,latePath,'before-credit',frozen.cutoff),frozen);
    assert.deepEqual(snapshotTickets(state,frozen.cutoff).participants,[]);
    assert.equal(snapshotTickets(state,state.head.number).participants[0].lastAttempt,'1');
    assert.deepEqual(state.blocks.flatMap(block=>block.events).find(e=>e.candidateId===original.candidateId),original);
    assert.equal(creditedEvents(state).find(e=>e.candidateId===original.candidateId).creditedAt.blockNumber,receipt.blockNumber);
    unlinkSync(bundlePath);
    const child=await promisify(execFile)(process.execPath,['scripts/index-tickets.mjs',profilePath,latePath,String(await head())],{windowsHide:true});
    assert.deepEqual(JSON.parse(child.stdout).wallets,state.wallets);
    await assert.rejects(sourceContract.confirm(key,1),/bundle/);
    const repeat={...bundle,delivery:'retry'},repeatKey=bundleHash(repeat);writeFileSync(bundleDirectory+'/'+repeatKey+'.json',JSON.stringify(repeat));
    await tx(sourceContract.confirm(repeatKey,1));
    state=await scanTickets(provider,p,latePath,await head(),{bundleDirectory});
    assert.equal(state.wallets[a.toLowerCase()].tickets,'1');
    assert.equal(creditedEvents(state).find(e=>e.candidateId===original.candidateId).creditedAt.blockNumber,receipt.blockNumber);
    const evm=await provider.send('evm_snapshot',[]);
    const other=state.blocks.flatMap(block=>block.events).find(e=>e.status==='WAITING_RECOGNITION'&&e.recipient===b.toLowerCase());assert.ok(other);
    const next={...bundle,candidates:[other.candidateId]},nextKey=bundleHash(next);writeFileSync(bundleDirectory+'/'+nextKey+'.json',JSON.stringify(next));
    await tx(sourceContract.confirm(nextKey,1));
    await scanTickets(provider,p,latePath,await head(),{bundleDirectory});
    const confirmed=readFileSync(latePath,'utf8');await provider.send('evm_revert',[evm]);
    await assert.rejects(scanTickets(provider,p,latePath,await head(),{bundleDirectory}));
    await assert.rejects(freezeTicketSnapshot(provider,p,latePath,'orphan',frozen.cutoff),/branch changed/);
    assert.equal(readFileSync(latePath,'utf8'),confirmed);
    report.lateRecognition={source:sourceContract.target,program:nextProgram.target,confirmationBlock:receipt.blockNumber,limits:'Deferred direct route; unknown routers remain unsupported; state intentionally orphaned by final reorg test.'};
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
