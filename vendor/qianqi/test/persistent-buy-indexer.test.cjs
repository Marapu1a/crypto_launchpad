const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {keccak256,id}=require('ethers');
const {indexOnce}=require('../scripts/persistent-buy-indexer.cjs');
const {replay,hash}=require('../scripts/direct-buy.cjs');
test('catch-up delay differs from idle and outage backoff',()=>{
 const {nextDelay}=require('../scripts/persistent-buy-indexer.cjs');
 assert.equal(nextDelay({state:'catchingUp'}),0);assert.equal(nextDelay({state:'caughtUp'}),10000);assert.equal(nextDelay(),10000);
});
function fixture(t){
 const e=structuredClone(require('../research/direct-buy/evidence.json'));
 for(const k of Object.keys(e.manifest.codeHashes))e.manifest.codeHashes[k]=keccak256('0x01');
 const config={manifest:e.manifest,buyPolicyMode:'unadmitted'},anchor=Number(BigInt(e.manifest.anchor.number));
 fs.mkdirSync('.local/logs',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.local/logs/index-test-')),statePath=path.join(dir,'state.json');
 t.after(()=>{for(const f of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,f));fs.rmdirSync(dir);});
 const calls=[];let fail=false;
 const rpc=async(method,params=[])=>{
  calls.push([method,params]);if(fail)throw Error('RPC unavailable');
  if(method==='eth_chainId')return '0x'+BigInt(e.manifest.chainId).toString(16);
  if(method==='eth_getCode')return '0x01';
  if(method==='eth_getTransactionReceipt')return e.blocks.flatMap(b=>b.transactions).find(x=>x.tx.hash===params[0]).receipt;
  if(method==='eth_getBlockByNumber'){
   const n=params[0]==='finalized'?Number(BigInt(e.blocks.at(-1).number)):Number(BigInt(params[0]));
   if(n===anchor)return e.manifest.anchor;
   const b=e.blocks.find(b=>Number(BigInt(b.number))===n);assert(b,'missing block '+n);
   return {...b,transactions:params[1]?b.transactions.map(x=>x.tx):[]};
  }throw Error('Unexpected '+method);
 };
 const run=opts=>indexOnce({config,rpc,statePath,...opts}),read=()=>JSON.parse(fs.readFileSync(statePath));
 function append(label){const last=e.blocks.at(-1);e.blocks.push({number:'0x'+(BigInt(last.number)+1n).toString(16),hash:id(label),parentHash:last.hash,timestamp:last.timestamp,transactions:[]});}
 return {e,config,run,read,calls,append,statePath,setFail:v=>{fail=v;}};
}
test('restart reuses evidence without duplicate entries; new blocks catch up in bounded batches',async t=>{
 const f=fixture(t);await f.run();const expected=replay(f.config.manifest,f.e.blocks);assert.equal(f.read().index.ledgerHash,hash(expected));
 f.calls.length=0;await f.run();assert.equal(f.read().index.ledgerHash,hash(expected));assert(!f.calls.some(([m])=>m==='eth_getTransactionReceipt'));
 assert(!f.calls.some(([m,p])=>m==='eth_getBlockByNumber'&&p[1]===true));
 f.append('next1');f.append('next2');f.calls.length=0;
 const partial=await f.run({batchSize:1});assert.equal(partial.state,'catchingUp');assert.equal(partial.metrics.lagBlocks,1);assert.equal(partial.metrics.stateBytes,fs.statSync(f.statePath).size);assert.ok(partial.metrics.totalMs>=partial.metrics.scanMs);assert.equal(f.read().status.metrics.lagBlocks,1);assert.equal((await f.run({batchSize:1})).state,'caughtUp');
 assert.equal(f.read().index.ledgerHash,hash(replay(f.config.manifest,f.e.blocks)));
});
test('RPC outage preserves snapshot and resumes; configuration and checksum changes reject',async t=>{
 const f=fixture(t);await f.run();const before=f.read().index;
 f.setFail(true);await assert.rejects(f.run(),/RPC unavailable/);assert.deepEqual(f.read().index,before);assert.equal(f.read().status.state,'waiting');
 f.setFail(false);await f.run();assert.equal(f.read().status.state,'caughtUp');
 const other=structuredClone(f.config);other.manifest.entryThresholdRaw='1';await assert.rejects(f.run({config:other}),/checksum\/config/);
 const stored=f.read();stored.index.head++;fs.writeFileSync(f.statePath,JSON.stringify(stored));await assert.rejects(f.run(),/checksum/);
});
test('canonical branch replacement recomputes ledger and refuses excessive reorgs',async t=>{
 const f=fixture(t);await f.run();f.append('oldtail');await f.run();
 f.e.blocks.at(-1).hash=id('newtail');assert.equal((await f.run()).removedBlocks,1);
 assert.equal(f.read().index.ledgerHash,hash(replay(f.config.manifest,f.e.blocks)));
 const before=f.read().index;f.e.blocks.at(-1).hash=id('thirdtail');await assert.rejects(f.run({reorgLimit:0}),/Reorg exceeds/);assert.deepEqual(f.read().index,before);
});
test('removed BUY rolls back its entries and carry using canonical replay',async t=>{
 const f=fixture(t);await f.run();const before=f.read().index.ledger;
 const buy=before.decisions.find(d=>d.status==='ELIGIBLE');assert(buy);
 const start=f.e.blocks.findIndex(b=>Number(BigInt(b.number))===buy.blockNumber);assert(start>=0);
 for(let i=start;i<f.e.blocks.length;i++){
  const b=f.e.blocks[i];b.hash=id('replacement '+i);b.parentHash=i?f.e.blocks[i-1].hash:f.config.manifest.anchor.hash;
  if(i===start)b.transactions=[];
  for(const p of b.transactions){p.tx.blockHash=b.hash;p.receipt.blockHash=b.hash;for(const l of p.receipt.logs)l.blockHash=b.hash;}
 }
 await f.run();const after=f.read().index.ledger;assert.notEqual(hash(after.wallets),hash(before.wallets));
 assert.equal(hash(after),hash(replay(f.config.manifest,f.e.blocks)));
});
test('snapshot consumer rejects unadmitted, stale, behind, wrong policy and changed branch',async t=>{
 const f=fixture(t);f.config.indexer={statePath:f.statePath,maxAgeSeconds:60};await f.run();
 const {readSnapshot}=require('../scripts/persistent-buy-indexer.cjs');
 const original=f.read(),cutoff=original.index.head;
 const request={config:f.config,statePath:f.statePath,manifest:f.config.manifest,cutoff,rpc:async()=>f.e.blocks.at(-1)};
 await assert.rejects(readSnapshot(request),e=>e.reason==='indexerUnadmitted');
 const write=change=>{const s=structuredClone(original);delete s.checksum;s.index.policyStatus={mode:'admitted'};change(s);fs.writeFileSync(f.statePath,JSON.stringify({...s,checksum:hash(s)}));};
 for(const [reason,change] of [['indexerStale',s=>s.status.state='waiting'],['indexerStale',s=>s.status.updatedAt=new Date(0).toISOString()],['indexerBehind',s=>s.index.head--],['indexerPolicy',s=>s.index.manifest.entryThresholdRaw='1']]){
  write(change);await assert.rejects(readSnapshot(request),e=>e.reason===reason);
 }
 write(()=>{});await assert.rejects(readSnapshot({...request,rpc:async()=>({hash:id('other branch')})}),e=>e.reason==='indexerBranch');
});
