const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {ethers}=require('ethers'),hre=require('hardhat');
const vector=require('../research/drand-feasibility/vector.json').beacon,target=1727521075+(vector.round-1)*3;
hre.config.networks.hardhat.initialDate=new Date((target-40*86400)*1000).toISOString();
const compiled=require('../scripts/compile.cjs').compile();
const {fixture,sent,rpc}=require('./fixtures/local-controllers.cjs');
const {runDrandDelivery}=require('../scripts/drand-delivery-worker.cjs');
async function setup({due=true}={}){
 const f=await fixture(compiled,{drandTiming:[3600,30,5,1800,15]});await f.fundExecution();
 await rpc('evm_setNextBlockTimestamp',[target-4000]);await rpc('evm_mine');
 const short=await f.prepare('worker short'),month=await f.prepare('worker month','MONTHLY');
 await rpc('evm_setNextBlockTimestamp',[target-3601]);await rpc('evm_setAutomine',[false]);
 try{const a=await f.short.seal(short.proposalId,{gasLimit:2500000}),b=await f.monthly.sealMonth(month.drawId,{gasLimit:2500000});await rpc('evm_mine');await a.wait();await b.wait();}finally{await rpc('evm_setAutomine',[true]);}
 const anchor=await f.provider.getBlock('latest'),job={schema:'local-drand-delivery-v1',chainId:31337,adapter:f.random.target,short:f.short.target,monthly:f.monthly.target,anchor:{number:anchor.number,hash:anchor.hash},maxGasPrice:'1000000000000',nativeFloor:'1000000000000',gasUnits:{prove:'400000',deliver:'300000'},pollSeconds:10};
 for(const [k,c]of [['adapter',f.random],['short',f.short],['monthly',f.monthly]])job[k+'CodeHash']=ethers.keccak256(await f.provider.getCode(c.target));
 fs.mkdirSync('.local/logs',{recursive:true});const statePath=path.join(fs.mkdtempSync(path.resolve('.local/logs/drand-worker-')),'state.json');
 if(due){await rpc('evm_setNextBlockTimestamp',[target+10]);await rpc('evm_mine');}
 const options={provider:f.provider,adapter:f.random.connect(f.provider),executor:f.executor,job,statePath};
 return {...f,job,options,ids:[await f.short.drawRequest(short.drawId),await f.monthly.drawRequest(month.drawId)]};
}
const beacon=async round=>{assert.equal(round,String(vector.round));return vector;};
test('Pons estimated transaction policy bypasses standalone floor, waits without intent and resumes',async()=>{
 const f=await setup();f.options.job.nativeFloor=String(10n**30n);
 const state={},notifications=[];let funded=false;
 const proxy={getBalance:async address=>funded?f.provider.getBalance(address):0n};
 const gas=require('../scripts/pons-gas-budget.cjs').createGasBudget({provider:proxy,sender:await f.executor.getAddress(),maxGasLimit:'3000000',state,save:()=>{},notifications});
 const options={...f.options,transactionGasLimit:gas.gasLimit,transactionEstimateFailed:gas.estimateFailed,transactionGuard:async(request,action)=>gas.check(request,action,(await f.provider.getFeeData()).gasPrice)};
 const first=await runDrandDelivery(options,{getBeacon:beacon});assert.equal(first.status,'waiting');assert.equal(first.steps.length,0);assert(first.requests.every(r=>r.reason==='nativeFunding'));
 assert.equal(fs.existsSync(f.options.statePath),false);const notices=notifications.length;
 await runDrandDelivery(options,{getBeacon:beacon});assert.equal(notifications.length,notices);
 funded=true;const resumed=await runDrandDelivery(options,{getBeacon:beacon});assert.equal(resumed.status,'complete');assert.equal(resumed.steps.length,4);assert(notifications.some(n=>n.type==='nativeFundingAvailable'));
 const again=await runDrandDelivery(options,{getBeacon:beacon});assert.equal(again.steps.length,0);
});
function faulty(f,kind){
 const real=f.random.connect(f.executor),reader=f.random.connect(f.provider);let once=true;
 const wrap=name=>{const method=async(...args)=>{const tx=await real[name](...args);if(once){once=false;if(kind==='unknown')throw Object.assign(Error('lost hash'),{code:'ECONNRESET'});return {hash:tx.hash,nonce:tx.nonce,wait:async()=>{throw Object.assign(Error('timeout'),{code:'TIMEOUT'});}};}return tx;};method.estimateGas=real[name].estimateGas;method.populateTransaction=real[name].populateTransaction;method.fragment=real[name].fragment;return method;};
 return new Proxy(reader,{get(t,k){if(k==='connect')return ()=>({prove:wrap('prove'),deliver:wrap('deliver')});return Reflect.get(t,k);}});
}
test('delivery discovers both real controllers, verifies exact rounds, delivers and rerun sends nothing',async()=>{
 const f=await setup();let r=await runDrandDelivery(f.options,{getBeacon:beacon});assert.equal(r.status,'complete');assert.deepEqual(r.steps.map(s=>s.action),['prove','deliver','prove','deliver']);
 for(const id of f.ids)assert.equal((await f.random.requests(id)).delivered,true);
 const nonce=await f.provider.getTransactionCount(await f.executor.getAddress());r=await runDrandDelivery(f.options,{getBeacon:async()=>{throw Error('not needed');}});assert.equal(r.status,'complete');assert.equal(r.steps.length,0);assert.equal(await f.provider.getTransactionCount(await f.executor.getAddress()),nonce);
 assert(!JSON.parse(fs.readFileSync(f.options.statePath)).pending);
});
test('delivery waits before round, isolates missing beacon, and delivers already proven old request offline',async()=>{
 const f=await setup({due:false});let fetched=0;
 let r=await runDrandDelivery(f.options,{getBeacon:async()=>{fetched++;throw Error('offline');}});assert.equal(r.status,'waiting');assert.equal(fetched,0);
 await rpc('evm_setNextBlockTimestamp',[target+10]);await rpc('evm_mine');await sent(f.random.prove(f.ids[1],'0x'+vector.signature));
 r=await runDrandDelivery(f.options,{getBeacon:async()=>{throw Error('offline');}});assert.equal(r.status,'waiting');assert.deepEqual(r.steps.map(s=>s.action),['deliver']);assert.equal((await f.random.requests(f.ids[0])).proven,false);assert.equal((await f.random.requests(f.ids[1])).delivered,true);
 r=await runDrandDelivery(f.options,{getBeacon:beacon});assert.equal(r.status,'complete');
});
test('delivery rejects wrong round and forged signatures before paying gas',async()=>{
 const f=await setup();for(const bad of [{...vector,round:vector.round+1},{...vector,signature:'00'.repeat(64)}]){
  const r=await runDrandDelivery(f.options,{getBeacon:async()=>bad});assert.equal(r.status,'degraded');assert.equal(r.steps.length,0);assert.equal(r.failures.length,2);assert(!fs.existsSync(f.options.statePath));
 }
});
test('delivery known hash reconciles after restart without re-proving the first request',async()=>{
 const f=await setup();let r=await runDrandDelivery({...f.options,adapter:faulty(f,'timeout')},{getBeacon:beacon});assert.equal(r.reason,'pendingReceipt');
 r=await runDrandDelivery(f.options,{getBeacon:beacon});assert.equal(r.status,'complete');assert.deepEqual(r.steps.map(s=>s.action),['deliver','prove','deliver']);assert(!JSON.parse(fs.readFileSync(f.options.statePath)).pending);
});
test('delivery unknown hash stops all new sends despite mined proof',async()=>{
 const f=await setup();let r=await runDrandDelivery({...f.options,adapter:faulty(f,'unknown')},{getBeacon:beacon});assert.equal(r.status,'blocked');
 const nonce=await f.provider.getTransactionCount(await f.executor.getAddress());r=await runDrandDelivery(f.options,{getBeacon:beacon});assert.equal(r.reason,'unknownHash');assert.equal(await f.provider.getTransactionCount(await f.executor.getAddress()),nonce);
});
test('delivery gas/native shortages wait without intent and resume after top-up',async()=>{
 const f=await setup(),address=await f.executor.getAddress();await rpc('hardhat_setBalance',[address,'0x0']);
 let r=await runDrandDelivery(f.options,{getBeacon:beacon});assert.equal(r.reason,'nativeFunding');assert(!fs.existsSync(f.options.statePath));await rpc('hardhat_setBalance',[address,'0xde0b6b3a7640000']);
 r=await runDrandDelivery({...f.options,job:{...f.job,maxGasPrice:'1'}},{getBeacon:beacon});assert.equal(r.reason,'gasPrice');
 r=await runDrandDelivery(f.options,{getBeacon:beacon});assert.equal(r.status,'complete');
});
test('delivery callback rejection preserves seed and does not suppress other controller',async()=>{
 const f=await setup(),reader=f.random.connect(f.provider),real=f.random.connect(f.executor);
 const deliver=async(...args)=>real.deliver(...args);deliver.fragment=real.deliver.fragment;deliver.populateTransaction=real.deliver.populateTransaction;
 deliver.estimateGas=async(...args)=>{if(args[0]===f.ids[0])throw Object.assign(Error('callback revert'),{code:'CALL_EXCEPTION'});return real.deliver.estimateGas(...args);};
 const wrapped=new Proxy(reader,{get(t,k){if(k==='connect')return ()=>({prove:real.prove,deliver});return Reflect.get(t,k);}});
 let r=await runDrandDelivery({...f.options,adapter:wrapped},{getBeacon:beacon});assert.equal(r.status,'degraded');assert.equal(r.failures[0].reason,'callbackRejected');
 const saved=await f.random.requests(f.ids[0]);assert.equal(saved.proven,true);assert.equal(saved.delivered,false);assert.equal((await f.random.requests(f.ids[1])).delivered,true);
 r=await runDrandDelivery(f.options,{getBeacon:async()=>{throw Error('offline');}});assert.equal(r.status,'complete');assert.deepEqual(r.steps.map(s=>s.action),['deliver']);assert.equal((await f.random.requests(f.ids[0])).seed,saved.seed);
});
test('delivery rejects runtime changes and cannot clear a pending receipt from another transaction',async()=>{
 const f=await setup();let r=await runDrandDelivery({...f.options,job:{...f.job,adapterCodeHash:ethers.ZeroHash}},{getBeacon:beacon});assert.equal(r.status,'error');assert.equal(r.steps.length,0);
 r=await runDrandDelivery({...f.options,adapter:faulty(f,'timeout')},{getBeacon:beacon});assert.equal(r.reason,'pendingReceipt');
 const state=JSON.parse(fs.readFileSync(f.options.statePath));state.pending.nonce++;delete state.checksum;state.checksum=require('../scripts/direct-buy.cjs').hash(state);fs.writeFileSync(f.options.statePath,JSON.stringify(state));
 r=await runDrandDelivery(f.options,{getBeacon:beacon});assert.equal(r.reason,'unconfirmedReceipt');assert.equal(r.steps.length,0);
});
test('preflight fallback is restricted to exact local fixture, never public or unknown code/profile',async()=>{
 const {drandPreflight,LOCAL_FIXTURE_CODE_HASH}=require('../scripts/drand-preflight.cjs'),code='0x'+compiled.LocalRandomFixture.evm.deployedBytecode.object;
 assert.equal(ethers.keccak256(code),LOCAL_FIXTURE_CODE_HASH);
 const source={randomProvider:async()=>ethers.getAddress('0x'+'12'.repeat(20))};
 const provider=(chainId,bytecode=code,result=null)=>({call:async()=>{if(result)return result;throw Object.assign(Error('no selector'),{code:'CALL_EXCEPTION',data:'0x'});},getNetwork:async()=>({chainId}),getCode:async()=>bytecode});
 assert.equal(await drandPreflight(provider(31337n),source),null);
 await assert.rejects(drandPreflight(provider(4663n),source),/Missing RNG profile/);
 await assert.rejects(drandPreflight(provider(31337n,'0x6000'),source),/Missing RNG profile/);
 await assert.rejects(drandPreflight(provider(31337n,code,ethers.ZeroHash),source),/Unknown RNG profile/);
});
