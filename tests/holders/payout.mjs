import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {BrowserProvider,ContractFactory,ZeroAddress,keccak256} from 'ethers';
import {compileHolderPayout} from '../../src/holders/build.mjs';
import {compileProduction} from '../../src/worker/production-build.mjs';
import {collectHolderSnapshot} from '../../src/holders/snapshot.mjs';
import {admitHolderSnapshot} from '../../src/holders/admission.mjs';
import {planHolderAllocation,inspectAllocationPublication} from '../../src/holders/allocation.mjs';
import {holderFundingInstance} from '../../src/holders/funding-receipt.mjs';
import {identity} from '../../src/holders/values.mjs';
process.env.HARDHAT_CONFIG=resolve('tests/contracts/production-worker-hardhat.config.cjs');
const {default:hre}=await import('hardhat');
const provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
const managed=process.argv.includes('--managed');
const root='.local/test-results/'+(managed?'holder-governance-':'holder-payout-')+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});
const report={status:'FAIL',checks:[],limits:['Local EVM only; publisher trusted, not proofless/permissionless allocation','No production worker or PostgreSQL payout reconciliation','Development amounts; actual wallets and production cutoff not selected']};
try{
 const build=compileHolderPayout({managed});report.build=build.manifest;
 const fixtures=compileProduction({'tests/contracts/Fixtures.sol':{content:readFileSync('tests/contracts/Fixtures.sol','utf8')},'PayoutFixtures.sol':{content:`pragma solidity ^0.8.24;
 contract OwnerProxy {function act(address target,bytes calldata data) external { (bool ok,)=target.call(data);require(ok);}}
 interface V {function fund(uint256) external payable returns(uint256);function pay(address payable,uint256[] calldata) external;}
 contract Source {address public holderFund;bytes32 public instance;constructor(address v,bytes32 i){holderFund=v;instance=i;}function deposit() external payable {V(holderFund).fund{value:msg.value}(msg.value);}}
 contract Recipient {bool public reject=true;bool public attack;address public vault;uint256 public received;function setup(bool r,bool a,address v) external {reject=r;attack=a;vault=v;}receive() external payable {require(!reject);if(attack){uint256[] memory p=new uint256[](1);p[0]=1;(bool ok,)=vault.call(abi.encodeCall(V.pay,(payable(address(this)),p)));require(!ok,"reentered");}received+=msg.value;}}
 `}});
 const signer=await provider.getSigner(0),other=await provider.getSigner(1),owner=await signer.getAddress(),wallet=await other.getAddress();
 const deploy=async(a,args=[])=>{const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const tx=async p=>(await p).wait();
 const token=await deploy(fixtures.contracts['tests/contracts/Fixtures.sol'].TestUSDG);
 const recipient=await deploy(fixtures.contracts['PayoutFixtures.sol'].Recipient);
 const scope={projectId:'payout-local',chainId:4663,token:token.target.toLowerCase(),asset:ZeroAddress},instance=holderFundingInstance(scope);
 const controller=await provider.getSigner(9),controllerAddress=await controller.getAddress();
 const vault=await deploy(build.artifact,managed?[instance,controllerAddress,owner,10]:[instance,owner,10]);
 const control=vault.connect(controller);
 const source=await deploy(fixtures.contracts['PayoutFixtures.sol'].Source,[vault.target,instance]);await tx(vault.bindSource(source.target));
 await assert.rejects(vault.fund(1,{value:1}));await tx(source.deposit({value:105}));
 for(const w of [wallet,recipient.target])await tx(token.mint(w,1));
 const block=await provider.getBlock('latest');
 const candidate=await collectHolderSnapshot({chainId:4663,token:token.target,maxPages:1,maxHolders:5,observedAt:block.timestamp,fetchPage:async()=>({token:token.target,holders:2,supply:'2',as_of:{rollup_bucket:1,tail_from_block:1},page:[wallet,recipient.target].map(wallet=>({wallet,balance:'1'})),next_cursor:null})});
 const snapshotPolicy={schema:'holder-snapshot-policy-v1',scopeId:identity(scope),semantics:'reviewed-nonproxy-erc20-supply-sum',tokenCodeHash:keccak256(await provider.getCode(token.target)),maxHolders:5,maxRpcCalls:13,maxAgeSeconds:600};
 const {proof}=await admitHolderSnapshot({provider,candidate,policy:snapshotPolicy,scope,period:1,dueAt:block.timestamp,until:block.timestamp+2592000,now:block.timestamp+1});
 const args={scope,candidate,proof,snapshotPolicy,exclusions:[],budget:'11',vault:vault.target,instance};
 const plan=planHolderAllocation(args);assert.equal(plan.allocated,'10');assert.equal(plan.remainder,'1');
 assert.throws(()=>planHolderAllocation({...args,proof:{...proof,balancesHash:'bad'}}),/commitment/);
 const open=p=>vault.openRound(p.period,p.snapshot,p.commitment,p.budget,p.count);
 const append=(p,start,end)=>vault.append(p.period,start,p.allocations.slice(start,end).map(h=>h.wallet),p.allocations.slice(start,end).map(h=>h.amount));
 assert.equal((await inspectAllocationPublication(vault,plan)).status,'not-started');
 await assert.rejects(vault.connect(other).openRound(1,plan.snapshot,plan.commitment,11,2));
 if(managed){
  await assert.rejects(vault.setPublicationsPaused(true));
  await assert.rejects(control.setPublisher(wallet));
  await tx(control.setPublicationsPaused(true));
  await assert.rejects(open(plan));
  await assert.rejects(vault.append(1,0,[wallet],[1]));await assert.rejects(vault.seal(1));
  for(const invalid of [ZeroAddress,controllerAddress,vault.target])await assert.rejects(control.setPublisher(invalid));
  await tx(control.setPublicationsPaused(false));
 }
 await tx(open(plan));await assert.rejects(open(plan));await assert.rejects(vault.seal(1));
 await tx(append(plan,0,1));await assert.rejects(append(plan,0,1));
 await assert.rejects(vault.pay(wallet,[1]));
 assert.deepEqual(await inspectAllocationPublication(vault,JSON.parse(JSON.stringify(plan))),{status:'partial',offset:1});
 await assert.rejects(inspectAllocationPublication(vault,{...plan,commitment:'0x'+'a'.repeat(64)}),/Conflicting/);
 await tx(append(plan,1,2));await tx(vault.seal(1));await assert.rejects(vault.seal(1));
 assert.equal(await vault.available(),95n);await assert.rejects(vault.pay(wallet,[1]));
 report.checks.push('Admitted fixed-block snapshot -> weighted allocation; dust retained; publisher, duplicate, partial, commitment and restart gates');
 // A second local period adds to debts. Dates are synthetic; no live schedule chosen.
 const plan2=planHolderAllocation({...args,proof:{...proof,period:2},budget:'20'});
 await tx(open(plan2));await tx(append(plan2,0,2));await tx(vault.seal(2));
 if(managed)await tx(control.setPublicationsPaused(true));
 const before=await provider.getBalance(wallet);
 await tx(vault.pay(wallet,[1,2]));assert.equal(await provider.getBalance(wallet)-before,15n);
 await assert.rejects(vault.pay(wallet,[1,2]));await assert.rejects(vault.pay(recipient.target,[1,1]));
 await assert.rejects(vault.pay(recipient.target,[1,2]));assert.equal(await vault.consolidated(1,recipient.target),false);assert.equal(await vault.totalPaid(),15n);
 await tx(recipient.setup(false,true,vault.target));await tx(vault.connect(other).pay(recipient.target,[1,2]));
 assert.equal(await recipient.received(),15n);assert.equal(await vault.totalPaid(),30n);assert.equal(await vault.totalAllocated(),30n);
 assert.equal(await vault.available(),75n);assert.equal(await vault.solvent(),true);
 report.checks.push('Two-period dust aggregation; fixed beneficiary; permissionless gas sponsorship; recipient refusal keeps debt; retry and reentrancy protection');
 if(managed)await tx(control.setPublicationsPaused(false));
 // Empty positive entitlements (all floor to zero) return the entire budget.
 const tiny=planHolderAllocation({...args,proof:{...proof,period:3},budget:'1'});assert.equal(tiny.count,0);
 await tx(open(tiny));await tx(vault.seal(3));assert.equal(await vault.available(),75n);
 // Excluding a holder from future rounds never removes earlier unpaid rights.
 const fourth=planHolderAllocation({...args,proof:{...proof,period:4},budget:'20'});
 await tx(open(fourth));await tx(append(fourth,0,2));await tx(vault.seal(4));
 const fifth=planHolderAllocation({...args,proof:{...proof,period:5},exclusions:[wallet],budget:'10'});
 await tx(open(fifth));await tx(append(fifth,0,1));await tx(vault.seal(5));
 await tx(vault.consolidate(wallet,[4]));await tx(vault.consolidate(wallet,[4]));
 assert.equal(await vault.credit(wallet),10n);await tx(vault.pay(wallet,[]));assert.equal(await vault.consolidated(4,wallet),true);
 assert.equal(await vault.credit(wallet),0n);
 await assert.rejects(vault.openRound(7,plan.snapshot,plan.commitment,1,1));
 await assert.rejects(vault.openRound(6,plan.snapshot,plan.commitment,1000,1));
 report.checks.push('Zero-rounded period releases budget; later exclusion preserves old debt; skipped periods and overspending rejected');
 if(managed){
  const next=await provider.getSigner(8),nextAddress=await next.getAddress();
  await assert.rejects(control.renounceOwnership());
  await assert.rejects(control.transferOwnership(owner));
  await tx(control.transferOwnership(nextAddress));
  assert.equal(await vault.owner(),controllerAddress);
  await assert.rejects(vault.acceptOwnership());
  await tx(control.setPublicationsPaused(true));
  await assert.rejects(control.setPublisher(nextAddress));
  await tx(vault.connect(next).acceptOwnership());
  await assert.rejects(control.setPublicationsPaused(false));
  await tx(vault.connect(next).setPublisher(wallet));
  await tx(vault.connect(next).setPublicationsPaused(false));
  await assert.rejects(open(fifth));
  assert.equal(await vault.publisher(),wallet);
  assert.equal(await vault.totalPaid(),40n);
  assert.equal(await vault.entitlement(4,recipient.target),10n);
  const proxy=await deploy(fixtures.contracts['PayoutFixtures.sol'].OwnerProxy);
  await tx(vault.connect(next).transferOwnership(proxy.target));
  await tx(proxy.act(vault.target,vault.interface.encodeFunctionData('acceptOwnership')));
  assert.equal(await vault.owner(),proxy.target);
  await tx(proxy.act(vault.target,vault.interface.encodeFunctionData('setPublicationsPaused',[true])));
  assert.equal(await vault.publicationsPaused(),true);
  report.checks.push('Managed roles: unauthorized control denied, pause blocks all publication methods but permits old claims; separate owner/publisher; two-step owner transfer; no renunciation; role replacement preserves debts');
 }
 report.status='PASS';
}finally{writeFileSync(root+'/report.json',JSON.stringify(report,null,2));provider.destroy();console.log(root+'/report.json',report.status);}
