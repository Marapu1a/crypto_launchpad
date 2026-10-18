import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertDrawFeePolicy,DRAW_FEE_POLICY,PW_FEE_POLICY} from '../../src/launch/fee-policy.mjs';
import {validateDrawLaunch} from '../../src/launch/draw-template.mjs';
import {validateDrawPolicy} from '../../src/worker/draw-policy.mjs';
import {createDrawOwnerCoordinator} from '../../server/owner-launch/draw-coordinator.mjs';
import {qianqiPreset} from '../../src/draws/config.mjs';
import {upgradeProgramDraft,igwMonthlyDraft} from '../../src/draws/program-config.mjs';
import {initialDraft} from '../../src/pons/plan.mjs';
import {USDG} from '../../src/launch/template.mjs';
import {validateProductionProfile} from '../../server/owner-launch/production-profile.mjs';
const input=()=>({id:'a5897d1a-def5-4c9f-a7bb-a76f2b16519e',slug:'policy-test',draft:{...initialDraft(),name:'Any name',symbol:'ANY',logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee',pair:USDG,creatorFee:'3',openingBuy:'0'},team:'0x'+'1'.repeat(40),operations:'0x'+'2'.repeat(40),draws:upgradeProgramDraft(qianqiPreset(),5000)});
test('PW graph is denied at input, pinned profile and worker admission before any RPC/signing',()=>{
 const blocked={feePolicyKind:PW_FEE_POLICY};
 assert.throws(()=>validateDrawLaunch({...input(),...blocked}),/PW holder launches disabled/);
 assert.throws(()=>createDrawOwnerCoordinator({profile:blocked}),/PW holder launches disabled/);
 assert.throws(()=>validateProductionProfile(blocked),/PW holder launches disabled/);
 assert.throws(()=>validateDrawPolicy({template:blocked}),/PW holder launches disabled/);
 assert.throws(()=>assertDrawFeePolicy({schema:'pattern-watcher-preparation-v1'}),/not executable/);
 assert.throws(()=>assertDrawFeePolicy({feePolicyKind:DRAW_FEE_POLICY},blocked),/PW holder launches disabled/);
 assert.throws(()=>assertDrawFeePolicy({feePolicyKind:'unknown'}),/Unsupported/);
});
test('Generic legacy USDG v2/v3 remain unchanged; explicit policy persists in draft',()=>{
 const old=input();assert.deepEqual(validateDrawLaunch(old).draws,old.draws);
 const monthly={...old,draws:igwMonthlyDraft(old.draws)};assert.equal(validateDrawLaunch(monthly).draws.version,3);
 assert.equal(validateDrawLaunch({...old,feePolicyKind:DRAW_FEE_POLICY}).feePolicyKind,DRAW_FEE_POLICY);
});
test('Production ETH requires operator-pinned generic graph, not a client assertion',()=>{
 const native={draws:{asset:'ETH'},feePolicyKind:DRAW_FEE_POLICY};
 assert.throws(()=>assertDrawFeePolicy(native,{mode:'production'}),/explicit pinned/);
 assert.doesNotThrow(()=>assertDrawFeePolicy(native,{mode:'production',feePolicyKind:DRAW_FEE_POLICY}));
 assert.doesNotThrow(()=>assertDrawFeePolicy(native,{mode:'rehearsal'}));
});
