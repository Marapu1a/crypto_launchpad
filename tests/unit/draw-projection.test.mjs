import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Interface,id,keccak256} from 'ethers';
import {compileDrawPrograms} from '../../src/worker/draw-build.mjs';
import {qianqiPreset} from '../../src/draws/config.mjs';
import {upgradeProgramDraft} from '../../src/draws/program-config.mjs';
import {buildDrawSnapshot} from '../../server/short-runtime/draw-projection.mjs';
import {digest} from '../../src/tickets/digest.mjs';
const build=compileDrawPrograms(),hash=id('head'),code='0x6000',address=n=>'0x'+n.toString(16).padStart(40,'0');
function fixture(bps,cycle=0n){
 const raw=qianqiPreset();raw.short.enabled=bps>0;raw.monthly.enabled=bps<10000;const config=upgradeProgramDraft(raw,bps);
 const roles=['quote','token','hook','factory','router','curve','escrow','collector','splitter','recognition','fundingRouter',...(bps>0?['short','shortAdapter']:[]),...(bps<10000?['monthly','monthlyAdapter']:[])];
 const policy={schema:'draw-production-policy-v2',chainId:4663,projectId:'a5897d1a-def5-4c9f-a7bb-a76f2b16519e',executor:address(90),publisher:address(91),buildHash:build.manifest.buildHash,anchor:{number:1,hash},contracts:Object.fromEntries(roles.map((k,i)=>[k,{address:address(i+1),codeHash:keccak256(code)}])),limits:{maxGasPrice:'1',maxGasLimit:'1',nativeFloor:'1'},timing:{lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30},template:{schema:'draw-template-v2',instanceId:id('instance'),config,team:address(92),operations:address(93),creatorTaxBps:200}};
 const state={identity:digest(policy),pending:{raw:'secret-raw'},runtime:{schema:'draw-runtime-v2',ledger:{head:{number:2,hash},events:[],confirmations:[],bundles:{},evidence:{}},cycles:Object.fromEntries(['short','monthly'].map(k=>[k,cycle?{'1':{participantsHash:hash,budget:'50'}}:{}]))}};
 const provider={getBlock:async n=>({number:n==='finalized'?3:n,hash,timestamp:100}),getCode:async()=>code,call:async r=>{assert.equal(r.blockTag,2);const monthly=r.to.toLowerCase()===policy.contracts.monthly?.address;const abi=new Interface(build.artifacts[monthly?'MonthlyProgram':'ShortProgram'].abi),name=abi.parseTransaction(r).name;return abi.encodeFunctionResult(name,name==='draws'?[hash,hash,hash,50n,0n,true]:[{freeFund:50n,freeNext:20n,nextTarget:100n,liabilities:0n,cycle,pending:false,lastTerminal:10n}[name]]);}};
 return {provider,policy,state};
}
test('Public v2 projection supports each mode, exact split/Next and no private fields',async()=>{
 for(const bps of [0,7000,10000]){const f=fixture(bps),s=await buildDrawSnapshot({...f,metadata:{symbol:'TOK',privateKey:'secret-key'}});assert.equal(s.draws.length,bps===7000?2:1);assert.ok(!JSON.stringify(s).includes('secret'));assert.equal(s.draws.reduce((n,d)=>n+d.settings.allocationBps,0),10000);const m=s.draws.find(d=>d.kind==='monthly');if(m){assert.equal(m.nextFundRaw,'20');assert.equal(m.nextEligibleAt,'2592010');assert.deepEqual(m.settings.weights,[1]);}}
});
test('Projection rejects unfinalized cursor, changed code and wrong runtime identity',async()=>{
 const a=fixture(7000);a.provider.getBlock=async n=>({number:n==='finalized'?1:n,hash,timestamp:100});await assert.rejects(buildDrawSnapshot(a),/finalized/);
 const b=fixture(7000);b.provider.getCode=async()=> '0x6001';await assert.rejects(buildDrawSnapshot(b),/runtime changed/);
 const c=fixture(7000);c.state.identity='bad';await assert.rejects(buildDrawSnapshot(c),/source/);
});

test('Settled no-winner snapshots remain distinct and mismatched frozen budgets fail',async()=>{
 const f=fixture(7000,1n),s=await buildDrawSnapshot(f);assert.equal(s.draws.length,2);
 for(const d of s.draws){assert.equal(d.draw.settled,true);assert.equal(d.draw.awardedRaw,'0');}
 f.state.runtime.cycles.monthly['1'].budget='51';await assert.rejects(buildDrawSnapshot(f),/snapshot missing/);
});
