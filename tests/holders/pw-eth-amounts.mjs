import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {BrowserProvider,ContractFactory,parseEther,keccak256} from 'ethers';
import {compileProduction} from '../../src/worker/production-build.mjs';
import {setupPwCycle,vectorTime} from './pw-local-cycle.mjs';
import {collectHolderSnapshot} from '../../src/holders/snapshot.mjs';
import {admitHolderSnapshot} from '../../src/holders/admission.mjs';
import {planHolderAllocation} from '../../src/holders/allocation.mjs';
import {identity} from '../../src/holders/values.mjs';
import {replayTickets} from '../../src/tickets/ledger.mjs';

process.env.PRODUCTION_TEST_START=new Date((vectorTime-2592000-7200)*1000).toISOString();
process.env.HARDHAT_CONFIG=resolve('tests/contracts/production-worker-hardhat.config.cjs');
const {default:hre}=await import('hardhat');
const provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
const root='.local/test-results/pw-eth-amounts-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});
const report={status:'FAIL',checks:[],limits:['Local EVM and modeled Pons pricing; no public transactions','Actual approved thresholds; gas units are local measurements, not a live fee quote','PostgreSQL recovery covered by separate execution rehearsal']};
const tx=async p=>(await p).wait();
try{
 const signer=await provider.getSigner(0),owner=await signer.getAddress();
 const fixtureBuild=compileProduction({'tests/contracts/NativeFixtures.sol':{content:readFileSync('tests/contracts/NativeFixtures.sol','utf8')}});
 const fixture=async(name,args=[],file='NativeFixtures')=>{const a=fixtureBuild.contracts['tests/contracts/'+file+'.sol'][name];const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const pw=await setupPwCycle({provider,signer,owner,fixture,root,approvedAmounts:true});
 const {vault,draw,token,scope,instance,collector,split}=pw,parameters=pw.manifest.parameters;
 assert.equal(parameters.ticketRaw,String(parseEther('0.001')));
 assert.equal(await draw.minimumFund(),parseEther('0.005'));assert.equal(await draw.minimumUnit(),parseEther('0.005'));
 const minimum=parseEther('0.0005');assert.equal(await vault.minimumPayment(),minimum);
 report.parameters=parameters;
 const wallets=await Promise.all([1,2].map(async i=>(await (await provider.getSigner(i)).getAddress()).toLowerCase()));
 // Exact cumulative ticket boundary, including single-wei carry.
 const ticket=BigInt(parameters.ticketRaw),event=(id,amount)=>({candidateId:id,status:'ELIGIBLE',recipient:wallets[0],netQuoteDebitRaw:String(amount)});
 assert.equal(replayTickets([event('a',ticket-1n)],String(ticket))[wallets[0]].tickets,'0');
 assert.equal(replayTickets([event('a',ticket-1n),event('b',1n)],String(ticket))[wallets[0]].tickets,'1');
 assert.equal(replayTickets([event('a',ticket*1000000n)],String(ticket))[wallets[0]].tickets,'1000000');
 report.checks.push('Ticket 0.001 ETH: below by 1 wei, exact cumulative threshold, one million tickets without product cap');
 // Isolate direct funding boundary from the real modeled fee path below.
 const saved=await provider.send('evm_snapshot',[]);
 await provider.send('evm_setNextBlockTimestamp',[vectorTime-3601]);await provider.send('evm_mine',[]);
 const head=await provider.getBlock('latest'),checkpoint={number:head.number,blockHash:head.hash,timestamp:head.timestamp,ledgerHash:'0x'+'1'.repeat(64)};
 const participants=[{wallet:wallets[0],firstAttempt:1,lastAttempt:1}];
 await tx(draw.fund(parseEther('0.005')-1n,{value:parseEther('0.005')-1n}));
 await assert.rejects(draw.freeze(participants,checkpoint),/not ready/);
 await tx(draw.fund(1,{value:1}));await tx(draw.freeze(participants,checkpoint));
 assert.equal((await draw.draws(1)).budget,parseEther('0.005'));
 await provider.send('evm_revert',[saved]);
 report.checks.push('Draw refuses 0.005 ETH minus 1 wei and accepts exactly 0.005 after 30 days');
 await pw.purchases(wallets);
 await tx(collector.sweepCurve());await tx(collector.collect());await tx(collector.forward());await tx(split.deliver(0));
 assert.equal(await vault.totalReceived(),parseEther('0.018'));
 report.draw=await pw.drawCycle();assert.equal(report.draw.funded,String(parseEther('0.006')));
 assert.ok(report.draw.tickets.every(t=>t.count==='500'));
 assert.equal(BigInt(report.draw.awarded)+BigInt(report.draw.carry),parseEther('0.006'));
 report.checks.push('Two 0.5 ETH buys: 0.03 ETH creator tax -> 0.018 holders / 0.006 draw / 0.006 project; 500 tickets each; actual BLS settlement');
 const snapshotPolicy={schema:'holder-snapshot-policy-v1',scopeId:identity(scope),semantics:'reviewed-nonproxy-erc20-supply-sum',tokenCodeHash:keccak256(await provider.getCode(token.target)),maxHolders:5,maxRpcCalls:13,maxAgeSeconds:600};
 const gas=[];
 async function publish(period,budget){
  const block=await provider.getBlock('latest');
  const candidate=await collectHolderSnapshot({chainId:4663,token:token.target,maxPages:1,maxHolders:5,observedAt:block.timestamp,fetchPage:async()=>({token:token.target,holders:2,supply:'2',as_of:{rollup_bucket:period,tail_from_block:block.number},page:wallets.map(wallet=>({wallet,balance:'1'})),next_cursor:null})});
  const dueAt=pw.launchAt+period*2592000;
  const {proof}=await admitHolderSnapshot({provider,candidate,policy:snapshotPolicy,scope,period,dueAt,until:dueAt+2592000,now:block.timestamp+1});
  const plan=planHolderAllocation({scope,candidate,proof,snapshotPolicy,exclusions:[],budget:String(budget),vault:vault.target,instance});
  for(const [method,args] of [['openRound',[period,plan.snapshot,plan.commitment,plan.budget,plan.count]],['append',[period,0,plan.allocations.map(h=>h.wallet),plan.allocations.map(h=>h.amount)]],['seal',[period]]]){
   const receipt=await tx(vault[method](...args));gas.push({period,method,gasUsed:String(receipt.gasUsed)});
  }
 }
 await publish(1,2n*(minimum-1n));
 await assert.rejects(vault.pay(wallets[0],[1]));await tx(vault.consolidate(wallets[0],[1]));
 assert.equal(await vault.credit(wallets[0]),minimum-1n);
 await provider.send('evm_setNextBlockTimestamp',[pw.launchAt+2*2592000+1]);await provider.send('evm_mine',[]);
 await publish(2,2n);
 const control=vault.connect(await provider.getSigner(9));await tx(control.setPublicationsPaused(true));
 for(const wallet of wallets){const before=await provider.getBalance(wallet);const receipt=await tx(vault.pay(wallet,[1,2]));assert.equal(await provider.getBalance(wallet)-before,minimum);gas.push({method:'pay',gasUsed:String(receipt.gasUsed)});await assert.rejects(vault.pay(wallet,[1,2]));}
 assert.equal(await vault.totalAllocated(),2n*minimum);assert.equal(await vault.totalPaid(),2n*minimum);
 assert.equal(await vault.available(),parseEther('0.017'));assert.equal(await vault.solvent(),true);
 report.checks.push('Holder credit 0.0005 ETH minus 1 wei carries; next period adds 1 wei; exact minimum paid once to both wallets during publication pause');
 report.holders={received:String(await vault.totalReceived()),allocated:String(await vault.totalAllocated()),paid:String(await vault.totalPaid()),available:String(await vault.available())};
 report.gas=gas;report.status='PASS';
}finally{writeFileSync(root+'/report.json',JSON.stringify(report,null,2));provider.destroy();console.log(root+'/report.json',report.status);}
