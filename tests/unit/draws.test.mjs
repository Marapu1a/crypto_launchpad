import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amount, equalWeights, previewBasket, previewShort, qianqiPreset, validateConfig } from '../../src/draws/config.mjs';
test('QIANQI basket reproduces known 100 and 200 USDG examples', () => {
  const config = qianqiPreset();
  for (const multiplier of [1, 2]) {
    const result = previewShort(config, amount(String(100 * multiplier)));
    assert.equal(result.ready, true);
    assert.deepEqual(result.prizes, [35, 20, 10, 5, 5, 5, 5, 5, 5, 5].map(n => amount(String(n * multiplier))));
  }
  assert.equal(previewShort(config, amount('99.999999')).ready, false);
});
test('Equal prizes conserve smallest units and retain indivisible remainder', () => {
  const basket = { weights: equalWeights(3), minimumUnit: '1' };
  const result = previewBasket(100000000n, basket);
  assert.deepEqual(result.prizes, [33333333n, 33333333n, 33333333n]);
  assert.equal(result.remainder, 1n);
  assert.equal(result.total + result.remainder, 100000000n);
});
test('Weighted arithmetic preserves ratios, funds and readiness at boundaries', () => {
  for (const weights of [[1], [7, 4, 2, 1], equalWeights(64)]) {
    const sum = weights.reduce((a, b) => a + BigInt(b), 0n);
    for (let budget = 0n; budget < sum * 3n; budget++) {
      const result = previewBasket(budget, { weights, minimumUnit: '0.000001' });
      assert.equal(result.ready, budget >= sum);
      assert.equal(result.total + result.remainder, budget);
      if (result.ready) weights.forEach((w, i) => assert.equal(result.prizes[i], budget / sum * BigInt(w)));
    }
  }
});
test('Configurations are independent; disabling Short prevents preview payouts', () => {
  const a = qianqiPreset(), b = qianqiPreset();
  a.short.enabled = false; a.ticketPurchase = '10'; a.fees = { prizesBps: 8000, teamBps: 1500, operationsBps: 500 };
  const copy = validateConfig(a); copy.short.basket.weights[0] = 1;
  assert.equal(a.short.basket.weights[0], 7); assert.equal(b.ticketPurchase, '100');
  assert.equal(previewShort(a, amount('100')).total, 0n);
  b.short.minimumFund = '200'; assert.equal(previewShort(b, amount('150')).ready, false);
});
test('Invalid settings fail without inventing a Monthly multi-winner algorithm', () => {
  for (const change of [c => c.fees.teamBps = 501, c => c.ticketPurchase = '-1', c => c.monthly.winnerCount = 2,
    c => c.short.basket.weights = [], c => c.short.basket.weights = [0], c => c.short.enabled = 'false',
    c => { c.short.enabled = false; c.monthly.enabled = false; }, c => c.extra = 1]) {
    const c = qianqiPreset(); change(c); assert.throws(() => validateConfig(c));
  }
  assert.throws(() => previewBasket(-1n, qianqiPreset().short.basket));
  assert.throws(() => equalWeights(65));
});
