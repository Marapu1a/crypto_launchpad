const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {ethers}=require('ethers');
const {BindingModel,diagnose,timeOf,GENESIS,outcomeDomain}=require('../scripts/drand-binding-model.cjs');
const seed=ethers.ZeroHash;
const zeroRound=1n+(100000n+3600n+1n+2n)/3n;
const verifier=(round,proof)=>{
  const canonical=round===zeroRound?ethers.ZeroHash:ethers.id('SYNTHETIC beacon '+round);
  if(proof.round!==round||proof.invalid||proof.seed!==canonical)throw Error('wrong proof');
  return canonical;
};
const make=(opts={})=>new BindingModel({verifier,...opts});
const input=(extra={})=>({id:'short',context:ethers.id('context'),chainTime:GENESIS+100000n,...extra});
const findings=[];

test('one target, immutable context, wrong proof, retry and late delivery; zero seed is valid',()=>{
  const m=make(),args=input(),d=m.freeze(args);assert(d.targetTime>args.chainTime+3600n);
  for(const change of [{},{context:ethers.id('replacement')},{chainTime:args.chainTime+86400n}])assert.throws(()=>m.freeze({...args,...change}),/already bound/);
  assert.throws(()=>m.deliver(d.id,{round:d.round+1n,seed}),/wrong proof/);
  assert.throws(()=>m.deliver(d.id,{round:d.round,seed:ethers.id('forged')}),/wrong proof/);
  assert.equal(m.draws.get(d.id).phase,'BOUND');
  // Delivery has no expiry or caller gate; simulated 30-day delay is diagnostic only.
  const lateWall=d.targetTime+30n*86400n;assert(lateWall>d.targetTime);
  m.deliver(d.id,{round:d.round,seed:ethers.ZeroHash});
  assert.throws(()=>m.finish(d.id,{fail:true}));assert.equal(m.draws.get(d.id).phase,'PROVEN');
  assert.equal(m.deliver(d.id,{round:d.round,seed:ethers.ZeroHash}),ethers.ZeroHash);
  m.finish(d.id);assert.equal(m.draws.get(d.id).budget,d.budget);
  assert.equal(m.draws.get(d.id).context,d.context);assert.equal(m.draws.get(d.id).round,d.round);
});

test('same beacon may serve Short and Monthly; domains differ, not the underlying signature',()=>{
  const m=make(),a=m.freeze(input()),b=m.freeze(input({id:'monthly',context:ethers.id('monthly context')}));
  assert.equal(a.round,b.round);for(const d of [a,b])m.deliver(d.id,{round:d.round,seed});
  assert.notEqual(outcomeDomain(a.context,seed),outcomeDomain(b.context,seed));
});

test('proof transaction reorg/restart preserves bound target; missing beacon never creates replacement',()=>{
  const m=make(),d=m.freeze(input()),snap=m.snapshot();m.deliver(d.id,{round:d.round,seed});m.restore(snap);
  assert.equal(m.draws.get(d.id).phase,'BOUND');assert.equal(m.draws.get(d.id).round,d.round);
  const restarted=make();restarted.restore(m.snapshot());restarted.deliver(d.id,{round:d.round,seed});
  assert.equal(restarted.draws.get(d.id).seed,seed);
  const never=make();never.freeze(input());assert.throws(()=>never.finish('short'));assert.equal(never.draws.get('short').phase,'BOUND');
});

test('counterexample: stale chain clock permits binding to an already public beacon',()=>{
  const wall=GENESIS+200000n,m=make(),d=m.freeze(input({chainTime:wall-7200n}));
  const observed=diagnose(d,{wallAtFreeze:wall,finalizedAt:wall+900n});assert.equal(observed.knownAtFreeze,true);
  findings.push({case:'stale-clock',chainTime:String(wall-7200n),wallAtFreeze:String(wall),round:String(d.round),targetTime:String(d.targetTime),...observed});
});

test('counterexample: freeze reorg after disclosure allows a different binding on replacement history',()=>{
  const m=make(),before=m.snapshot(),d=m.freeze(input()),wall=d.freezeTime;
  assert.equal(diagnose(d,{wallAtFreeze:wall,finalizedAt:d.targetTime+600n}).revealedBeforeFinality,true);
  m.restore(before);const replacement=m.freeze(input({chainTime:d.targetTime+1n}));assert.notEqual(replacement.round,d.round);
  findings.push({case:'freeze-reorg-after-disclosure',oldRound:String(d.round),newRound:String(replacement.round),
    conclusion:'Storage immutability applies within surviving chain history; a monitor cannot undo disclosure.'});
});

test('schedule avoids caller timing changes but late preparation becomes impossible; seal-time avoids that specific stall',()=>{
  const close=GENESIS+100000n,scheduled=make({mode:'schedule'});
  const first=scheduled.freeze(input({scheduleClose:close,chainTime:close}));
  const same=make({mode:'schedule'}).freeze(input({scheduleClose:close,chainTime:close+100n}));assert.equal(first.round,same.round);
  for(const delay of [0n,1n,86400n])assert.throws(()=>make({mode:'schedule'}).freeze(input({scheduleClose:close,chainTime:first.targetTime+delay})),/target due/);
  const fresh=make().freeze(input({chainTime:first.targetTime+86400n}));assert(fresh.targetTime>first.targetTime+86400n);
  findings.push({case:'late-schedule',conclusion:'A fixed expired target requires an explicit pre-freeze advancement policy; not implemented here.'});
});

test('timing sweep exposes the assumption boundary; fixed lead is not finality proof',()=>{
  let count=0,known=0,preFinality=0;
  const wall=GENESIS+300000n;
  for(const skew of [-86400n,-7200n,-3601n,-3600n,-1n,0n,1n,3600n])
    for(const lag of [0n,900n,3600n,7200n,86400n]){
      const d=make().freeze(input({chainTime:wall+skew})),v=diagnose(d,{wallAtFreeze:wall,finalizedAt:wall+lag});
      count++;known+=Number(v.knownAtFreeze);preFinality+=Number(v.revealedBeforeFinality);
      if(skew>=0n&&lag<=3600n)assert(!v.knownAtFreeze&&!v.revealedBeforeFinality);
    }
  assert(known>0&&preFinality>0);
  fs.mkdirSync('research/drand-binding',{recursive:true});
  fs.writeFileSync('research/drand-binding/model-result.json',JSON.stringify({schema:'drand-binding-model-v1',
    model:'JavaScript state machine, synthetic authenticated beacon stub; no EVM/BLS/finality enforcement',
    candidateLeadSeconds:3600,leadApproved:false,sweep:{cases:count,knownAtFreeze:known,revealedBeforeFinality:preFinality},findings,
    decision:'NO-GO for unconditional production guarantee; model works only under explicit clock/finality assumptions',
    next:'Choose a bounded clock/finality trust model and a pre-freeze delay policy before implementing a Solidity binding'},null,2)+'\n');
});
