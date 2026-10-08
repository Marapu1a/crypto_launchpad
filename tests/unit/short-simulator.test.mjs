import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { id } from 'ethers';
import { compute, threshold, QIANQI_RULES } from '../../src/draws/short-outcome.mjs';
import { simulateShort, parseParticipants, generateParticipants } from '../../src/draws/simulator.mjs';
import { qianqiPreset } from '../../src/draws/config.mjs';
const reference = createRequire(import.meta.url)('../../vendor/qianqi/scripts/short-outcome.cjs');
test('Matches frozen QIANQI reference including commitments for multiple seeds and baskets', () => {
  const context = id('comparison');
  for (const count of [1,10,100,1000]) {
    const participants = parseParticipants(generateParticipants(count === 1 ? 10 : count)).slice(0,count);
    for (const places of [1,10,64]) for (const seed of [id('a'),id('b')]) {
      const prizes = Array.from({length:places},(_,i)=>BigInt(places-i)*1000000n);
      assert.deepEqual(compute(context,seed,participants,QIANQI_RULES,prizes), reference.compute(context,seed,participants,QIANQI_RULES,prizes));
    }
  }
});
test('Admission arithmetic equals exact 0.8*x/(x+1), including uint128 maximum', () => {
  for (const n of [1n,2n,10n,(1n<<128n)-1n]) assert.equal(threshold(n,QIANQI_RULES),(1n<<256n)*4n*n/(5n*(n+1n)));
});
test('Repeatability, unique winners, funds conserved and context isolation', () => {
  const config=qianqiPreset(), text=generateParticipants(100);
  const a=simulateShort(config,100000001n,text,id('seed'),'project-a','1');
  assert.deepEqual(a,simulateShort(config,100000001n,text,id('seed'),'project-a','1'));
  assert.notEqual(a.context,simulateShort(config,100000001n,text,id('seed'),'project-b','1').context);
  assert.notEqual(a.context,simulateShort(config,100000001n,text,id('seed'),'project-a','2').context);
  assert.equal(new Set(a.result.winners).size,a.result.winners.length);
  assert.equal(a.paid+a.unawarded+a.rounding,100000001n);
  assert.equal(a.remaining,a.unawarded+a.rounding);
});
test('One participant may win a single random slot or none, without reroll', () => {
  const config=qianqiPreset(), text=generateParticipants(10).split('\n')[0];
  let win=false,none=false;
  for(let i=0;i<20;i++) {
    const output=simulateShort(config,100000000n,text,id(String(i)),'test','1');
    assert.ok(output.result.winners.length<=1);
    if(output.result.winners.length)win=true;
    else {none=true;assert.equal(output.remaining,100000000n);}
  }
  assert.ok(win&&none);
});
test('Rejects ambiguous participants and unavailable draws', () => {
  const line=generateParticipants(10).split('\n')[0];
  for(const text of [line+'\n'+line,line.replace(/ 1$/,' -1'),line.replace(/ 1$/,' '+(1n<<128n)), '0x'+'0'.repeat(40)+' 1']) assert.throws(()=>parseParticipants(text));
  assert.throws(()=>simulateShort(qianqiPreset(),100000000n,'',id('seed'),'test','1'),/Нет участников/);
  assert.throws(()=>simulateShort(qianqiPreset(),1n,line,id('seed'),'test','1'),/Недостаточно/);
  const disabled=qianqiPreset();disabled.short.enabled=false;
  assert.throws(()=>simulateShort(disabled,100000000n,line,id('seed'),'test','1'),/выключен/);
  assert.throws(()=>simulateShort(qianqiPreset(),100000000n,line,'0x01','test','1'),/seed/);
});
