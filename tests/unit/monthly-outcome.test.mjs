import {test} from 'node:test';
import assert from 'node:assert/strict';
import {id,ZeroHash} from 'ethers';
import {computeMonthly} from '../../src/draws/monthly-outcome.mjs';
const people=[{wallet:'0x'+'1'.repeat(40),firstAttempt:1n,lastAttempt:(1n<<128n)-1n}];
test('Monthly handles uint128 ranges and zero seed without mutating participants',()=>{
 const before=structuredClone(people);const r=computeMonthly(id('context'),ZeroHash,people,(1n<<256n)-1n);assert.deepEqual(people,before);assert.ok([0n,(1n<<256n)-1n].includes(r.awarded));assert.match(r.resultHash,/^0x[0-9a-f]{64}$/);
});
test('Monthly rejects malformed context, money, unsorted/duplicate or invalid ranges',()=>{
 for(const [context,seed,p,b] of [[ZeroHash,ZeroHash,people,1n],[id('c'),'bad',people,1n],[id('c'),ZeroHash,people,0n],[id('c'),ZeroHash,people,1n<<256n],[id('c'),ZeroHash,[],1n],[id('c'),ZeroHash,[...people,...people],1n],[id('c'),ZeroHash,[{...people[0],firstAttempt:0}],1n],[id('c'),ZeroHash,[{...people[0],lastAttempt:1n<<128n}],1n]])assert.throws(()=>computeMonthly(context,seed,p,b));
});
