import { Contract, id, isAddress, ZeroAddress } from 'ethers';
import { FACTORY, ROUTER } from '../pons/client.mjs';
import { ABI as LOCAL_ABI } from './local-worker.mjs';
import { RECOGNITION } from '../tickets/late-recognition.mjs';
import { verifyProductionBindings } from './production-policy.mjs';

export const check = (v, m) => { if (!v) throw Error(m); };
export const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const addressGetters = names => names.map(n => `function ${n}() view returns(address)`);
const uintGetters = names => names.map(n => `function ${n}() view returns(uint256)`);
const people = '(address wallet,uint128 firstAttempt,uint128 lastAttempt)[]';
export const ABI = {
  ...LOCAL_ABI,
  program: [...LOCAL_ABI.program.filter(s => !s.startsWith('function freeze(') && !s.startsWith('function settle(')),
    `function freeze(${people},(uint256 number,bytes32 blockHash,uint256 timestamp,bytes32 ledgerHash))`,
    `function settle(${people})`, 'function instanceId() view returns(bytes32)',
    'function PROFILE() view returns(bytes32)', ...uintGetters(['minimumUnit']),
    'function weights(uint256) view returns(uint256)', 'function solvent() view returns(bool)',
    'function checkpoints(uint256) view returns(uint256 number,bytes32 blockHash,uint256 timestamp,bytes32 ledgerHash)'],
  adapter: [...LOCAL_ABI.adapter, 'function verify(uint64,bytes) view returns(bool)',
    'function PROFILE() view returns(bytes32)',
    ...uintGetters(['leadSeconds', 'maxClockLag', 'maxClockAhead', 'maxFinalizedLag', 'maxBeaconLag'])],
  collector: [...LOCAL_ABI.collector, ...addressGetters(['factory'])],
  splitter: [...LOCAL_ABI.splitter, ...addressGetters(['team', 'operations']),
    'function bps(uint256) view returns(uint16)', 'function solvent() view returns(bool)'],
  curve: [...LOCAL_ABI.curve, ...addressGetters(['token', 'factory', 'pairToken', 'deployer', 'feeEscrow'])],
  quote: [...LOCAL_ABI.quote, 'function decimals() view returns(uint8)'],
  recognition: [...RECOGNITION.fragments, ...uintGetters(['availableAt']), 'function confirmed(bytes32) view returns(bool)'],
  factory: FACTORY, router: ROUTER,
};
export function contracts(provider, policy) {
  return Object.fromEntries(Object.entries(ABI).filter(([k]) => policy.contracts[k]).map(([k, abi]) => [k, new Contract(policy.contracts[k].address, abi, provider)]));
}
export function ticketProfile(policy) {
  return { chainId: '4663', ...Object.fromEntries(['factory', 'router', 'curve', 'token', 'quote', 'hook'].map(k => [k, policy.contracts[k].address])),
    registry: policy.contracts.program.address, quoteBasis: 'wallet-net-debit-v1' };
}
export async function verifyTemplate(provider, policy, blockTag = 'latest') {
  await verifyProductionBindings(provider, policy);
  const t = policy.template;
  check(t?.schema === 'short-template-v1' && /^0x[0-9a-f]{64}$/i.test(t.instanceId), 'Missing template identity');
  for (const k of ['thresholdRaw', 'minimumFund', 'minimumUnit', 'interval']) check(typeof t[k] === 'string' && /^[1-9]\d*$/.test(t[k]) && BigInt(t[k]) < 2n ** 256n, 'Invalid template ' + k);
  check(Array.isArray(t.weights) && t.weights.length > 0 && t.weights.length <= 64 && t.weights.every(n => Number.isSafeInteger(n) && n > 0), 'Invalid template weights');
  check(Array.isArray(t.bps) && t.bps.length === 3 && t.bps.every(n => Number.isSafeInteger(n) && n >= 0) && t.bps[0] > 0 && t.bps.reduce((a,b) => a+b) === 10000, 'Invalid split');
  check(Number.isSafeInteger(t.creatorTaxBps) && t.creatorTaxBps >= 0 && t.creatorTaxBps <= 1000, 'Invalid creator fee');
  for (const k of ['team', 'operations']) check(isAddress(t[k]) && !same(t[k], ZeroAddress), 'Invalid recipient');
  for (const k of [...Object.keys(ABI), 'token', 'hook']) check(policy.contracts[k], 'Missing template contract ' + k);
  const c = contracts(provider, policy), at = { blockTag };
  const a = k => policy.contracts[k].address;
  const expected = [
    ['program','PROFILE',id('launchpad-short-usdg-v1')], ['adapter','PROFILE',id('launchpad-short-drand-evmnet-v1')],
    ['program','quote',a('quote')], ['program','operator',policy.executor], ['program','randomness',a('adapter')], ['program','instanceId',t.instanceId],
    ['collector','quote',a('quote')], ['collector','destination',a('splitter')], ['collector','escrow',a('escrow')],
    ['collector','factory',a('factory')], ['collector','token',a('token')], ['collector','curve',a('curve')],
    ['splitter','quote',a('quote')], ['splitter','prizeFund',a('program')], ['splitter','team',t.team], ['splitter','operations',t.operations],
    ['curve','token',a('token')], ['curve','pairToken',a('quote')], ['curve','factory',a('factory')], ['curve','deployer',a('collector')], ['curve','feeEscrow',a('escrow')],
    ['recognition','instanceId',t.instanceId], ['recognition','publisher',policy.publisher], ['adapter','shortConsumer',a('program')],
    ['router','factory',a('factory')], ['factory','memeHook',a('hook')], ['quote','decimals',6],
    ...['interval','minimumFund','minimumUnit'].map(k => ['program',k,t[k]]),
    ...Object.entries({leadSeconds:'lead',maxClockLag:'clockLag',maxClockAhead:'clockAhead',maxFinalizedLag:'finalizedLag',maxBeaconLag:'beaconLag'}).map(([k,v]) => ['adapter',k,policy.timing[v]]),
  ];
  for (const [role, getter, value] of expected) check(same(await c[role][getter](at), value), 'Template binding mismatch: ' + role + '.' + getter);
  for (let i = 0; i < t.weights.length; i++) check(await c.program.weights(i,at) === BigInt(t.weights[i]), 'Weight mismatch');
  // Bounds revert is expected; a successful read proves a hidden extra weight.
  let extra = false; try { await c.program.weights(t.weights.length,at); extra = true; } catch (e) { if (e.code !== 'CALL_EXCEPTION') throw e; }
  check(!extra, 'Extra template weight');
  for (let i = 0; i < 3; i++) check(await c.splitter.bps(i,at) === BigInt(t.bps[i]), 'Split mismatch');
  const r = await c.factory.getLaunchedToken(a('token'),at);
  check(r.exists && same(r.token,a('token')) && same(r.curve,a('curve')) && same(r.pairToken,a('quote')) && same(r.creatorFeeRecipient,a('collector')) && !r.buybackEnabled && r.creatorTaxBps === BigInt(t.creatorTaxBps), 'Factory launch mismatch');
  check(await c.program.solvent(at) && await c.splitter.solvent(at), 'Insolvent template');
  return c;
}
