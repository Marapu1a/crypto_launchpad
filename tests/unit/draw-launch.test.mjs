import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initialDraft} from '../../src/pons/plan.mjs';
import {USDG,validateLaunch} from '../../src/launch/template.mjs';
import {validateDrawLaunch} from '../../src/launch/draw-template.mjs';
import {qianqiPreset} from '../../src/draws/config.mjs';
import {upgradeProgramDraft} from '../../src/draws/program-config.mjs';
const make=bps=>{const c=qianqiPreset();c.short.enabled=bps>0;c.monthly.enabled=bps<10000;return {id:randomUUID(),slug:'draw-test',draft:{...initialDraft(),name:'Draw',symbol:'DRAW',logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee',pair:USDG,creatorFee:'2',openingBuy:'0'},draws:upgradeProgramDraft(c,bps),team:'0x'+'1'.repeat(40),operations:'0x'+'2'.repeat(40)};};
test('V2 launch preserves each mode and rejects implicit v1 conversion',()=>{
 for(const bps of [0,3700,10000]){const input=make(bps),before=structuredClone(input),out=validateDrawLaunch(input);assert.deepEqual(out.draws,input.draws);assert.deepEqual(input,before);assert.throws(()=>validateLaunch(input));out.draws.allocation.shortBps=123;assert.equal(input.draws.allocation.shortBps,bps);}
 const old=make(10000);delete old.draws.allocation;old.draws.version=1;validateLaunch(old);assert.throws(()=>validateDrawLaunch(old));
});
test('V2 repeats Pons/address validation and rejects unsupported config before persistence',()=>{
 for(const change of [x=>x.draft.creatorFee='1000',x=>x.draft.openingBuy='-1',x=>x.draft.feeWallet=x.team,x=>x.draws.short.intervalSeconds=604801,x=>x.draws.monthly.winnerCount=2,x=>x.draws.allocation.shortBps=0,x=>x.extra=true,x=>x.team='bad']){const x=make(3700);change(x);assert.throws(()=>validateDrawLaunch(x));}
});
