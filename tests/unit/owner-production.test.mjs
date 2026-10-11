import {test} from 'node:test';
import assert from 'node:assert/strict';
import {keccak256} from 'ethers';
import pins from '../../config/pons-production-pins.json' with {type:'json'};
import {validateProductionProfile,verifyProductionEnvironment} from '../../server/owner-launch/production-profile.mjs';
import {createDrawOwnerCoordinator,withinOwnerReview} from '../../server/owner-launch/draw-coordinator.mjs';
import {signReservedOwnerStep} from '../../src/pons/owner-signing.mjs';

const id='11111111-1111-4111-8111-111111111111',owner='0x0000000000000000000000000000000000000001';
const p={schema:'owner-production-profile-v2',mode:'production',id,chainId:4663,instanceId:'production:'+id,owner,executor:'0x0000000000000000000000000000000000000002',publisher:'0x0000000000000000000000000000000000000003',
 anchor:{number:100,hash:'0x'+'ab'.repeat(32)},externals:pins.pins,timing:{lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30},limits:{maxGasPrice:'100000000000',maxGasLimit:'15000000',nativeFloor:'100000'},funding:{executor:'10000000000000000',publisher:'1000000000000000'},totalNativeLimit:'50000000000000000'};
test('Production profile requires separate non-fixture wallets, reviewed contracts and budgets',()=>{
 assert.equal(validateProductionProfile(p),p);
 for(const change of [{schema:'owner-rehearsal-v2'},{instanceId:'fork'},{owner:'0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'},{executor:owner},{externals:{...p.externals,other:p.externals.factory}},{funding:{executor:p.totalNativeLimit,publisher:'0'}},{timing:{...p.timing,lead:10}}])assert.throws(()=>validateProductionProfile({...p,...change}));
 assert.throws(()=>validateProductionProfile({...p,externals:{...p.externals,router:{...p.externals.router,codeHash:p.anchor.hash}}}));
});
test('Production coordinator cannot arm or retry while operator switch is disabled',async()=>{
 const co=createDrawOwnerCoordinator({profile:p});
 assert.equal(co.info().signingEnabled,false);
 for(const action of ['arm','retry'])await assert.rejects(co.run(id,action),/Public signing is disabled/);
 assert.throws(()=>createDrawOwnerCoordinator({profile:p,allowPublicTransactions:'true'}));
});
test('Backend rejects development node despite matching chain ID',async()=>{
 await assert.rejects(verifyProductionEnvironment({getNetwork:async()=>({chainId:4663n}),send:async()=>'HardhatNetwork'},p),/development node/);
});
test('New blocks may lower gas without invalidating exact reviewed transaction or enlarging caps',()=>{
 const request={from:owner,to:p.executor,data:'0xab',value:'0',chainId:4663,nonce:1,gasLimit:'50000',gasPrice:'100'},reviewed={kind:'bind',request};
 assert.equal(withinOwnerReview({kind:'bind',request:{...request,gasPrice:'99',gasLimit:'49999'}},reviewed,owner),true);
 for(const change of [{gasPrice:'101'},{gasLimit:'50001'},{nonce:2},{data:'0xac'},{to:owner},{value:'1'}])assert.equal(withinOwnerReview({kind:'bind',request:{...request,...change}},reviewed,owner),false);
 assert.equal(withinOwnerReview({...reviewed,kind:'launch'},reviewed,owner),false);
});
function fixture(change={}){
 const calls=[],now=Math.floor(Date.now()/1000),request={from:owner,to:p.executor,data:'0xab',value:'0',chainId:4663,nonce:1,gasLimit:'50000',gasPrice:'100'};
 const state={owner,mode:'production',instanceId:p.instanceId,signingEnabled:true,walletGuard:{anchor:p.anchor,timing:p.timing,externals:Object.fromEntries(Object.entries(p.externals).map(([k,v])=>[k,{...v,codeHash:keccak256('0x6000')}]))},pending:{state:'requesting',request}};
 const wallet={request:async a=>{calls.push(a);if(a.method in change)return change[a.method](a);
  if(a.method==='eth_chainId')return '0x1237';if(a.method==='eth_accounts')return [owner];if(a.method==='web3_clientVersion')return 'Arbitrum Nitro';
  if(a.method==='eth_getBlockByNumber')return {number:'0x64',hash:p.anchor.hash,timestamp:'0x'+now.toString(16)};
  if(a.method==='eth_getCode')return '0x6000';if(a.method==='eth_sendTransaction')return '0x'+'cd'.repeat(32);throw Error('Unexpected wallet method');
 }};return {wallet,state,calls};
}
test('Public wallet signs exact reservation after anchor, timing and runtime checks',async()=>{
 const f=fixture();await signReservedOwnerStep(f.wallet,f.state);
 assert.equal(f.calls.filter(c=>c.method==='eth_sendTransaction').length,1);assert.equal(f.calls.filter(c=>c.method==='hardhat_metadata').length,0);
 assert.equal(f.calls.at(-1).params[0].nonce,'0x1');assert.equal(f.calls.at(-1).params[0].gas,'0xc350');
});
test('Public wallet never sends for disabled switch, wrong anchor, stale finality or changed code',async()=>{
 for(const change of [{eth_getBlockByNumber:async()=>null},{web3_clientVersion:async()=>'anvil'},{eth_getCode:async()=>'0x6001'},{eth_getBlockByNumber:async()=>({number:'0x64',hash:p.anchor.hash,timestamp:'0x1'})},{eth_accounts:async()=>[p.executor]}]){
  const f=fixture(change);await assert.rejects(signReservedOwnerStep(f.wallet,f.state));assert.ok(!f.calls.some(c=>c.method==='eth_sendTransaction'));
 }
 const f=fixture();f.state.signingEnabled=false;await assert.rejects(signReservedOwnerStep(f.wallet,f.state));assert.ok(!f.calls.some(c=>c.method==='eth_sendTransaction'));
});
