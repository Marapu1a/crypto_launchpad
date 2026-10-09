import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {Interface,ZeroHash,keccak256,zeroPadValue} from 'ethers';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {inspectPair,recoveryDecision,sha,inspectNativeBackup} from '../../server/adapters/qianqi/recovery.mjs';
import {inspectRecoveryChain,readOnlyRpc,rpcTransport} from '../../server/adapters/qianqi/recovery-chain.mjs';
const require=createRequire(import.meta.url),{hash}=require('../../server/adapters/qianqi/runtime/scripts/direct-buy.cjs');
const addr=n=>'0x'+n.toString(16).padStart(40,'0'),hex=n=>'0x'+n.toString(16).padStart(64,'0');
test('CLI rejects an unapproved staging root without writing a report outside it',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'q-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'input.json'),output=path.join(root,'output.json');
 fs.writeFileSync(input,JSON.stringify({schema:'qianqi-recovery-input-v1',database:'launchpad_recovery_test',stagingRoot:root,artifacts:[{kind:'database-dump'},{kind:'native-archive'}]}));
 const run=spawnSync(process.execPath,['scripts/recover-qianqi.mjs',input,output],{encoding:'utf8'});
 assert.equal(run.status,1);assert.match(run.stderr,/RECOVERY_STAGING_REQUIRED/);assert.equal(fs.existsSync(output),false);
});
test('native inspection refuses archive corruption, extra state and traversal before reading configuration',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'q-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'state'));fs.writeFileSync(path.join(root,'state','one.json'),'{}');
 const write=files=>fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({schema:'qianqi-offline-backup-v1',files}));
 write({'one.json':'0'.repeat(64)});assert.throws(()=>inspectNativeBackup({root}),e=>e.code==='NATIVE_ARCHIVE_CHECKSUM');
 write({'one.json':sha('{}')});fs.writeFileSync(path.join(root,'state','unexpected.lock'),'owner');
 assert.throws(()=>inspectNativeBackup({root}),e=>e.code==='NATIVE_EXTRA_OR_MISSING_FILES');
 write({'../escape.json':sha('{}')});assert.throws(()=>inspectNativeBackup({root}),e=>e.code==='UNSAFE_RESTORE_PATH');
});
test('a reconstructed historical snapshot stays stale even with a fresh observation timestamp',()=>{
 const f=require('../shared/qianqi-api-fixture.cjs')(),s=JSON.parse(f.raw);delete s.checksum;
 s.status.state='recoverySnapshot';s.index.observedAt=new Date().toISOString();
 const api=require('../../server/adapters/qianqi/runtime/scripts/user-status-api.cjs');
 const view=api.prepare(f.config,JSON.stringify({...s,checksum:hash(s)}));
 assert.equal(api.render(f.config,view,{}).status,'stale');
});
function pairFixture(){
 const binding={projectId:'dddddddd-1111-4111-8111-111111111111',chainId:'4663',sender:addr(1),token:addr(2),indexConfigHash:hex(3)};
 const text=JSON.stringify({schema:'qianqi-public-view-v1',view:{ledger:{head:{number:90,hash:hex(90)}},credits:[{creditedAt:80}],rewards:[{status:'assigned'}]}});
 const native={binding,evidence:{bindingHash:hash(binding)},projection:{head:{number:90,hash:hex(90)},text,hash:sha(text)}};
 const db={project:{id:binding.projectId,chain_id:4663,token_address:binding.token},executor:{chain_id:4663,sender:binding.sender,binding_hash:hash(binding)},view:{config_hash:binding.indexConfigHash,head_number:90,head_hash:hex(90),view_text:text,view_hash:sha(text)}};
 return {native,db};
}
test('matching pair is read-only reconciled, never an execution permit',()=>{
 const {native,db}=pairFixture();const result=recoveryDecision(inspectPair(native,db),{issues:[]});
 assert.equal(result.status,'READ_ONLY_RECONCILED');assert.equal(result.executionAllowed,false);
});
test('reconstruction may change observation time and metrics, but not evidence mode or creditedAt',()=>{
 const {native,db}=pairFixture();const body=JSON.parse(native.projection.text);
 body.view.index={observedAt:'2026-10-09T20:00:00Z'};body.view.state={status:{state:'caughtUp',metrics:{scanMs:1},evidenceMode:'same'}};
 native.projection.text=JSON.stringify(body);native.projection.hash=sha(native.projection.text);
 body.view.index.observedAt='2026-10-10T00:00:00Z';body.view.state.status.metrics.scanMs=10;
 db.view.view_text=JSON.stringify(body);db.view.view_hash=sha(db.view.view_text);
 assert.deepEqual(inspectPair(native,db).issues,[]);assert.equal(inspectPair(native,db).byteIdentical,false);
 body.view.state.status.evidenceMode='different';db.view.view_text=JSON.stringify(body);db.view.view_hash=sha(db.view.view_text);
 assert(inspectPair(native,db).issues.includes('PAIR_CONTENT_CONFLICT'));
});
test('DB newer/older, same-height reorg, late credit and paid reward cannot silently replace native generation',()=>{
 for(const change of ['newer','older','branch','credit','paid','corrupt','binding']){
  const {native,db}=pairFixture(),body=JSON.parse(db.view.view_text);
  if(change==='newer'||change==='older'){body.view.ledger.head.number+=change==='newer'?1:-1;db.view.head_number=body.view.ledger.head.number;}
  if(change==='branch')body.view.ledger.head.hash=db.view.head_hash=hex(999);
  if(change==='credit')body.view.credits.push({creditedAt:89});
  if(change==='paid')body.view.rewards[0].status='paid';
  db.view.view_text=JSON.stringify(body);db.view.view_hash=sha(db.view.view_text);
  if(change==='corrupt')db.view.view_text='{}';
  if(change==='binding')db.executor.binding_hash=hex(999);
  const result=recoveryDecision(inspectPair(native,db),{issues:[]});
  assert.equal(result.status,'BLOCKED',change);assert.equal(result.executionAllowed,false);
 }
});
test('RPC boundary rejects signing, broadcasting and administrative mutation before transport',async()=>{
 let calls=0;const rpc=readOnlyRpc(async()=>{calls++;return '0x1237';});
 for(const method of ['eth_sendRawTransaction','eth_sendTransaction','eth_sign','personal_unlockAccount','hardhat_setBalance'])await assert.rejects(rpc(method,[]),/WRITE_FORBIDDEN/);
 assert.equal(calls,0);assert.equal(await rpc('eth_chainId',[]),'0x1237');assert.equal(calls,1);
});
function chainFixture(changes={}){
 const p=pairFixture(),code=keccak256('0x01'),pub={reserves:{balance:'100'},timing:{SHORT:{earliestAt:'5'}}};
 const c={executor:addr(1),collector:addr(3),escrow:addr(4),vault:addr(5),codeHashes:{collector:code,escrow:code},manifest:{anchor:{number:1,hash:hex(1)},token:addr(2),quote:addr(6)},lifecycle:{source:addr(7),monthlySource:addr(8),vaultCodeHash:code,sourceCodeHash:code,monthlySourceCodeHash:code},deliveryJob:{adapter:addr(9),adapterCodeHash:code}};
 const resolved={transactionHash:hex(20),blockHash:hex(80),nonce:4,status:1,target:addr(5),data:'0x1234',value:'0'};
 const reward={drawId:hex(30),winner:addr(10),amountRaw:'100',status:'assigned'};
 const native={...p.native,config:c,profile:{quoteImplementation:{address:addr(11),codeHash:code}},indexConfig:{},states:[{lastResolved:resolved},{jobs:{SHORT:[],MONTHLY:[]}},{},{index:{manifest:{},blocks:[],rewards:{rewards:[reward]},publicObservation:pub}}]};
 if(changes.pending)native.states[0].pending={transactionHash:hex(21),nonce:5};
 const compiled={RobinhoodShortController:{abi:['function pendingDatasetDraw() view returns(bytes32)']},RobinhoodMonthlyController:{abi:['function pendingMonth() view returns(bytes32)']},DualControllerPromoVault:{abi:['function reward(bytes32,address) view returns(uint256)']}};
 const interfaces=Object.values(compiled).map(c=>new Interface(c.abi)),calls=[];
 const rpc=readOnlyRpc(async(method,args)=>{
  calls.push(method);
  if(method==='eth_chainId')return '0x1237';
  if(method==='eth_getBlockByNumber'){const n=args[0]==='latest'?100:args[0]==='finalized'?99:Number(BigInt(args[0]));return {number:n,hash:changes.reorg&&n===90?hex(999):hex(n)};}
  if(method==='eth_getTransactionCount')return changes.nonceGap?'0x6':'0x5';
  if(method==='eth_getTransactionReceipt')return args[0]===hex(21)?null:{transactionHash:hex(20),blockNumber:80,blockHash:hex(80),status:1};
  if(method==='eth_getTransactionByHash')return {hash:hex(20),nonce:4,from:addr(1),to:addr(5),input:'0x1234',value:'0x0'};
  if(method==='eth_getCode')return '0x01';
  if(method==='eth_getStorageAt')return zeroPadValue(addr(11),32);
  if(method==='eth_getLogs')return changes.latePurchase?[{transactionHash:hex(22)}]:[];
  if(method==='eth_call')for(const abi of interfaces){const parsed=abi.parseTransaction({data:args[0].data});if(parsed)return abi.encodeFunctionResult(parsed.name,[parsed.name==='reward'?(changes.paid?0n:100n):ZeroHash]);}
  throw Error('unexpected '+method);
 });
 return {native,pair:inspectPair(p.native,p.db),rpc,compiled,calls,options:{observers:{observeRewards:async()=>{},observePublic:async()=>pub}}};
}
test('chain preflight accounts nonce and journals without any signing path',async()=>{
 const f=chainFixture(),r=await inspectRecoveryChain(f.native,f.pair,f.rpc,f.compiled,f.options);
 assert.deepEqual(r.issues,[]);assert.deepEqual(r.nonce,{latest:5,pending:5,expected:5});
 assert(f.calls.includes('eth_getLogs'));assert(f.calls.every(x=>!x.includes('send')&&!x.includes('sign')));
});
test('stale journals, already paid reward, late purchase, pending signed intent and canonical conflict block recovery',async()=>{
 for(const [change,expected]of [['nonceGap','NONCE_NOT_ACCOUNTED_BY_NATIVE_JOURNALS'],['paid','REWARD_ALREADY_PAID_OR_CHANGED'],['latePurchase','UNINDEXED_PROJECT_EVENTS'],['pending','UNRESOLVED_NATIVE_INTENT'],['reorg','NONCANONICAL_NATIVE_HEAD']]){
  const f=chainFixture({[change]:true}),r=await inspectRecoveryChain(f.native,f.pair,f.rpc,f.compiled,f.options);
  assert(r.issues.includes(expected),change);assert.equal(recoveryDecision(f.pair,r).status,'BLOCKED');
 }
});
test('unbounded catch-up is refused rather than treating absence of checks as clear',async()=>{
 const f=chainFixture(),r=await inspectRecoveryChain(f.native,f.pair,f.rpc,f.compiled,{...f.options,maxGap:1});
 assert(r.issues.includes('INDEX_CATCHUP_REQUIRED'));
});
test('missing reward coverage cannot be treated as an empty obligation set',async()=>{
 const f=chainFixture();delete f.native.states[3].index.rewards;
 const r=await inspectRecoveryChain(f.native,f.pair,f.rpc,f.compiled,f.options);
 assert(r.issues.includes('REWARD_SNAPSHOT_MISSING'));
});
test('recovery RPC serializes reads and retries rate limits without exposing provider text',async()=>{
 let calls=0,active=0,peak=0;const waits=[];
 const rpc=rpcTransport('https://private.invalid/secret',{wait:async ms=>waits.push(ms),fetcher:async()=>{
  active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;calls++;
  return calls===1?new Response('private provider detail',{status:429}):new Response(JSON.stringify({result:'0x1237'}));
 }});
 assert.deepEqual(await Promise.all([rpc('eth_chainId',[]),rpc('eth_chainId',[])]),['0x1237','0x1237']);
 assert.equal(peak,1);assert.equal(calls,3);assert(waits.includes(1000));
 const bad=rpcTransport('https://private.invalid/secret',{wait:async()=>{},fetcher:async()=>new Response('secret',{status:403})});
 await assert.rejects(bad('eth_chainId',[]),e=>e.message==='RECOVERY_RPC_UNAVAILABLE'&&!JSON.stringify(e).includes('secret')&&e.rpc.httpStatus===403);
});
