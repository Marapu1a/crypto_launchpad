import {test} from 'node:test';
import assert from 'node:assert/strict';
import {qianqiPreset,validateConfig} from '../../src/draws/config.mjs';
import {upgradeProgramDraft,validateProgramConfig} from '../../src/draws/program-config.mjs';
import {createFundingPreview,previewFundingReceipt} from '../../src/draws/funding-preview.mjs';
const make=(mode='both',bps=5000)=>{const c=qianqiPreset();c.short.enabled=mode!=='monthly';c.monthly.enabled=mode!=='short';return upgradeProgramDraft(c,mode==='short'?10000:mode==='monthly'?0:bps);};
test('Three modes, explicit upgrade, legacy preservation and interval boundaries',()=>{
 const old=qianqiPreset(),before=JSON.stringify(old);upgradeProgramDraft(old,5000);assert.equal(JSON.stringify(old),before);
 for(const m of ['short','monthly','both'])assert.equal(validateProgramConfig(make(m)).version,2);
 const c=make();c.short.intervalSeconds=604800;validateProgramConfig(c);c.short.intervalSeconds++;assert.throws(()=>validateProgramConfig(c));
 old.short.intervalSeconds=604801;validateConfig(old);assert.throws(()=>upgradeProgramDraft(old,5000));
 for(const mutate of [c=>c.monthly.intervalSeconds=86400,c=>c.monthly.winnerCount=2,c=>c.allocation.shortBps=0,c=>c.allocation.shortBps=10000,c=>c.allocation.shortBps=1.1,c=>c.allocation.extra=1,c=>c.extra=1,c=>c.version=1]){const c=make();mutate(c);assert.throws(()=>validateProgramConfig(c));}
 assert.throws(()=>upgradeProgramDraft(qianqiPreset()));
});
test('Matches QIANQI S,C,S,C,S,N with persistent phase and Next cap',()=>{
 const c=make();c.monthly.nextReserve='0.000003';let s=createFundingPreview(c);const reference={short:0n,current:0n,next:0n};
 for(let i=0;i<150;i++){let lane=['short','current','short','current','short','next'][i%6];if(lane==='next'&&reference.next===3n)lane='current';reference[lane]++;const r=previewFundingReceipt(s,1n);s=r.state;for(const k of Object.keys(reference))assert.equal(s[k],reference[k]);}
});
test('All allocation ratios conserve receipts and ignore deposit fragmentation',()=>{
 for(let bps=1;bps<10000;bps+=137){const c=make('both',bps);c.monthly.nextReserve='0.000009';let s=createFundingPreview(c),total=0n;
 for(const n of [0n,1n,2n,7n,13n,9999n,50001n]){const r=previewFundingReceipt(s,n);assert.equal(Object.values(r.allocated).reduce((a,b)=>a+b,0n),n);assert.ok(Object.values(r.allocated).every(x=>x>=0n));s=r.state;total+=n;assert.equal(s.short+s.current+s.next,total);assert.ok(s.next<=9n);}
 assert.deepEqual(s,previewFundingReceipt(createFundingPreview(c),total).state);}
});
test('Single modes, independent states, invalid balances and uint256 limits',()=>{
 for(const mode of ['short','monthly']){const c=make(mode),s=createFundingPreview(c),r=previewFundingReceipt(s,600n);assert.equal(s.received,0n);if(mode==='short')assert.deepEqual(r.allocated,{short:600n,current:0n,next:0n});else assert.deepEqual(r.allocated,{short:0n,current:400n,next:200n});
 const max=(1n<<256n)-1n,full=previewFundingReceipt(s,max).state;assert.equal(full.short+full.current+full.next,max);assert.throws(()=>previewFundingReceipt(full,1n));assert.throws(()=>previewFundingReceipt({...s,current:1n},1n));assert.throws(()=>previewFundingReceipt(s,-1n));assert.throws(()=>previewFundingReceipt(s,1));}
});
