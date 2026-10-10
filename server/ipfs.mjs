import { CID } from 'multiformats/cid';
import { createHash } from 'node:crypto';

async function bytes(response, limit) {
  if (!response.ok) throw Error('IPFS request failed');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw Error('IPFS response too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Explicit operator configuration only; never accept an endpoint from the browser.
export function kuboPublisher({ endpoint = process.env.LAUNCHPAD_IPFS_API, fetcher = fetch } = {}) {
  if (!endpoint) return null;
  const base = new URL(endpoint);
  if (base.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw Error('IPFS API must be a loopback HTTP origin');
  return async (buffer, image) => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: image.type }), 'image');
    const signal = AbortSignal.timeout(45000);
    const result = JSON.parse((await bytes(await fetcher(new URL('/api/v0/add?pin=true&cid-version=1&raw-leaves=true&wrap-with-directory=false&progress=false', base), {
      method: 'POST', body: form, signal, redirect: 'error',
    }), 8192)).toString('utf8'));
    const cid = CID.parse(result.Hash).toV1().toString();
    const restored = await bytes(await fetcher(new URL('/api/v0/cat?arg=' + encodeURIComponent(cid), base), {
      method: 'POST', signal, redirect: 'error',
    }), buffer.length);
    if (!buffer.equals(restored)) throw Error('IPFS content differs');
    const pins = JSON.parse((await bytes(await fetcher(new URL('/api/v0/pin/ls?arg=' + encodeURIComponent(cid), base), {
      method: 'POST', signal, redirect: 'error',
    }), 8192)).toString('utf8'));
    if (!Object.entries(pins.Keys ?? {}).some(([key, value]) => CID.parse(key).equals(CID.parse(cid)) && ['recursive', 'direct'].includes(value.Type))) throw Error('IPFS pin missing');
    return { uri: 'ipfs://' + cid, sha256: createHash('sha256').update(buffer).digest('hex'), verifiedAt: new Date().toISOString(), storage: 'operator-kubo' };
  };
}
