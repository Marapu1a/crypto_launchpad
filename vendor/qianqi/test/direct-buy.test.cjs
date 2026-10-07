const {adapterId,commitment,genesisAdaptersHash}=require('../scripts/buy-policy-format.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {id,AbiCoder,keccak256}=require('ethers');
const {replay,canonical,hash,decodeTransaction,EXECUTE_ABI,SWAP_TYPE,TRANSFER_ABI}=require('../scripts/direct-buy.cjs');
const evidence=JSON.parse(fs.readFileSync('research/direct-buy/evidence.json','utf8'));
const m=evidence.manifest,blocks=evidence.blocks;
const copy=x=>structuredClone(x);
const coder=AbiCoder.defaultAbiCoder();

test('checkpoint continuation equals full legacy replay at every boundary',()=>{
 const {replayWithCheckpoint}=require('../scripts/direct-buy.cjs');
 let previous=null;
 for(let i=0;i<blocks.length;i++){
  previous=replayWithCheckpoint(m,[blocks[i]],previous);
  assert.deepEqual(previous.ledger,replay(m,blocks.slice(0,i+1)));
 }
 assert.deepEqual(replayWithCheckpoint(m,[],previous).ledger,previous.ledger);
});

test('Pons checkpoint carries 60+40 without mutation and rejects broken proof/duplicate tx',t=>{
 const f=require('./fixtures/pons-indexer.cjs').fixture(t),{replayWithCheckpoint}=require('../scripts/direct-buy.cjs');
 const prior=replayWithCheckpoint(f.m,[f.blocks[0]]),saved=copy(prior);
 const result=replayWithCheckpoint(f.m,[f.blocks[1]],prior);
 assert.deepEqual(prior,saved);assert.deepEqual(result.ledger,replay(f.m,f.blocks));
 assert.equal(result.ledger.wallets[0].entriesMinted,'1');
 const bad=copy(prior);bad.ledger.wallets[0].carryRaw='999';
 assert.throws(()=>replayWithCheckpoint(f.m,[f.blocks[1]],bad),/ledger mismatch/);
 const changed=copy(f.m);changed.codeHashes.curve=id('different-runtime');
 assert.throws(()=>replayWithCheckpoint(changed,[f.blocks[1]],prior),/policy mismatch/);
 const wrong=copy(f.blocks[1]);wrong.parentHash=id('wrong');
 assert.throws(()=>replayWithCheckpoint(f.m,[wrong],prior),/Non-contiguous/);
 const duplicate=copy(f.blocks[1]);duplicate.transactions[0].tx.hash=f.blocks[0].transactions[0].tx.hash;
 assert.throws(()=>replayWithCheckpoint(f.m,[duplicate],prior),/Duplicate canonical transaction/);
});
test('saved Permit2 integration branch reproduces activation, single attempt and scheduler artifact',()=>{
 const e=require('../research/permit-buy-integration-2026-09-24.json'),i=e.integration;
 const {buildFromHistory}=require('../scripts/short-dataset.cjs');
 assert.equal(e.stage,'complete');assert.equal(i.policyStatus.mode,'admitted');
 const input=i.replayInput,ledger=replay(input.manifest,input.blocks);
 const before=ledger.decisions.find(d=>d.transactionHash===i.buyHashes.before),after=ledger.decisions.find(d=>d.transactionHash===i.buyHashes.after);
 assert.equal(before.reason,'COMMAND_SEQUENCE');assert.equal(before.entriesMinted,'0');
 assert.equal(after.blockNumber,i.activation);assert.equal(after.status,'ELIGIBLE');assert.equal(after.entriesMinted,'1');
 assert.equal(ledger.wallets.length,1);assert.equal(ledger.wallets[0].entriesMinted,'1');assert.equal(ledger.wallets[0].carryRaw,'0');
 assert.equal(hash(buildFromHistory(input)),i.artifactHash);
 const duplicate={...input,blocks:[...input.blocks,copy(input.blocks.at(-1))]};
 assert.equal(hash(buildFromHistory(duplicate)),i.artifactHash);
 const changed=copy(i.artifact);changed.request.budget=String(BigInt(changed.request.budget)+15n);
 assert.notEqual(hash(changed),hash(buildFromHistory(input)));
 assert.deepEqual(i.runs.map(r=>r.results.SHORT.action||r.results.SHORT.status),['saveJob','error','begin','publish']);
 assert.match(i.runs[1].results.SHORT.message,/independent replay/);
 assert.equal(i.finalState.jobs.SHORT.length,1);
 assert.equal(hash(i.finalState.jobs.SHORT[0].job.artifact),i.artifactHash);
 // Offline consistency over raw fork history; recorded admitted/run labels are not RPC attestation.
});
const permitEvidence=require('../research/permit-buy-fork-positive-2026-09-24.json');
const permitSample=permitEvidence.observations.at(-1);
const permitName='rh-ur-0a10-060b0e-v1';
const {PERMIT_TYPE,routeDependencies}=require('../scripts/direct-buy.cjs');
function permitManifest(){return {...copy(m),...copy(permitEvidence.config),chainId:31337,
 schema:'direct-buy-v2',routeVersion:'scheduled-routes-v1',codeHashes:copy(permitEvidence.codeHashes),
 routes:[{id:m.routeVersion,fromBlock:0},{id:permitName,fromBlock:Number(BigInt(permitSample.transaction.blockNumber))}]};}
function mutatePermit(change){
 const tx=copy(permitSample.transaction),receipt=copy(permitSample.receipt);
 const call=EXECUTE_ABI.parseTransaction({data:tx.input});
 const state={commands:call.args.commands,inputs:Array.from(call.args.inputs),deadline:call.args.deadline,tx,receipt};
 change(state);tx.input=EXECUTE_ABI.encodeFunctionData('execute',[state.commands,state.inputs,state.deadline]);
 return decodeTransaction(permitManifest(),tx,receipt)[0];
}

test('Permit2 saved real fork BUY requires its own activated adapter; volume is actual spend',()=>{
 const manifest=permitManifest(),tx=permitSample.transaction,r=permitSample.receipt;
 assert.equal(permitEvidence.stage,'complete');
 const d=decodeTransaction(manifest,tx,r)[0];
 assert.equal(d.status,'ELIGIBLE');assert.equal(d.grossQuoteRaw,'100000000');
 assert.equal(d.payer,tx.from);assert.equal(d.recipient,tx.from);
 manifest.routes[1].fromBlock++;assert.equal(decodeTransaction(manifest,tx,r)[0].reason,'ROUTE_NOT_ACTIVE');
 manifest.routes.pop();assert.equal(decodeTransaction(manifest,tx,r)[0].reason,'COMMAND_SEQUENCE');
 assert.equal(decodeTransaction(permitEvidence.config,tx,r)[0].reason,'COMMAND_SEQUENCE');
 // Synthetic receipt consistency vectors, not newly executed on-chain permits.
 assert.equal(mutatePermit(s=>{const [p,sig]=coder.decode([PERMIT_TYPE,'bytes'],s.inputs[0]);const a=p.toArray(true);a[0][1]*=10n;s.inputs[0]=coder.encode([PERMIT_TYPE,'bytes'],[a,sig]);}).grossQuoteRaw,'100000000');
});

test('Permit2 adapter rejects extra/reordered/flagged commands, wrong permit and noncanonical bytes',()=>{
 for(const commands of ['0x8a10','0x0a90','0x4a10','0x0a50','0x100a','0x0a0a10','0x10'])
  assert.notEqual(mutatePermit(s=>s.commands=commands).status,'ELIGIBLE',commands);
 for(const change of [s=>s.inputs.pop(),s=>s.inputs.push(s.inputs[0]),s=>s.inputs.reverse(),s=>s.inputs[0]+='00',s=>s.inputs[0]='0x12'])
  assert.notEqual(mutatePermit(change).status,'ELIGIBLE');
 for(const change of [p=>p[0][0]=m.token,p=>p[1]=m.registry,p=>p[0][1]=99999999n]){
  const d=mutatePermit(s=>{const [p,sig]=coder.decode([PERMIT_TYPE,'bytes'],s.inputs[0]);const a=p.toArray(true);change(a);s.inputs[0]=coder.encode([PERMIT_TYPE,'bytes'],[a,sig]);});
  assert.notEqual(d.status,'ELIGIBLE');
 }
 assert.notEqual(mutatePermit(s=>{const [p]=coder.decode([PERMIT_TYPE,'bytes'],s.inputs[0]);s.inputs[0]=coder.encode([PERMIT_TYPE,'bytes'],[p,'0x']);}).status,'ELIGIBLE');
 assert.notEqual(mutatePermit(s=>s.receipt.status='0x0').status,'ELIGIBLE');
 assert.notEqual(mutatePermit(s=>s.tx.to=m.registry).status,'ELIGIBLE');
});

test('Permit2 adapter retains strict payer, pool, action and transfer attribution',()=>{
 for(const change of [
  s=>s.tx.from=m.registry,
  s=>s.tx.value='0x1',
  s=>s.receipt.logs=s.receipt.logs.filter(l=>l.address.toLowerCase()!==permitEvidence.config.quote.toLowerCase()),
  s=>s.receipt.logs.push(copy(s.receipt.logs.find(l=>l.address.toLowerCase()===permitEvidence.config.quote.toLowerCase()))),
  s=>s.receipt.logs.push(copy(s.receipt.logs.find(l=>l.address.toLowerCase()===permitEvidence.config.manager.toLowerCase())))
 ])assert.notEqual(mutatePermit(change).status,'ELIGIBLE');
 for(const kind of ['gift','payer','hook','direction','actions','pool']){
  const d=mutatePermit(s=>{const [actions,p]=coder.decode(['bytes','bytes[]'],s.inputs[1]);const a=Array.from(p);
   if(kind==='gift')a[2]=coder.encode(['address','address','uint256'],[permitEvidence.config.token,m.registry,0]);
   if(kind==='payer')a[1]=coder.encode(['address','uint256','bool'],[permitEvidence.config.quote,0,false]);
   if(['hook','direction','pool'].includes(kind)){const spec=coder.decode([SWAP_TYPE],a[0])[0].toArray(true);if(kind==='hook')spec[5]='0x01';if(kind==='direction')spec[1]=!spec[1];if(kind==='pool')spec[0][2]++;a[0]=coder.encode([SWAP_TYPE],[spec]);}
   s.inputs[1]=coder.encode(['bytes','bytes[]'],[kind==='actions'?'0x060c0f':actions,a]);
  });assert.notEqual(d.status,'ELIGIBLE',kind);
 }
});

test('Permit2 typed extension preserves old frozen commitments and carry at activation',()=>{
 const {history}=require('./fixtures/attempt-history.cjs');const {extend}=require('../scripts/buy-policy-format.cjs');
 const {replayAttempts}=require('../scripts/attempt-lifecycle.cjs');
 const h=history();h.buy(99000000n);const old=h.freeze('permit pending','SHORT',h.head(),[h.participant(1)]);
 const announcement=h.head(),activation=announcement.blockNumber+2;
 const next=extend(h.manifest,adapterId(permitName),activation,announcement.blockNumber);
 const policy={schema:'buy-policy-history-v1',versions:[{fromBlock:Number(BigInt(h.manifest.anchor.number)),manifest:h.manifest},{fromBlock:activation,announcedAtBlock:announcement.blockNumber,announcedBlockHash:announcement.blockHash,manifest:next}]};
 function buy(){h.buy(1000000n);const tx=h.blocks.at(-1).transactions[0].tx,call=EXECUTE_ABI.parseTransaction({data:tx.input});
  const permit=coder.encode([PERMIT_TYPE,'bytes'],[[[h.manifest.quote,1000000n,9999999999n,0],h.manifest.router,9999999999n],'0x01']);
  tx.input=EXECUTE_ABI.encodeFunctionData('execute',['0x0a10',[permit,...call.args.inputs],call.args.deadline]);}
 // Synthetic branch tests receipt-based replay, not signature validity.
 buy();assert.notEqual(replay(policy,h.blocks).decisions.at(-1).status,'ELIGIBLE');
 assert.deepEqual(routeDependencies(policy,activation-1),[]);
 buy();const ledger=replay(policy,h.blocks);assert.equal(ledger.decisions.at(-1).entriesMinted,'1');
 assert.equal(ledger.wallets[0].carryRaw,'0');assert.equal(ledger.wallets[0].entriesMinted,'2');
 assert.equal(routeDependencies(policy,activation)[0].codeHash,permitEvidence.codeHashes.permit);
 assert.equal(replayAttempts(policy,h.config,h.blocks).draws[0].snapshotHash,old.snapshotHash);
 h.terminal(old);assert.equal(replayAttempts(policy,h.config,h.blocks).draws[0].snapshotHash,old.snapshotHash);
 assert.throws(()=>extend(h.manifest,adapterId(permitName),announcement.blockNumber,announcement.blockNumber),/Activation/);
 assert.throws(()=>extend(next,adapterId(permitName),activation+2,activation),/duplicate/);
 const bad=permitManifest();bad.codeHashes.router=id('wrong');assert.throws(()=>routeDependencies(bad,activation),/runtime/);
 assert.equal(hash(replay(policy,h.blocks)),hash(replay(policy,copy(h.blocks))));
});

test('Permit2 active RPC dependency rejects missing or mismatched code before scanning receipts',async()=>{
 const {scan}=require('../scripts/replay-direct-buy.cjs'),http=require('node:http');const manifest=permitManifest();
 const to=Number(BigInt(permitSample.transaction.blockNumber));let code='0x',reads=0;
 const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const q=JSON.parse(body);let result;
  if(q.method==='eth_chainId')result='0x7a69';
  if(q.method==='eth_getBlockByNumber')result={hash:manifest.anchor.hash};
  if(q.method==='eth_getCode'){assert.equal(q.params[0],routeDependencies(manifest,to)[0].address);reads++;result=code;}
  res.end(JSON.stringify({id:q.id,jsonrpc:'2.0',result}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const url='http://127.0.0.1:'+server.address().port;
  await assert.rejects(scan(manifest,url,to),/adapter dependency runtime/);
  code='0x6001';await assert.rejects(scan(manifest,url,to),/adapter dependency runtime/);assert.equal(reads,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
function transaction(label,branch=blocks){const h=evidence.observations.find(o=>o.label===label).hash;return branch.flatMap(b=>b.transactions).find(t=>t.tx.hash===h);}
function decision(label){const t=transaction(label);return decodeTransaction(m,t.tx,t.receipt);}

test('real fork router BUY 99 + 1 creates one entry; pre-registration BUY, SELL, gift and batch do not',()=>{
  const ledger=replay(m,blocks),statuses=ledger.decisions.map(d=>[d.status,d.reason]);
  assert.equal(ledger.wallets.length,1);
  assert.equal(ledger.wallets[0].entriesMinted,'1');
  assert.equal(ledger.wallets[0].carryRaw,'0');
  assert.equal(ledger.wallets[0].shortAttemptsMinted,'1');
  assert.equal(ledger.wallets[0].monthlyAttemptsMinted,'1');
  assert.equal(statuses.filter(([s])=>s==='ELIGIBLE').length,2);
  for(const reason of ['NOT_REGISTERED_AT_SWAP','SELL','PAYER_RECIPIENT_DIFFER','MULTIPLE_POOL_SWAPS'])assert.ok(statuses.some(([,r])=>r===reason),reason);
  const eligible=ledger.decisions.filter(d=>d.status==='ELIGIBLE');
  assert.deepEqual(eligible.map(d=>d.grossQuoteRaw),['99000000','1000000']);
  assert.equal(decision('BUY 99 USDG')[0].payer,evidence.sandboxFunding.wallet.toLowerCase());
});

test('replay is deterministic; duplicate block/log delivery cannot mint extra entries',()=>{
  const expected=replay(m,blocks);
  assert.equal(canonical(replay(m,[...copy(blocks).reverse(),copy(blocks[1])])),canonical(expected));
  const duplicate=copy(blocks),t=transaction('BUY 99 USDG',duplicate);
  t.receipt.logs.push(copy(t.receipt.logs[0]));
  assert.equal(hash(replay(m,duplicate)),hash(expected));
  const changed=copy(blocks[1]);changed.hash=id('different branch');
  assert.throws(()=>replay(m,[...blocks,changed]),/Conflicting block/);
});

test('bad provenance, chain, missing block and unanchored partial history fail closed',()=>{
  assert.throws(()=>replay({...m,chainId:4663},blocks),/chain mismatch/);
  assert.throws(()=>replay(m,blocks.slice(1)),/Non-contiguous/);
  let b=copy(blocks);transaction('BUY 99 USDG',b).receipt.blockHash=id('wrong receipt');
  assert.throws(()=>replay(m,b),/Receipt mismatch/);
  b=copy(blocks);transaction('BUY 99 USDG',b).receipt.logs[0].removed=true;
  assert.throws(()=>replay(m,b),/Log provenance/);
  b=copy(blocks);b[2].parentHash=id('wrong parent');
  assert.throws(()=>replay(m,b),/Non-contiguous/);
  assert.throws(()=>replay({...m,entryThresholdRaw:'1'},blocks),/100 nominal/);
});

test('fork of the branch removes orphaned BUY: replay restores 99 USDG carry',()=>{
  const buy=transaction('BUY 1 USDG'),height=Number(BigInt(buy.tx.blockNumber));
  const prefix=copy(blocks.filter(b=>Number(BigInt(b.number))<height));
  const replacement={number:'0x'+height.toString(16),hash:id('replacement empty block'),parentHash:prefix.at(-1).hash,timestamp:'0x1',transactions:[]};
  const ledger=replay(m,[...prefix,replacement]);
  assert.equal(ledger.wallets[0].entriesMinted,'0');
  assert.equal(ledger.wallets[0].carryRaw,'99000000');
  assert.equal(replay(m,blocks).wallets[0].entriesMinted,'1');
});

test('an omitted operator decision or changed carry is detectable by full replay comparison',()=>{
  const good=replay(m,blocks),omitted=copy(good),forged=copy(good);
  omitted.decisions.splice(0,1);forged.wallets[0].carryRaw='1';
  assert.notEqual(hash(omitted),hash(good));assert.notEqual(hash(forged),hash(good));
});

test('calldata max/amount and pool sender alone never authorize a BUY',()=>{
  const original=transaction('BUY 99 USDG');
  let t=copy(original);t.tx.to='0x0000000000000000000000000000000000001234';
  assert.equal(decodeTransaction(m,t.tx,t.receipt)[0].reason,'NOT_DIRECT_ROUTER_CALL');
  t=copy(original);t.tx.input='0x12345678';
  assert.equal(decodeTransaction(m,t.tx,t.receipt)[0].status,'UNSUPPORTED_ROUTE');
  t=copy(original);t.tx.input=original.tx.input.slice(0,10);
  assert.equal(decodeTransaction(m,t.tx,t.receipt)[0].status,'AMBIGUOUS');
  t=copy(original);const call=EXECUTE_ABI.parseTransaction({data:t.tx.input});
  t.tx.input=EXECUTE_ABI.encodeFunctionData('execute',['0x90',call.args.inputs,call.args.deadline]);
  assert.equal(decodeTransaction(m,t.tx,t.receipt)[0].reason,'COMMAND_SEQUENCE');
});

test('missing payment, unrelated quote transfers and wrong transfer values cannot fabricate volume',()=>{
  const original=transaction('BUY 99 USDG');
  for(const change of ['missing','extra','amount']){
    const t=copy(original);
    const log=t.receipt.logs.find(l=>l.address.toLowerCase()===m.quote.toLowerCase()&&l.topics[0]===TRANSFER_ABI.getEvent('Transfer').topicHash);
    assert.ok(log);
    if(change==='missing')t.receipt.logs=t.receipt.logs.filter(l=>l!==log);
    if(change==='extra')t.receipt.logs.push({...copy(log),logIndex:'0xff'});
    if(change==='amount')log.data=coder.encode(['uint256'],[123n]);
    assert.equal(decodeTransaction(m,t.tx,t.receipt)[0].reason,'SETTLEMENT_TRANSFER_MISMATCH');
  }
});

test('wrong pool, nonempty hookData and unsupported exact-out never silently count',()=>{
  const original=transaction('BUY 99 USDG');
  for(const change of ['pool','hook','exactOut']){
    const t=copy(original),call=EXECUTE_ABI.parseTransaction({data:t.tx.input});
    const [actions,raw]=coder.decode(['bytes','bytes[]'],call.args.inputs[0]);
    const params=Array.from(raw),spec=coder.decode([SWAP_TYPE],params[0])[0].toArray(true);
    if(change==='pool')spec[0][2]+=1n;
    if(change==='hook')spec[5]='0x01';
    params[0]=coder.encode([SWAP_TYPE],[spec]);
    t.tx.input=EXECUTE_ABI.encodeFunctionData('execute',['0x10',[coder.encode(['bytes','bytes[]'],[change==='exactOut'?'0x080b0e':actions,params])],call.args.deadline]);
    assert.notEqual(decodeTransaction(m,t.tx,t.receipt)[0].status,'ELIGIBLE');
  }
});

test('registration strictly precedes Swap even within one receipt (synthetic ordered-log fixture)',()=>{
  for(const before of [true,false]){
    const branch=copy(blocks),registration=transaction('register participant',branch),buy=transaction('BUY 99 USDG',branch);
    const regLog=registration.receipt.logs.pop();
    regLog.blockHash=buy.tx.blockHash;regLog.blockNumber=buy.tx.blockNumber;
    regLog.transactionHash=buy.tx.hash;regLog.transactionIndex=buy.tx.transactionIndex;
    const swapIndex=buy.receipt.logs.findIndex(l=>l.address.toLowerCase()===m.manager.toLowerCase());
    buy.receipt.logs.splice(swapIndex+(before?0:1),0,regLog);
    buy.receipt.logs.forEach((l,i)=>{l.logIndex='0x'+i.toString(16);});
    const ledger=replay(m,branch);
    assert.equal(ledger.wallets[0].entriesMinted,before?'1':'0');
    assert.equal(ledger.wallets[0].carryRaw,before?'0':'1000000');
  }
});

test('independent RPC scan fetches all receipts and detects changed head or code',async()=>{
  const http=require('node:http');
  const {scan}=require('../scripts/replay-direct-buy.cjs');
  const fakeCode='0x6001600055',manifest=copy(m);
  for(const field of Object.keys(manifest.codeHashes))manifest.codeHashes[field]=keccak256(fakeCode);
  const receipts=new Map(blocks.flatMap(b=>b.transactions.map(t=>[t.tx.hash,t.receipt])));
  let mode='ok',headReads=0,receiptReads=0;
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const {id:rid,method,params}=JSON.parse(body);let result;
    if(method==='eth_chainId')result='0x7a69';
    if(method==='eth_getCode')result=mode==='code'?'0x6002':fakeCode;
    if(method==='eth_getTransactionReceipt'){receiptReads++;result=receipts.get(params[0]);}
    if(method==='eth_getBlockByNumber'){
      if(BigInt(params[0])===BigInt(m.anchor.number))result={number:m.anchor.number,hash:m.anchor.hash};
      else{
        const b=blocks.find(b=>BigInt(b.number)===BigInt(params[0]));
        result={...b,transactions:params[1]?b.transactions.map(t=>t.tx):b.transactions.map(t=>t.tx.hash)};
        if(b===blocks.at(-1)&&!params[1]&&++headReads===2&&mode==='reorg')result.hash=id('new head');
      }
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:rid,result}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url='http://127.0.0.1:'+server.address().port,to=blocks.at(-1).number;
    const scanned=await scan(manifest,url,to);
    assert.equal(receiptReads,receipts.size);
    assert.equal(canonical(replay(scanned.manifest,scanned.blocks)),canonical(replay(manifest,blocks)));
    await assert.rejects(scan(manifest,url,to,{source:manifest.registry,sourceCodeHash:keccak256('0x6002')}),/lifecycle source runtime/);
    const withLifecycle=await scan(manifest,url,to,{source:manifest.registry,sourceCodeHash:keccak256(fakeCode)});
    assert.equal(withLifecycle.blocks.length,blocks.length);
    mode='code';await assert.rejects(scan(manifest,url,to),/runtime/);
    mode='reorg';headReads=0;await assert.rejects(scan(manifest,url,to),/Chain changed/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
const publicEvidence=require('../research/pair-usdg-active-reference-2026-09-23.json');
const scheduled={...m,...publicEvidence.decoderConfig,schema:'direct-buy-v2',routeVersion:'scheduled-routes-v1',codeHashes:publicEvidence.codeHashes,
 routes:[{id:'rh-ur-10-060b0e-v1',fromBlock:0},{id:'rh-ur-10-060c0f-v1',fromBlock:60495395}]};
const publicBuys=publicEvidence.samples.filter(s=>s.decoded.some(d=>d.reason==='ACTION_SEQUENCE')).map(s=>({
 tx:publicEvidence.reads.find(r=>r.method==='eth_getTransactionByHash'&&r.params[0]===s.hash).response.result,
 receipt:publicEvidence.reads.find(r=>r.method==='eth_getTransactionReceipt'&&r.params[0]===s.hash).response.result}));
test('scheduled routes decode three public BUY receipts, gated at exact activation block',()=>{
 for(const {tx,receipt} of publicBuys){const d=decodeTransaction(scheduled,tx,receipt)[0];assert.equal(d.status,'ELIGIBLE');assert.equal(d.payer,tx.from.toLowerCase());assert(BigInt(d.grossQuoteRaw)>0n);
 const future=copy(scheduled);future.routes[1].fromBlock=Number(BigInt(receipt.blockNumber))+1;assert.equal(decodeTransaction(future,tx,receipt)[0].reason,'ROUTE_NOT_ACTIVE');
 assert.equal(decodeTransaction({...scheduled,schema:'direct-buy-v1',routeVersion:m.routeVersion,routes:undefined},tx,receipt)[0].status,'UNSUPPORTED_ROUTE');}
});
test('route policy rejects unknown, duplicate, invalid blocks and unpinned runtime; legacy replay unchanged',()=>{
 const {validateManifest}=require('../scripts/direct-buy.cjs');validateManifest(scheduled);
 for(const mutate of [x=>x.routes.push(x.routes[0]),x=>x.routes[0].id='unknown',x=>x.routes[0].fromBlock=-1,x=>x.routes[0].fromBlock='1',x=>x.codeHashes.router=id('other')]){const x=copy(scheduled);mutate(x);assert.throws(()=>validateManifest(x));}
 const upgraded={...m,schema:'direct-buy-v2',routeVersion:'scheduled-routes-v1',routes:[{id:m.routeVersion,fromBlock:0}]};
 const old=replay(m,blocks),next=replay(upgraded,blocks);assert.deepEqual(next.wallets,old.wallets);assert.deepEqual(next.decisions,old.decisions);assert.notEqual(next.manifestHash,old.manifestHash);
});
test('public route rejects malformed settlement, limits, extra commands and inconsistent transfers',()=>{
 function params(tx,change){const parsed=EXECUTE_ABI.parseTransaction({data:tx.input});const [actions,ps]=coder.decode(['bytes','bytes[]'],parsed.args.inputs[0]);const a=Array.from(ps);change(a);tx.input=EXECUTE_ABI.encodeFunctionData('execute',['0x10',[coder.encode(['bytes','bytes[]'],[actions,a])],parsed.args.deadline]);}
 const mutations=[
 ({tx})=>params(tx,p=>p[1]=coder.encode(['address','uint256'],[scheduled.quote,0n])),
 ({tx})=>params(tx,p=>p[2]=coder.encode(['address','uint256'],[scheduled.token,(1n<<256n)-1n])),
 ({tx})=>params(tx,p=>p[1]=coder.encode(['address','uint256'],[scheduled.token,1000000000000n])),
 ({tx})=>params(tx,p=>p[1]+='00'),
 ({tx})=>{tx.from=scheduled.router;},
 ({receipt})=>{receipt.status='0x0';},
 ({receipt})=>{receipt.logs.push(copy(receipt.logs.find(l=>l.address.toLowerCase()===scheduled.quote.toLowerCase())));},
 ({tx})=>{const p=EXECUTE_ABI.parseTransaction({data:tx.input});tx.input=EXECUTE_ABI.encodeFunctionData('execute',['0x1010',[p.args.inputs[0],p.args.inputs[0]],p.args.deadline]);}
 ];for(const mutate of mutations){const x=copy(publicBuys[0]);mutate(x);assert.notEqual(decodeTransaction(scheduled,x.tx,x.receipt)[0].status,'ELIGIBLE');}
});
test('route extension candidates are append-only; this is not lifecycle upgrade admission',()=>{
 const {validateRouteExtensionCandidate}=require('../scripts/direct-buy.cjs');const next={...m,schema:'direct-buy-v2',routeVersion:'scheduled-routes-v1',routes:[{id:m.routeVersion,fromBlock:0},{id:'rh-ur-10-060c0f-v1',fromBlock:70000001}]};
 validateRouteExtensionCandidate(m,next,70000000);
 assert.throws(()=>validateRouteExtensionCandidate(m,next,70000001),/announcement/);
 const changed=copy(next);changed.routes[0].fromBlock=1;assert.throws(()=>validateRouteExtensionCandidate(m,changed,70000000),/Historical/);
 assert.throws(()=>validateRouteExtensionCandidate(m,{...next,registry:next.router},70000000),/Unrelated/);
});

test('future route extension is NOT a lifecycle upgrade: old frozen and settled snapshots retain original manifest',()=>{
 const {history}=require('./fixtures/attempt-history.cjs');
 const {replayAttempts}=require('../scripts/attempt-lifecycle.cjs');
 const {validateRouteExtensionCandidate}=require('../scripts/direct-buy.cjs');
 const h=history();const draw=h.freeze('route upgrade regression','SHORT',h.head(),[h.participant(1)]);
 const next={...h.manifest,schema:'direct-buy-v2',routeVersion:'scheduled-routes-v1',routes:[{id:h.manifest.routeVersion,fromBlock:0},{id:'rh-ur-10-060c0f-v1',fromBlock:70000001}]};
 validateRouteExtensionCandidate(h.manifest,next,70000000);
 assert.deepEqual(replay(h.manifest,h.blocks).wallets,replay(next,h.blocks).wallets);
 const originalSnapshot=canonical(draw.snapshot);
 assert.doesNotThrow(()=>replayAttempts(h.manifest,h.config,h.blocks));
 assert.throws(()=>replayAttempts(next,h.config,h.blocks),/Frozen snapshot does not match replay/);
 h.terminal(draw);
 assert.doesNotThrow(()=>replayAttempts(h.manifest,h.config,h.blocks));
 assert.throws(()=>replayAttempts(next,h.config,h.blocks),/Frozen snapshot does not match replay/);
 assert.equal(canonical(draw.snapshot),originalSnapshot);
 assert.equal(require('../scripts/direct-buy.cjs').validateRouteUpgrade,undefined);
});

test('versioned BUY history preserves pending and settled snapshots, carry and inclusive route activation',()=>{
 const {history}=require('./fixtures/attempt-history.cjs');
 const {replayAttempts,domainFor,snapshotFor}=require('../scripts/attempt-lifecycle.cjs');
 const h=history();h.buy(99000000n);
 const old=h.freeze('policy old Short','SHORT',h.head(),[h.participant(1)]);
 const month=h.freeze('policy old Monthly','MONTHLY',h.head(),[h.participant(1)]);
 const announcement=h.head(),activation=announcement.blockNumber+2;
 const next={...copy(h.manifest),schema:'direct-buy-v2',routeVersion:'scheduled-routes-v1',routes:[{id:h.manifest.routeVersion,fromBlock:0},{id:'rh-ur-10-060c0f-v1',fromBlock:activation}]};
 const policy={schema:'buy-policy-history-v1',versions:[{fromBlock:Number(BigInt(h.manifest.anchor.number)),manifest:copy(h.manifest)},{fromBlock:activation,announcedAtBlock:announcement.blockNumber,announcedBlockHash:announcement.blockHash,manifest:next}]};
 function newBuy(){h.buy(1000000n);const tx=h.blocks.at(-1).transactions[0].tx;const p=EXECUTE_ABI.parseTransaction({data:tx.input});const [,params]=coder.decode(['bytes','bytes[]'],p.args.inputs[0]);tx.input=EXECUTE_ABI.encodeFunctionData('execute',['0x10',[coder.encode(['bytes','bytes[]'],['0x060c0f',[params[0],coder.encode(['address','uint256'],[h.manifest.quote,1000000n]),coder.encode(['address','uint256'],[h.manifest.token,1n])]])],p.args.deadline]);}
 const baseline=replayAttempts(h.manifest,h.config,h.blocks);
 newBuy();assert.equal(h.head().blockNumber,activation-1);
 newBuy();assert.equal(h.head().blockNumber,activation);
 let ledger=replayAttempts(policy,h.config,h.blocks);
 assert.deepEqual(ledger.draws,baseline.draws);
 assert.equal(ledger.buyLedger.wallets[0].entriesMinted,'2');assert.equal(ledger.buyLedger.wallets[0].carryRaw,'0');
 assert.equal(ledger.buyLedger.decisions.at(-2).status,'UNSUPPORTED_ROUTE');assert.equal(ledger.buyLedger.decisions.at(-1).status,'ELIGIBLE');
 h.terminal(old);h.terminal(month);
 const cutoff=h.head(),drawId=id('policy new Short'),rulesHash=id('test SHORT rules');
 const snapshot=snapshotFor(domainFor(policy,h.config,cutoff.blockNumber),drawId,'SHORT',cutoff,rulesHash,[h.participant(1,2)]);
 h.freeze('policy new Short','SHORT',cutoff,[h.participant(1,2)],{snapshotHash:hash(snapshot)});
 ledger=replayAttempts(policy,h.config,h.blocks);
 assert.equal(ledger.draws[0].snapshotHash,old.snapshotHash);assert.equal(ledger.draws[1].snapshotHash,month.snapshotHash);
 assert.equal(ledger.draws[0].status,'CONSUMED');assert.deepEqual(ledger.draws[2].snapshot,snapshot);
 assert.equal(ledger.draws[2].snapshot.domain.buyManifestHash,hash(next));
 const again=replayAttempts(policy,h.config,h.blocks);assert.deepEqual(again,ledger);
 const bad=copy(policy);bad.versions[1].announcedBlockHash=id('orphan');assert.throws(()=>replayAttempts(bad,h.config,h.blocks),/Policy notice/);
 const retro=copy(policy);retro.versions[1].fromBlock=announcement.blockNumber;assert.throws(()=>replayAttempts(retro,h.config,h.blocks));
 const changed=copy(policy);changed.versions[1].manifest.routes[0].fromBlock=1;assert.throws(()=>replayAttempts(changed,h.config,h.blocks),/Historical/);
 assert.throws(()=>domainFor(policy,h.config),/Policy block required/);
});

test('FREEZE after activation keeps policy of its earlier cutoff; future versions do not rewrite it',()=>{
 const {history}=require('./fixtures/attempt-history.cjs');const {replayAttempts}=require('../scripts/attempt-lifecycle.cjs');
 const h=history(),cutoff=h.head(),activation=cutoff.blockNumber+1;
 const next={...copy(h.manifest),schema:'direct-buy-v2',routeVersion:'scheduled-routes-v1',routes:[{id:h.manifest.routeVersion,fromBlock:0},{id:'rh-ur-10-060c0f-v1',fromBlock:activation}]};
 const policy={schema:'buy-policy-history-v1',versions:[{fromBlock:Number(BigInt(h.manifest.anchor.number)),manifest:h.manifest},{fromBlock:activation,announcedAtBlock:cutoff.blockNumber,announcedBlockHash:cutoff.blockHash,manifest:next}]};
 h.empty('activation');const draw=h.freeze('delayed freeze','SHORT',cutoff,[h.participant(1)]);
 assert.equal(replayAttempts(policy,h.config,h.blocks).draws[0].snapshotHash,draw.snapshotHash);
 const bad=copy(policy);bad.versions.reverse();assert.throws(()=>replayAttempts(bad,h.config,h.blocks));
 const mismatch=copy(policy);mismatch.versions[1].manifest.routes[1].fromBlock++;assert.throws(()=>replayAttempts(mismatch,h.config,h.blocks),/activation mismatch/);
});

test('policy admission loads only authorized finalized notices with typed commitments; preserves old snapshot',async()=>{
 const {loadBuyPolicy,ABI}=require('../scripts/buy-policy-admission.cjs');
 const {history}=require('./fixtures/attempt-history.cjs');const {replayAttempts}=require('../scripts/attempt-lifecycle.cjs');
 function fixture(){
  const h=history(),draw=h.freeze('admission old','SHORT',h.head(),[h.participant(1)]),source=h.config.source,publisher=h.wallet;
  const notice=h.head().blockNumber+1,fromBlock=notice+2;
  const next={...copy(h.manifest),schema:'direct-buy-v2',routeVersion:'scheduled-routes-v1',routes:[{id:h.manifest.routeVersion,fromBlock:0},{id:'rh-ur-10-060c0f-v1',fromBlock}]};
  const trust={chainId:h.manifest.chainId,source,publisher,instanceId:h.config.instanceId,sourceCodeHash:keccak256('0x6000'),genesisHash:hash(h.manifest),noticeBlocks:2};
  h.append('policy notice',source,'0x',[h.log(ABI,'BuyPolicyAnnounced',[trust.instanceId,hash(h.manifest),commitment(hash(h.manifest),adapterId(next.routes[1].id),fromBlock),adapterId(next.routes[1].id),fromBlock],source)]);
  const log=h.blocks.at(-1).transactions[0].receipt.logs[0],pair=h.blocks.at(-1).transactions[0];
  const sourceState={instanceId:trust.instanceId,genesisHash:trust.genesisHash,publisher:trust.publisher,noticeBlocks:2,publishedCount:1,currentHash:commitment(hash(h.manifest),adapterId(next.routes[1].id),fromBlock),lastFromBlock:fromBlock,SCHEMA_VERSION:1,genesisAdaptersHash:genesisAdaptersHash(h.manifest)};
  h.empty('activate wait');h.empty('activate');const head=h.blocks.at(-1);let logs=[log],code='0x6000';
  const rpc=async(method,params)=>{
   if(method==='eth_call'){const name=ABI.parseTransaction({data:params[0].data}).name;return ABI.encodeFunctionResult(name,[sourceState[name]]);}
   if(method==='eth_chainId')return '0x7a69';
   if(method==='eth_getCode')return code;
   if(method==='eth_getLogs')return copy(logs);
   if(method==='eth_getTransactionByHash')return copy(pair.tx);
   if(method==='eth_getTransactionReceipt')return copy(pair.receipt);
   if(method==='eth_getBlockByNumber')return copy(params[0]==='finalized'?head:h.blocks.find(b=>BigInt(b.number)===BigInt(params[0]))||{number:h.manifest.anchor.number,hash:h.manifest.anchor.hash});
   throw Error('Unexpected RPC method '+method);
  };
  return {h,draw,trust,next,log,pair,rpc,setLogs:x=>logs=x,setCode:x=>code=x};
 }
 const good=fixture(),result=await loadBuyPolicy({trust:good.trust,genesis:good.h.manifest,rpc:good.rpc});
 assert.equal(result.history.versions.length,2);
 assert.equal(replayAttempts(result.history,good.h.config,good.h.blocks).draws[0].snapshotHash,good.draw.snapshotHash);
 for(const mutate of [
  x=>{x.trust.genesisHash=id('wrong');},
  x=>{x.trust.publisher=x.trust.source;},
  x=>{x.log.address=x.h.manifest.router;},
  x=>{x.log.blockHash=id('reorg');},
  x=>{x.pair.receipt.status='0x0';},
  x=>{x.pair.receipt.transactionHash=id('other');},
  x=>{x.trust.noticeBlocks=3;},
  x=>{x.setCode('0x6001');},
  x=>{x.setLogs([x.log,x.log]);},
  x=>{x.log.removed=true;},
  x=>{x.pair.receipt.logs=[];},
  x=>{const a=ABI.parseLog(x.log).args;Object.assign(x.log,ABI.encodeEventLog('BuyPolicyAnnounced',[a.instanceId,a.previousHash,id('false commitment'),a.adapterId,a.fromBlock]));},
  x=>{const a=ABI.parseLog(x.log).args;Object.assign(x.log,ABI.encodeEventLog('BuyPolicyAnnounced',[a.instanceId,id('wrong parent'),a.nextHash,a.adapterId,a.fromBlock]));},
  x=>{const a=ABI.parseLog(x.log).args;Object.assign(x.log,ABI.encodeEventLog('BuyPolicyAnnounced',[id('other instance'),a.previousHash,a.nextHash,a.adapterId,a.fromBlock]));},
  x=>{const a=ABI.parseLog(x.log).args;Object.assign(x.log,ABI.encodeEventLog('BuyPolicyAnnounced',[a.instanceId,a.previousHash,a.nextHash,a.adapterId,BigInt(x.log.blockNumber)]));}
 ]){const x=fixture();mutate(x);await assert.rejects(loadBuyPolicy({trust:x.trust,genesis:x.h.manifest,rpc:x.rpc}));}
 const missing=fixture();missing.setLogs([]);await assert.rejects(loadBuyPolicy({trust:missing.trust,genesis:missing.h.manifest,rpc:missing.rpc}),/Incomplete policy history/);
 const reorg=fixture();let count=0;const changing=async(m,p)=>{const v=await reorg.rpc(m,p);if(m==='eth_getBlockByNumber'&&p[0]!=='finalized'&&BigInt(p[0])===BigInt(reorg.h.head().blockNumber)&&++count===1)v.hash=id('changed checkpoint');return v;};
 await assert.rejects(loadBuyPolicy({trust:reorg.trust,genesis:reorg.h.manifest,rpc:changing}),/checkpoint changed/);
 const noFinal=fixture();await assert.rejects(loadBuyPolicy({trust:noFinal.trust,genesis:noFinal.h.manifest,rpc:async(m,p)=>m==='eth_getBlockByNumber'&&p[0]==='finalized'?null:noFinal.rpc(m,p)}),/Missing block/);
});

test('BUY CLI rejects missing public trust and labels offline evidence unadmitted',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'buy-policy-cli-'));
 try{
  const output=path.join(dir,'out.json'),config=path.join(dir,'config.json');
  const m=copy(require('../research/direct-buy/evidence.json').manifest);m.chainId=4663;
  fs.writeFileSync(config,JSON.stringify({manifest:m}));
  const rejected=spawnSync(process.execPath,['scripts/replay-direct-buy.cjs','--manifest',config,'--rpc','http://127.0.0.1:1','--to-block','70000000','--output',output],{encoding:'utf8',timeout:10000});
  assert.equal(rejected.status,1);assert.match(rejected.stderr,/trust required/);assert.equal(fs.existsSync(output),false);
  const offline=spawnSync(process.execPath,['scripts/replay-direct-buy.cjs','--evidence','research/direct-buy/evidence.json','--output',output],{encoding:'utf8',timeout:10000});
  assert.equal(offline.status,0,offline.stderr);assert.equal(JSON.parse(fs.readFileSync(output)).policyStatus.mode,'unadmitted');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
