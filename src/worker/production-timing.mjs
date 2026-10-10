import { GENESIS, PERIOD, validateBeacon } from '../randomness/drand.mjs';

// Same operational model as QIANQI drand-timing-readiness; never a finality oracle.
export function assessTiming({ observation: o, timing: t, beacon }) {
  validateBeacon(beacon, beacon.round);
  const values = [o.now, o.latest.timestamp, o.finalized.timestamp, ...['lead', 'clockLag', 'clockAhead', 'finalizedLag', 'beaconLag'].map(k => t[k])];
  if (values.some(x => !Number.isSafeInteger(x) || x < 0) || o.latest.timestamp < GENESIS || o.finalized.timestamp > o.latest.timestamp) throw Error('Invalid timing observation');
  if (t.lead <= t.clockLag + t.clockAhead + t.finalizedLag || t.lead > 2592000 || !t.clockLag || !t.finalizedLag || !t.beaconLag) throw Error('Invalid timing policy');
  const beaconTime = GENESIS + (beacon.round - 1) * PERIOD;
  const targetRound = 1 + Math.ceil((o.latest.timestamp + t.lead + 1 - GENESIS) / PERIOD);
  const targetTime = GENESIS + (targetRound - 1) * PERIOD;
  const reasons = [];
  if (o.now - o.latest.timestamp > t.clockLag) reasons.push('staleChainClock');
  if (o.latest.timestamp - o.now > t.clockAhead) reasons.push('chainClockAhead');
  if (o.now - o.finalized.timestamp > t.finalizedLag) reasons.push('finalityLag');
  if (o.now - beaconTime > t.beaconLag) reasons.push('staleBeacon');
  if (beaconTime > o.now + t.clockAhead) reasons.push('beaconClockAhead');
  if (targetTime <= o.now || targetRound <= beacon.round) reasons.push('targetAlreadyKnown');
  if (targetTime - o.now <= o.now - o.finalized.timestamp) reasons.push('insufficientObservedHeadroom');
  return { status: reasons.length ? 'waiting' : 'observed', reasons, targetRound, targetTime, authorizationToSend: false };
}

// verify is the pinned adapter's on-chain BLS verifier at the observation block.
// A valid hash/shape from the HTTP beacon alone must not authorize a freeze.
export async function admitBeacon({ observation, timing, beacon, verify }) {
  if (typeof verify !== 'function' || !await verify(beacon.round, validateBeacon(beacon, beacon.round), observation.latest.number)) throw Error('Unverified beacon');
  return assessTiming({ observation, timing, beacon });
}
