import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { kuboPublisher } from '../../server/ipfs.mjs';
import { createApiMiddleware } from '../../server/api.mjs';
const cid = 'bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee';
test('IPFS configuration is explicit and loopback-only', () => {
  assert.equal(kuboPublisher({ endpoint: '' }), null);
  for (const endpoint of ['https://evil.test', 'http://127.0.0.1:5001/path', 'http://user:secret@127.0.0.1:5001']) assert.throws(() => kuboPublisher({ endpoint }));
});
test('Kubo requires matching readback and a pin; retries keep the same CID', async () => {
  const content = Buffer.from('image'), urls = [];
  for (const failure of ['', 'bytes', 'pin', 'cid']) {
    const publish = kuboPublisher({ endpoint: 'http://127.0.0.1:5001', fetcher: async (url, options) => {
      urls.push(url); assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
      if (url.pathname.endsWith('/add')) return Response.json({ Hash: failure === 'cid' ? 'invalid' : cid });
      if (url.pathname.endsWith('/cat')) return new Response(failure === 'bytes' ? 'wrong' : content);
      return Response.json({ Keys: failure === 'pin' ? {} : { [cid]: { Type: 'recursive' } } });
    } });
    if (failure) await assert.rejects(publish(content, { type: 'image/png' }));
    else { const a = await publish(content, { type: 'image/png' }), b = await publish(content, { type: 'image/png' }); assert.equal(a.uri, b.uri); assert.equal(a.uri, 'ipfs://' + cid); }
  }
  assert.equal(urls[0].searchParams.get('pin'), 'true');
});
test('Upload validates content before pinning and refuses remote or missing Origin', async t => {
  let calls = 0;
  const api = createApiMiddleware({ publishImage: async () => { calls++; throw Error('SECRET'); } });
  const server = createServer(api); await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'red' } }).png().toBuffer();
  for (const origin of [undefined, 'https://evil.test']) {
    const r = await fetch(base + '/api/pons/image-publish', { method: 'POST', headers: { 'content-type': 'image/png', ...(origin ? { origin } : {}) }, body: image }); assert.equal(r.status, 403);
  }
  const send = body => fetch(base + '/api/pons/image-publish', { method: 'POST', headers: { 'content-type': 'image/png', origin: base }, body });
  assert.equal((await send(Buffer.from('fake'))).status, 422); assert.equal(calls, 0);
  const result = await send(image); assert.equal(result.status, 503); assert.equal(calls, 1); assert.equal((await result.text()).includes('SECRET'), false);
});
