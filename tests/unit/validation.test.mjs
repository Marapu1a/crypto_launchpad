import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { initialDraft, preparePlan } from '../../src/pons/plan.mjs';
import { validateDraft, requestFields } from '../../src/pons/validation.mjs';
import { createApiMiddleware, checkImage } from '../../server/api.mjs';
const account = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const draft = extra => ({ ...initialDraft(), name: 'Test Token', symbol: 'TEST', logo: 'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee', ...extra });
const terms = extra => ({ observedAt: new Date().toISOString(), configId: 0, cap: 1000, curveFeeBps: 100, economics: '0x' + 'ab'.repeat(32), quote: { address: initialDraft().pair, decimals: 18 }, ...extra });

test('Collects monetary errors without coercion or silent correction', () => {
  for (const value of ['-5000', '+1', '1e3', '01', 'NaN', {}, 1]) {
    const result = validateDraft(draft({ creatorFee: value, openingBuy: value }));
    assert.ok(result.errors.creatorFee); assert.ok(result.errors.openingBuy);
  }
  assert.ok(validateDraft(draft({ creatorFee: '1000' })).errors.creatorFee);
  const result = validateDraft(draft({ creatorFee: '3,25', openingBuy: '0,001' }), { terms: terms(), account });
  assert.equal(result.input.params.creatorTaxBps, 325); assert.equal(result.input.amount, 1000000000000000n);
});
test('Dynamic fee cap, precision, overflow and stale snapshots', () => {
  assert.ok(validateDraft(draft({ creatorFee: '3' }), { terms: terms({ cap: 200 }) }).errors.creatorFee);
  assert.ok(validateDraft(draft({ openingBuy: '0.0000001' }), { terms: terms({ quote: { address: initialDraft().pair, decimals: 6 } }) }).errors.openingBuy);
  assert.ok(validateDraft(draft({ openingBuy: '9'.repeat(78) }), { terms: terms() }).errors.openingBuy);
  assert.ok(validateDraft(draft(), { terms: terms({ observedAt: '2000-01-01' }), requireTerms: true }).errors._network);
  assert.ok(validateDraft(draft(), { terms: terms({ configCount: 0 }) }).errors.configId);
});
test('Metadata boundaries and unsafe links are checked', () => {
  for (const extra of [{ name: 'a'.repeat(33) }, { symbol: 'a'.repeat(11) }, { description: '😀'.repeat(257) }, { website: 'https://user:pass@example.com' }, { twitter: 'https://evil.test/user' }, { logo: 'ipfs://bafthisisnotacid' }, { logo: draft().logo + '/%2e%2e' }, { name: 'Hidden\u200bName' }]) assert.equal(validateDraft(draft(extra)).valid, false);
  assert.equal(validateDraft(draft({ description: '😀'.repeat(256) })).valid, true);
});
test('Untrusted structures fail before touching RPC', async () => {
  for (const value of [null, [], 'text', { ...draft(), injected: true }]) assert.equal(validateDraft(value).valid, false);
  assert.throws(() => requestFields({ draft: draft(), account, mode: 'read', terms: terms() }));
  await assert.rejects(() => preparePlan({}, draft({ openingBuy: '-1' }), account), error => !!error.fields.openingBuy);
});
test('Image validation decodes bytes and rejects spoofed MIME and geometry', async () => {
  const make = (width, height) => sharp({ create: { width, height, channels: 3, background: '#123456' } }).png().toBuffer();
  const square = await make(16, 16);
  assert.equal((await checkImage(square, 'image/png')).width, 16);
  for (const [buffer, type] of [[square, 'image/jpeg'], [await make(16, 15), 'image/png'], [square.subarray(0, 40), 'image/png'], [Buffer.from('<svg/>'), 'image/png'], [Buffer.alloc(0), 'image/png']]) await assert.rejects(() => checkImage(buffer, type), error => !!error.fields.image);
});
test('HTTP boundary rejects bypasses, malformed bodies and redacts provider errors', async () => {
  let calls = 0;
  const api = createApiMiddleware({ getProvider() { calls++; throw Error('https://rpc.example/SECRET'); } });
  const server = createServer(api); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/pons/prepare`;
  const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try {
    let response = await post({ draft: draft({ creatorFee: '1000', openingBuy: '-5000' }), account, mode: 'read' });
    assert.equal(response.status, 422); const data = await response.json(); assert.ok(data.fields.creatorFee); assert.ok(data.fields.openingBuy); assert.equal(calls, 0);
    assert.equal((await post('{')).status, 400);
    assert.equal((await post(' '.repeat(33000))).status, 413);
    assert.equal((await post({ draft: draft(), account, mode: 'read', calldata: '0x' })).status, 422);
    response = await post({ draft: draft(), account, mode: 'read' }); assert.equal(response.status, 503); assert.equal((await response.text()).includes('SECRET'), false); assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
