import { isAddress, ZeroAddress, keccak256 } from 'ethers';
import { digest } from '../tickets/digest.mjs';

const hash = x => typeof x === 'string' && /^0x[0-9a-f]{64}$/i.test(x);
const uint = x => Number.isSafeInteger(x) && x >= 0;
const check = (v, message) => { if (!v) throw Error(message); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
export const policyIdentity = digest;

// Candidate execution policy, not a declaration that its contracts have been reviewed.
// Gas caps and clock bounds must be explicitly selected; local rehearsal values are not defaults.
export function validatePolicy(p) {
  check(p?.schema === 'short-production-policy-v1' && p.chainId === 4663, 'Invalid production policy');
  check(typeof p.projectId === 'string' && /^[0-9a-f-]{36}$/.test(p.projectId), 'Invalid project identity');
  for (const role of ['executor', 'publisher']) check(isAddress(p[role]) && p[role] !== ZeroAddress, 'Invalid signer role');
  check(!same(p.executor, p.publisher), 'Separate publisher and executor required');
  check(hash(p.buildHash) && uint(p.anchor?.number) && hash(p.anchor?.hash), 'Missing artifact/chain anchor');
  check(p.contracts && Object.keys(p.contracts).length > 0, 'Missing pinned contracts');
  const addresses = new Set();
  for (const c of Object.values(p.contracts)) {
    check(isAddress(c.address) && c.address !== ZeroAddress && hash(c.codeHash) && c.codeHash !== keccak256('0x'), 'Invalid runtime pin');
    check(!addresses.has(c.address.toLowerCase()), 'Duplicate contract pin'); addresses.add(c.address.toLowerCase());
  }
  for (const k of ['maxGasPrice', 'maxGasLimit', 'nativeFloor']) check(typeof p.limits?.[k] === 'string' && /^[1-9]\d*$/.test(p.limits[k]), 'Explicit gas budget required');
  for (const k of ['lead', 'clockLag', 'clockAhead', 'finalizedLag', 'beaconLag']) check(uint(p.timing?.[k]), 'Explicit timing policy required');
  const t = p.timing;
  check(t.clockLag > 0 && t.finalizedLag > 0 && t.beaconLag > 0 && t.lead <= 2592000 && t.lead > t.clockLag + t.clockAhead + t.finalizedLag, 'Invalid timing margin');
  return p;
}

export function blockRef(b) {
  check(b && uint(b.number) && uint(b.timestamp) && hash(b.hash), 'Invalid block observation');
  return { number: b.number, hash: b.hash, timestamp: b.timestamp };
}

// RPC absence is retryable. A contradictory chain/runtime observation is a hard failure.
export async function finalizedObservation(provider, now = Math.floor(Date.now() / 1000)) {
  check(uint(now), 'Invalid observation time');
  let latest, finalized;
  try { [latest, finalized] = await Promise.all([provider.getBlock('latest'), provider.getBlock('finalized')]); }
  catch { throw Object.assign(Error('Finality observation unavailable'), { code: 'FINALITY_WAIT' }); }
  if (!latest || !finalized) throw Object.assign(Error('Finality observation unavailable'), { code: 'FINALITY_WAIT' });
  const observation = { now, latest: blockRef(latest), finalized: blockRef(finalized) };
  check(finalized.number <= latest.number && finalized.timestamp <= latest.timestamp, 'Contradictory finality');
  for (const b of [latest, finalized]) check(same((await provider.getBlock(b.number))?.hash, b.hash), 'Changed observation branch');
  return observation;
}

export async function verifyProductionBindings(provider, policy) {
  if(policy?.schema==='draw-production-policy-v2')return (await import('./draw-policy.mjs')).verifyDrawPolicy(provider,policy);
  validatePolicy(policy);
  check((await provider.getNetwork()).chainId === 4663n, 'Wrong production chain');
  check(same((await provider.getBlock(policy.anchor.number))?.hash, policy.anchor.hash), 'Production anchor changed');
  for (const c of Object.values(policy.contracts)) {
    const code = await provider.getCode(c.address);
    check(code !== '0x' && same(keccak256(code), c.codeHash), 'Production runtime changed');
  }
}

// Snapshot identity is retained by the caller. Late confirmations go to a later snapshot.
export async function admitFinalizedSnapshot({ provider, policy, snapshot, availableAt = 0, now }) {
  await verifyProductionBindings(provider, policy);
  check(uint(snapshot?.number) && hash(snapshot?.hash) && uint(availableAt), 'Invalid snapshot boundary');
  let o;
  try { o = await finalizedObservation(provider, now); }
  catch (e) { if (e.code === 'FINALITY_WAIT') return { status: 'waiting', reason: 'finality-unavailable' }; throw e; }
  if (snapshot.number > o.finalized.number) return { status: 'waiting', reason: 'snapshot-finality' };
  check(same((await provider.getBlock(snapshot.number))?.hash, snapshot.hash), 'Snapshot branch changed');
  if (o.finalized.timestamp < availableAt) return { status: 'waiting', reason: 'recognition-finality' };
  if (o.now - o.latest.timestamp > policy.timing.clockLag || o.latest.timestamp - o.now > policy.timing.clockAhead || o.now - o.finalized.timestamp > policy.timing.finalizedLag)
    return { status: 'waiting', reason: 'chain-clock' };
  return { status: 'observed', policyHash: policyIdentity(policy), cutoff: { ...snapshot }, observation: o, authorizationToSend: false };
}
