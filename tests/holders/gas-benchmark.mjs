import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {AbiCoder,BrowserProvider,ContractFactory,keccak256,toUtf8Bytes} from 'ethers';
import {compileHolderPayout} from '../../src/holders/build.mjs';
import {compileProduction} from '../../src/worker/production-build.mjs';
process.env.HARDHAT_CONFIG=resolve('tests/contracts/production-worker-hardhat.config.cjs');
const {default:hre}=await import('hardhat');
const provider=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
const root='.local/test-results/holder-gas-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});
const report={status:'FAIL',date:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases:[],limits:['Local Cancun EVM, synthetic allocations, no remote RPC or real funds','Allocation gas measured in full; total payout gas extrapolated from named samples','Excludes deployment, snapshot acquisition, provider charges and chain-specific data fees','EOA recipients only; contract recipient execution may cost more']};
const abi=AbiCoder.defaultAbiCoder(),minimum=500000000000000n;
try{
 const build=compileHolderPayout({managed:true});report.build=build.manifest;
 const fixtures=compileProduction({'GasSource.sol':{content:'pragma solidity ^0.8.24; interface V {function fund(uint256) external payable returns(uint256);} contract Source {address public holderFund;bytes32 public instance;constructor(address v,bytes32 i){holderFund=v;instance=i;}function deposit() external payable {V(holderFund).fund{value:msg.value}(msg.value);}}'}});
 const signer=await provider.getSigner(0),owner=await (await provider.getSigner(9)).getAddress(),publisher=await signer.getAddress();
 const tx=async p=>(await p).wait();
 const deploy=async(a,args)=>{const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 async function setup(label){const instance=keccak256(toUtf8Bytes(label));const vault=await deploy(build.artifact,[instance,owner,publisher,minimum]);const source=await deploy(fixtures.contracts['GasSource.sol'].Source,[vault.target,instance]);await tx(vault.bindSource(source.target));await tx(source.deposit({value:10n**19n}));return {vault,instance};}
 function wallets(n,label){return Array.from({length:n},(_,i)=>'0x'+keccak256(toUtf8Bytes(label+':'+i)).slice(-40)).sort();}
 async function publish(v,period,ws,amount){const budget=BigInt(ws.length)*amount,snapshot=keccak256(toUtf8Bytes('fixture:'+period));let hash=keccak256(abi.encode(['uint256','address','bytes32','uint256','bytes32','uint256','uint256'],[4663,v.vault.target,v.instance,period,snapshot,budget,ws.length]));for(const w of ws)hash=keccak256(abi.encode(['bytes32','address','uint256'],[hash,w,amount]));const open=(await tx(v.vault.openRound(period,snapshot,hash,budget,ws.length))).gasUsed;const chunks=[];for(let i=0;i<ws.length;i+=100){const part=ws.slice(i,i+100);chunks.push((await tx(v.vault.append(period,i,part,part.map(()=>amount)))).gasUsed);}const seal=(await tx(v.vault.seal(period))).gasUsed;assert.equal((await v.vault.rounds(period)).complete,true);assert.equal(await v.vault.totalAllocated(),budget*BigInt(period));return {open,seal,chunks,total:open+seal+chunks.reduce((a,b)=>a+b,0n),transactions:chunks.length+2};}
 for(const n of [10,100,500,1000,5000]){
  const v=await setup('size:'+n),ws=wallets(n,'size:'+n);const allocation=await publish(v,1,ws,minimum);
  // Existing EOA vs never-funded address; recipient balances are local fixtures.
  await hre.network.provider.send('hardhat_setBalance',[ws[0],'0x1']);await hre.network.provider.send('hardhat_setBalance',[ws[1],'0x1']);
  const firstExisting=(await tx(v.vault.pay(ws[0],[1]))).gasUsed,steadyExisting=(await tx(v.vault.pay(ws[1],[1]))).gasUsed,newAccount=(await tx(v.vault.pay(ws[2],[1]))).gasUsed;
  assert.equal(await v.vault.totalPaid(),minimum*3n);assert.equal(await v.vault.solvent(),true);
  const row={holders:n,allocation,payoutSamples:{firstExisting,steadyExisting,newAccount},estimatedAllExisting:allocation.total+firstExisting+steadyExisting*BigInt(n-1),estimatedAllNew:allocation.total+newAccount*BigInt(n)+firstExisting-steadyExisting};report.cases.push(row);console.log('Measured allocation:',n,'holders,',String(allocation.total),'gas');
 }
 const v=await setup('dust'),ws=wallets(2,'dust');const rounds=[];
 for(let period=1;period<=12;period++)rounds.push(await publish(v,period,ws,minimum/10n));
 await assert.rejects(v.vault.pay(ws[0],[1]));assert.equal(await v.vault.credit(ws[0]),0n);
 const periods=Array.from({length:12},(_,i)=>i+1);const direct=(await tx(v.vault.pay(ws[0],periods))).gasUsed;
 const consolidate=(await tx(v.vault.consolidate(ws[1],periods))).gasUsed,payAfter=(await tx(v.vault.pay(ws[1],[]))).gasUsed;
 assert.equal(await v.vault.totalPaid(),minimum*24n/10n);assert.equal(await v.vault.solvent(),true);
 report.dust={holders:2,periods:12,amountPerPeriod:minimum/10n,rounds,directPay12Periods:direct,separateConsolidate:consolidate,payAfterConsolidate:payAfter,note:'No consolidation transaction needed while waiting; positive per-period entitlement is still stored on chain.'};report.status='PASS';
}catch(error){report.error=error.stack;process.exitCode=1;}finally{writeFileSync(root+'/report.json',JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');provider.destroy();console.log(root+'/report.json',report.status);}
