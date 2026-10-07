const {test}=require('node:test');
const assert=require('node:assert/strict');
const {id,ZeroHash}=require('ethers');
const {replayAttempts}=require('../scripts/attempt-lifecycle.cjs');
const {canonical,hash}=require('../scripts/direct-buy.cjs');
const {history,example,addr}=require('./fixtures/attempt-history.cjs');
const run=h=>replayAttempts(h.manifest,h.config,h.blocks);
const state=(h,kind='SHORT')=>run(h).wallets.find(w=>w.wallet===h.wallet)[kind];

test('99+1 entry opens one attempt of each type; checkpoints alone do not consume',()=>{
  const h=history();h.empty('skip not ready');h.empty('long time without draw');
  for(const kind of ['SHORT','MONTHLY'])assert.deepEqual(state(h,kind),{mintedTotal:'1',open:'1',frozenByDraw:{},consumedTotal:'0'});
  assert.equal(run(h).draws.length,0);
});

test('cutoff is inclusive; BUY between cutoff and freeze stays OPEN, monthly independent',()=>{
  const h=history(),cutoff=h.head();h.buy(300_000000n);
  const draw=h.freeze('short','SHORT',cutoff,[h.participant(1)]);
  assert.deepEqual(state(h),{mintedTotal:'4',open:'3',frozenByDraw:{[draw.drawId]:{count:'1',firstAttempt:'1',lastAttempt:'1'}},consumedTotal:'0'});
  assert.equal(state(h,'MONTHLY').open,'4');
  h.buy(100_000000n);h.empty('RNG still pending');
  assert.equal(state(h).open,'4');assert.equal(state(h).consumedTotal,'0');
  assert.equal(run(h).draws[0].snapshot.participants[0].count,'1');
});

test('one pending per kind; Monthly freeze while Short pending is independent',()=>{
  const h=history();h.freeze('short','SHORT',h.head(),[h.participant(1)]);
  h.freeze('monthly','MONTHLY',h.head(),[h.participant(1)]);
  assert.equal(state(h).open,'0');assert.equal(state(h,'MONTHLY').open,'0');
  h.freeze('second short','SHORT',h.head(),[h.participant(1)]);
  assert.throws(()=>run(h),/already pending/);
});

test('winner and no-winner consume the same frozen range; claims do not affect attempts',()=>{
  for(const outcome of [0,1]){
    const h=history(),draw=h.freeze('short','SHORT',h.head(),[h.participant(1)]);
    h.buy(300_000000n);h.terminal(draw,outcome);
    const s=state(h);assert.deepEqual(s,{mintedTotal:'4',open:'3',frozenByDraw:{},consumedTotal:'1'});
    assert.equal(state(h,'MONTHLY').open,'4');
    h.append('claim marker',h.config.source,'0x',[{address:h.config.source,topics:[id('Claimed(bytes32)')],data:draw.drawId}]);
    assert.deepEqual(state(h),s);
    assert.equal(run(h).draws[0].terminal.outcome,outcome?'WINNER':'NO_WINNER');
  }
});

test('next Short uses ranges after consumption; monthly consumption never changes Short',()=>{
  const h=history(),s=h.freeze('s1','SHORT',h.head(),[h.participant(1)]);
  h.buy(300_000000n);h.terminal(s);
  const s2=h.freeze('s2','SHORT',h.head(),[h.participant(3,2)]);
  const monthly=h.freeze('m1','MONTHLY',h.head(),[h.participant(4)]);
  h.terminal(monthly,1);
  assert.equal(state(h,'MONTHLY').consumedTotal,'4');
  assert.equal(state(h).frozenByDraw[s2.drawId].count,'3');
  h.terminal(s2,1);assert.equal(state(h).consumedTotal,'4');
});

test('duplicate delivery is idempotent; a second on-chain FREEZE or TERMINAL is an error',()=>{
  const h=history(),d=h.freeze('s','SHORT',h.head(),[h.participant(1)]);h.terminal(d);
  const original=hash(run(h));h.blocks.push(structuredClone(h.blocks.at(-1)));
  assert.equal(hash(run(h)),original);h.blocks.pop();
  const r=h.blocks.at(-1).transactions[0].receipt;r.logs.push(structuredClone(r.logs[0]));
  assert.equal(hash(run(h)),original);r.logs.pop();
  h.terminal(d);assert.throws(()=>run(h),/no matching pending/);
  const h2=history(),d2=h2.freeze('reused','SHORT',h2.head(),[h2.participant(1)]);h2.terminal(d2);
  h2.freeze('reused','MONTHLY',h2.head(),[h2.participant(1)]);assert.throws(()=>run(h2),/already used/);
});

test('wrong draw, kind, snapshot, outcome or missing result marker fails closed',()=>{
  for(const bad of [{drawId:id('wrong')},{kind:1},{snapshotHash:id('wrong')},{outcome:2},{resultHash:ZeroHash}]){
    const h=history(),d=h.freeze('s','SHORT',h.head(),[h.participant(1)]);h.terminal(d,0,bad);
    assert.throws(()=>run(h));
  }
});

test('future/same-block, stale and noncanonical cutoffs are rejected',()=>{
  for(const offset of [1,2]){
    const h=history(),cutoff=h.head();cutoff.blockNumber+=offset;h.freeze('s','SHORT',cutoff,[h.participant(1)]);
    assert.throws(()=>run(h),/completed earlier block/);
  }
  const h=history(),cutoff=h.head();h.freeze('s','SHORT',{...cutoff,blockHash:id('orphan')},[h.participant(1)]);
  assert.throws(()=>run(h),/canonical ancestor/);
  const stale=history(),old=stale.head(),d=stale.freeze('s1','SHORT',old,[stale.participant(1)]);stale.terminal(d);
  stale.freeze('s2','SHORT',old,[]);assert.throws(()=>run(stale),/precedes previous terminal/);
});

test('operator cannot omit/invent participants or reuse snapshots across domains',()=>{
  for(const participants of [[],[{wallet:addr(999),count:'1',firstAttempt:'1',lastAttempt:'1'}]]){
    const h=history();h.freeze('s','SHORT',h.head(),participants);assert.throws(()=>run(h),/snapshot does not match/);
  }
  const h=history();h.freeze('s','SHORT',h.head(),[h.participant(1)]);
  for(const key of ['instanceId','sourceCodeHash']){
    assert.throws(()=>replayAttempts(h.manifest,{...h.config,[key]:id('different domain')},h.blocks),/snapshot does not match/);
  }
  // An identical event emitted by an unrelated address is not an authoritative lifecycle event.
  const foreign=structuredClone(h.blocks);foreign.at(-1).transactions[0].receipt.logs[0].address=addr(901);
  assert.equal(replayAttempts(h.manifest,h.config,foreign).draws.length,0);
});

test('full branch replay rolls back orphan FREEZE/TERMINAL without restoring consumed attempts ad hoc',()=>{
  const h=history(),base=structuredClone(h.blocks),d=h.freeze('s','SHORT',h.head(),[h.participant(1)]);
  const frozen=structuredClone(h.blocks);h.terminal(d);
  assert.equal(state(h).consumedTotal,'1');
  assert.equal(replayAttempts(h.manifest,h.config,frozen).wallets[0].SHORT.consumedTotal,'0');
  assert.equal(replayAttempts(h.manifest,h.config,frozen).wallets[0].SHORT.open,'0');
  assert.equal(replayAttempts(h.manifest,h.config,base).wallets[0].SHORT.open,'1');
});

test('BUY removed by reorg changes snapshot; surviving stale commitment halts',()=>{
  const h=history();h.buy(300_000000n);const cutoff=h.head();h.freeze('s','SHORT',cutoff,[h.participant(4)]);
  const branch=structuredClone(h.blocks),buy=branch.at(-2),freeze=branch.at(-1);
  buy.transactions=[];buy.hash=id('replacement empty block');freeze.parentHash=buy.hash;
  // Existing commitment referencing the old cutoff cannot simply be recomputed in place.
  assert.throws(()=>replayAttempts(h.manifest,h.config,branch),/canonical ancestor/);
  const replacement=history();replacement.empty('replacement empty block');
  replacement.freeze('s','SHORT',replacement.head(),[replacement.participant(1)]);
  assert.equal(run(replacement).draws[0].totalAttempts,'1');
});

test('empty snapshot is accounting-only, not proof of readiness; no invented attempts',()=>{
  const h=history(),cutoff={blockNumber:Number(BigInt(h.manifest.anchor.number)),blockHash:h.manifest.anchor.hash};
  const d=h.freeze('empty','SHORT',cutoff,[]);h.terminal(d);
  assert.equal(state(h).open,'1');assert.equal(state(h).consumedTotal,'0');
});

test('large cumulative counts and many wallets conserve attempts, deterministically',()=>{
  const h=history(),count=10n**20n;
  h.buy(count*100_000000n);
  const participants=[h.participant(count+1n)];
  for(let i=0;i<80;i++){const wallet=addr(10000+i);h.register(wallet);h.buy(100_000000n, wallet);participants.push(h.participant(1,1,wallet));}
  participants.sort((a,b)=>a.wallet<b.wallet?-1:1);
  const d=h.freeze('large','SHORT',h.head(),participants);h.terminal(d);
  const result=run(h);
  for(const w of result.wallets){assert.equal(w.SHORT.mintedTotal,w.SHORT.consumedTotal);assert.equal(w.MONTHLY.mintedTotal,w.MONTHLY.open);}
  assert.equal(result.wallets.find(w=>w.wallet===h.wallet).SHORT.consumedTotal,String(count+1n));
  assert.equal(canonical(replayAttempts(h.manifest,h.config,[...h.blocks].reverse())),canonical(result));
});

test('documented example has old Short consumed, new Short frozen and Monthly independent',()=>{
  const e=example(),r=replayAttempts(e.manifest,e.lifecycle,e.blocks),w=r.wallets[0];
  assert.equal(w.SHORT.consumedTotal,'1');assert.equal(w.SHORT.open,'0');
  assert.equal(Object.values(w.SHORT.frozenByDraw)[0].count,'3');
  assert.equal(Object.values(w.MONTHLY.frozenByDraw)[0].count,'4');
});
