const {test}=require('node:test'),assert=require('node:assert/strict'),{ethers}=require('ethers'),path=require('node:path');
const {hash}=require('../scripts/direct-buy.cjs'),{validate,inspect,pins}=require('../scripts/pons-public-profile.cjs');
const {fixture}=require('./fixtures/pons-public-profile.cjs');

test('Pons public inspection matches explicit graph without authorizing any send',async()=>{
 const f=fixture(),before=JSON.stringify(f.c),r=await f.run();assert.equal(r.status,'matched',JSON.stringify(r));assert.equal(r.publicExecution,false);assert.equal(r.authorizationToFreeze,false);assert.equal(JSON.stringify(f.c),before);
});
test('wrong chain, code, allocation, owner, bindings, timing and unavailable observations close admission',async()=>{
 for(const change of [f=>f.provider.getNetwork=async()=>({chainId:1n}),f=>f.provider.getCode=async()=> '0x02',f=>f.add('collector','policy','tuple(uint64 endsAt,address[3] recipients,uint16[3] bps)',[0,f.c.recipients,[8000,1000,1000]],'uint64'),f=>f.add('short','owner','address',ethers.ZeroAddress),f=>f.add('collector','hook','address',ethers.ZeroAddress),f=>f.head.timestamp=1,f=>f.provider.call=async()=>{throw Error('private RPC key');}]){const f=fixture();change(f);const r=await f.run();assert.equal(r.status,'blocked');assert(!JSON.stringify(r).includes('private'));}
});
test('profile is bound to config and does not accept changed product or policy',()=>{
 const f=fixture();validate(f.p,f.c);f.c.executor=ethers.ZeroAddress;assert.throws(()=>validate(f.p,f.c),/mismatch/);
 const g=fixture();g.p.timing.monthlyInterval='1';assert.throws(()=>validate(g.p,g.c),/interval/);
});
test('missing finality, orphaned anchors and changing observed head refuse a match',async()=>{
 for(const mode of ['missing','anchor','head']){
  const f=fixture(),original=f.provider.getBlock;
  f.provider.getBlock=async n=>{
   if(mode==='missing'&&n==='finalized')return null;
   const b=await original(n);
   if(mode==='anchor'&&n===f.c.manifest.anchor.number)return {...b,hash:ethers.ZeroHash};
   if(mode==='head'&&n===f.head.number)return {...b,hash:ethers.ZeroHash};
   return b;
  };
  assert.equal((await f.run()).status,'blocked',mode);
 }
});
test('CLI refuses missing input without exposing credentials or loading a signer',()=>{
 const {spawnSync}=require('node:child_process');
 const r=spawnSync(process.execPath,['scripts/inspect-pons-public.cjs'],{encoding:'utf8',env:{...process.env,RH_RPC_URL:'https://example.invalid/private-secret'}});
 assert.equal(r.status,1);assert(!r.stderr.includes('private-secret'));assert.match(r.stderr,/inspection refused/);
});

test('dependency inventory records USDG implementation separately from stable proxy runtime',async()=>{
 const {inspect,slot}=require('../scripts/inspect-pons-dependencies.cjs');
 const {ethers}=require('ethers');
 const quote='0x0000000000000000000000000000000000000011',impl='0x0000000000000000000000000000000000000022';
 const provider={getNetwork:async()=>({chainId:4663n}),getBlock:async()=>({number:1,hash:ethers.id('head')}),getCode:async a=>a.toLowerCase()===impl.toLowerCase()?'0x6002':'0x6001',getStorage:async(a,s)=>a===quote&&s===slot('implementation')?ethers.zeroPadValue(impl,32):ethers.ZeroHash,call:async()=>{throw Error('unavailable');}};
 const r=await inspect(provider,{addresses:{hook:quote,quote},hashes:{quote:ethers.keccak256('0x6001')}});
 assert.equal(r.contracts.quote.previousHashMatches,true);
 assert.equal(r.contracts.quote.implementation.runtimeHash,ethers.keccak256('0x6002'));
 assert.equal(r.contracts.quote.getters.owner,null);assert.equal(r.sourceVerification,false);
});
test('dependency inventory rejects wrong chain and changing snapshot',async()=>{
 const {inspect}=require('../scripts/inspect-pons-dependencies.cjs');
 await assert.rejects(inspect({getNetwork:async()=>({chainId:1n})},{addresses:{}}),/Wrong chain/);
 let reads=0;await assert.rejects(inspect({getNetwork:async()=>({chainId:4663n}),getBlock:async()=>({number:1,hash:String(++reads)})},{addresses:{},hashes:{}}),/Snapshot reorg/);
});

test('USDG implementation slot/runtime drift and unavailable storage refuse full and obligation admission',async()=>{
 const {inspectObligations}=require('../scripts/pons-public-execution.cjs');
 for(const mode of ['slot','runtime','unavailable']){
  const f=fixture(),original=f.provider.getCode;
  if(mode==='slot')f.provider.getStorage=async()=>ethers.ZeroHash;
  if(mode==='runtime')f.provider.getCode=async a=>a===f.p.quoteImplementation.address?'0x6002':original(a);
  if(mode==='unavailable')f.provider.getStorage=async()=>{throw Error('secret URL');};
  const r=await f.run();assert.equal(r.status,'blocked');assert(r.reasons.includes('quoteImplementation'));
  await assert.rejects(inspectObligations(f.provider,f.p,f.c));
 }
 const f=fixture();delete f.p.quoteImplementation;assert.throws(()=>validate(f.p,f.c),/implementation pin/);
});
