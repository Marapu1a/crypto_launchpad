const {test}=require('node:test'),assert=require('node:assert/strict'),{ethers}=require('ethers');
const {fixture}=require('./fixtures/pons-public-profile.cjs'),{createGuard}=require('../scripts/pons-public-execution.cjs');
const {hash}=require('../scripts/direct-buy.cjs');
const compiled={DualControllerPromoVault:{abi:['function claim(bytes32,address)']},DrandRandomAdapter:{abi:['function prove(uint256,bytes)','function deliver(uint256)']},RobinhoodShortController:{abi:['function begin(bytes32)','function finishShort(bytes32)','function checkpointCutoff(uint256)']},RobinhoodMonthlyController:{abi:['function finishMonth(bytes32)','function checkpointCutoff(uint256)']},LocalPonsCollector:{abi:['function pull()','function pay(address)']}};
function setup(){const f=fixture();f.c.schema='pons-public-automation-v1';delete f.c.instanceId;f.p.configHash=hash(f.c);
 const original=f.provider.getBlock;f.provider.getBlock=async n=>({...await original(n),timestamp:Math.floor(Date.now()/1000)});
 const guard=createGuard({provider:f.provider,config:f.c,publicProfile:f.p,compiled});
 const request=(kind,method,args=[])=>({to:kind==='vault'?f.c.vault:kind==='collector'?f.c.collector:f.c.lifecycle.source,chainId:4663,from:f.c.executor,data:new ethers.Interface(compiled[kind==='vault'?'DualControllerPromoVault':kind==='collector'?'LocalPonsCollector':'RobinhoodShortController'].abi).encodeFunctionData(method,args)});
 return {...f,guard,request};}
test('public guard allows matched funding; policy drift blocks it without stranding a claim',async()=>{
 const f=setup();await f.guard(f.request('collector','pull'),'pull');
 f.add('short','owner','address',ethers.ZeroAddress);
 await assert.rejects(f.guard(f.request('collector','pull'),'pull'),/admission blocked/);
 await f.guard(f.request('vault','claim',[ethers.id('draw'),f.c.executor]),'claim');
});
test('public guard checks target, selector, sender, chain, value and fee recipient',async()=>{
 for(const mutate of [r=>r.to=ethers.ZeroAddress,r=>r.chainId=1,r=>r.from=ethers.ZeroAddress,r=>r.value=1,r=>r.authorizationList=[],r=>r.data='0x12345678']){
  const f=setup(),r=f.request('collector','pull');mutate(r);await assert.rejects(f.guard(r,'pull'));
 }
 const f=setup();await assert.rejects(f.guard(f.request('collector','pay',[ethers.ZeroAddress]),'pay'),/recipient/);
 await assert.rejects(f.guard(f.request('collector','pull'),'claim'),/not allowed/);
});
test('obligation runtime or anchor drift and unavailable RPC prohibit any claim',async()=>{
 for(const change of [f=>f.provider.getCode=async()=> '0x',f=>f.provider.getBlock=async()=>null,f=>f.add('vault','quoteToken','address',ethers.ZeroAddress)]){
  const f=setup();change(f);await assert.rejects(f.guard(f.request('vault','claim',[ethers.id('draw'),f.c.executor]),'claim'));
 }
});
test('public config cannot reuse a rehearsal identity or omit index policy',()=>{
 const f=setup(),validate=require('../scripts/pons-automation.cjs').validate;
 validate(f.c,{publicMode:true});assert.throws(()=>validate(f.c));
 f.c.instanceId=ethers.ZeroHash;assert.throws(()=>validate(f.c,{publicMode:true}));delete f.c.instanceId;delete f.c.indexer;assert.throws(()=>validate(f.c,{publicMode:true}));
});
test('public CLI rejects missing/unsafe inputs without echoing credential material',()=>{
 const {spawnSync}=require('node:child_process');
 const r=spawnSync(process.execPath,['scripts/run-pons-public.cjs','--config','missing','--profile','missing','--state','unused','--keystore','missing'],{encoding:'utf8',env:{...process.env,RH_RPC_URL:'http://example.invalid/secret-url',QIANQI_KEYSTORE_PASSWORD:'secret-password'}});
 assert.equal(r.status,1);assert(!r.stderr.includes('secret-'));assert.match(r.stderr,/execution stopped/);
});
test('public network requires an explicit guard and HTTPS; legacy inspect cannot send',async()=>{
 const network=require('../scripts/runtime-network.cjs');
 await assert.rejects(network.withRobinhoodNetwork({mode:'robinhood-public',rpcUrl:'https://example.invalid'},()=>{}),/guard required/);
 await assert.rejects(network.withRobinhoodNetwork({mode:'robinhood-public',rpcUrl:'http://127.0.0.1:8545',publicGuard:async()=>{}},()=>{}),/HTTPS/);
 assert.equal(network.current().mode,'local');
});
test('admission refusal survives receipt wrapping and CLI diagnostics omit raw provider errors',async()=>{
 const {sendLocalTransaction,withTransactionBoundary}=require('../scripts/local-receipt.cjs');
 const method=async()=>assert.fail('must not broadcast');method.fragment={name:'pull'};method.populateTransaction=async()=>({});
 const boundary={preflight:async()=>{throw Object.assign(Error('Public admission blocked'),{code:'PONS_PUBLIC_ADMISSION',admissionReasons:['finalityLag']});}};
 await assert.rejects(withTransactionBoundary(boundary,()=>sendLocalTransaction(method,[],{})),e=>e.stage==='estimate'&&e.code==='PONS_PUBLIC_ADMISSION'&&e.admissionReasons[0]==='finalityLag');
 const d=require('../scripts/run-pons-public.cjs').diagnostics({results:{scheduler:{results:{SHORT:{status:'error',code:'PONS_PUBLIC_ADMISSION',admissionReasons:['finalityLag'],message:'https://private-rpc/secret'}}}}});
 assert.deepEqual(d.failures,[{lane:'scheduler',kind:'SHORT',code:'PONS_PUBLIC_ADMISSION',admission:['finalityLag']}]);assert(!JSON.stringify(d).includes('secret'));
});

test('recognition confirm cannot use the public send path while publication is disabled',async()=>{
 const f=setup(),r=require('./fixtures/purchase-recognition.cjs').fixture().recognition;f.c.recognition={...r,publisher:f.c.executor};f.c.recognitionPublishing={enabled:false};f.p.configHash=hash(f.c);
 const guard=createGuard({provider:f.provider,config:f.c,publicProfile:f.p,compiled}),data=require('../scripts/purchase-recognition.cjs').ABI.encodeFunctionData('confirm',[ethers.id('batch'),1]);
 await assert.rejects(guard({to:r.source,chainId:4663,from:f.c.executor,value:0,data},'confirm'),/disabled/);
});

test('permissionless checkpoint checks immutable target without spending its block window on unrelated policy reads',async()=>{
 const f=setup();let calls=0;f.provider.call=async()=>{calls++;throw Error('full profile must not run for hash capture');};
 await f.guard(f.request('short','checkpointCutoff',[f.head.number-1]),'checkpointCutoff');assert.equal(calls,0);
 const req={...f.request('short','checkpointCutoff',[f.head.number-1]),to:f.c.lifecycle.monthlySource};
 await f.guard(req,'checkpointCutoff');
 f.provider.getCode=async()=> '0x02';await assert.rejects(f.guard(req,'checkpointCutoff'),/runtime mismatch/);
});

test('checkpoint refuses expired/future heights, wrong chain and changed branch before sending',async()=>{
 for(const n of [0,256,-1]){
  const f=setup();await assert.rejects(f.guard(f.request('short','checkpointCutoff',[f.head.number-n]),'checkpointCutoff'),e=>e.code==='LOCAL_BUDGET_WAIT'&&e.budget.reason==='cutoffWindow');
 }
 const f=setup();f.provider.getNetwork=async()=>({chainId:1n});await assert.rejects(f.guard(f.request('short','checkpointCutoff',[f.head.number-1]),'checkpointCutoff'),/chain/);
 const g=setup(),read=g.provider.getBlock;g.provider.getBlock=async n=>({...await read(n),...(n==='latest'?{}:{hash:ethers.id('changed')})});
 await assert.rejects(g.guard(g.request('short','checkpointCutoff',[g.head.number-1]),'checkpointCutoff'),/observation changed/);
});

test('public diagnostics retain safe action/stage/revert categories without provider messages or URLs',async()=>{
 const {sendLocalTransaction}=require('../scripts/local-receipt.cjs');
 const method=async()=>assert.fail('rejected estimate must not broadcast');method.fragment={name:'seal'};
 method.estimateGas=async()=>{throw Object.assign(Error('https://rpc.invalid/secret'),{code:'CALL_EXCEPTION',data:'0x12345678',info:{error:{message:'insufficient funds for gas https://rpc.invalid/secret'}}});};
 let error;try{await sendLocalTransaction(method,[],{});}catch(e){error=e;}
 assert.equal(error.stage,'estimate');assert.equal(error.action,'seal');assert.equal(error.definiteRejection,true);
 const diagnostics=require('../scripts/run-pons-public.cjs').diagnostics;
 const result=diagnostics({results:{scheduler:{results:{SHORT:{...error,status:'error'}}}}});
 assert.deepEqual(result.failures,[{lane:'scheduler',kind:'SHORT',code:'CALL_EXCEPTION',admission:undefined,stage:'estimate',action:'seal',revertSelector:'0x12345678',rpcReason:'insufficientNative'}]);
 assert(!JSON.stringify(result).includes('secret'));
 const bad=diagnostics({results:{scheduler:{results:{SHORT:{status:'error',stage:'secret',action:'secret',revertSelector:'secret',rpcReason:'secret'}}}}});
 assert(!JSON.stringify(bad).includes('secret'));
});
