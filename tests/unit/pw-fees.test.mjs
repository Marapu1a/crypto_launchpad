import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedPwFees} from '../../server/owner-launch/pw-fees.mjs';
import {pwConsoleError} from '../../server/owner-launch/pw-console.mjs';
test('provider headroom does not block a transaction that fits the approved ceiling',()=>{
 assert.deepEqual(boundedPwFees({maxFeePerGas:44000000n,maxPriorityFeePerGas:0n},22000000n,'42000000'),{maxFeePerGas:42000000n,maxPriorityFeePerGas:0n});
 assert.equal(boundedPwFees({maxFeePerGas:40000000n,maxPriorityFeePerGas:0n},20000000n,'42000000').maxFeePerGas,40000000n);
 assert.equal(boundedPwFees({maxFeePerGas:84000000n,maxPriorityFeePerGas:0n},42000000n,'42000000').maxFeePerGas,42000000n);
});
test('base fee plus tip must fit; missing fee data never weakens the ceiling',()=>{
 assert.throws(()=>boundedPwFees({maxFeePerGas:84000000n,maxPriorityFeePerGas:1n},42000000n,'42000000'),/exceeds/);
 assert.throws(()=>boundedPwFees({maxFeePerGas:90000000n},45000000n,'42000000'),/exceeds/);
 assert.throws(()=>boundedPwFees({maxFeePerGas:40000000n},null,'42000000'),/unavailable/);
});
test('only known policy errors become user-visible; provider secrets remain hidden',()=>{
 assert.match(pwConsoleError({code:'OWNER_LAUNCH',message:'Launch fee exceeds approved budget'}),/цена газа/);
 for(const code of ['SERVER_ERROR','OWNER_LAUNCH'])assert.ok(!pwConsoleError({code,message:'secret https://private.invalid/key'}).includes('secret'));
});
