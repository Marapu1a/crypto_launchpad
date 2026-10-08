import { Interface, isAddress, isHexString, ZeroAddress, ZeroHash } from 'ethers';
import { digest } from './digest.mjs';
import { recognize } from './recognition.mjs';

export const RECOGNITION = new Interface([
  'event PurchasesRecognized(bytes32 indexed instanceId,bytes32 indexed bundleHash,uint256 count)',
  'function confirm(bytes32 bundleHash,uint256 count)',
  'function instanceId() view returns(bytes32)',
  'function publisher() view returns(address)',
]);
const low = value => String(value).toLowerCase();
const check = (value, message) => { if (!value) throw Error('Late recognition: ' + message); };
export const bundleHash = bundle => '0x' + digest(bundle);
export const MAX_BUNDLE_BYTES = 1024 * 1024;
export function validateRecognition(config) {
  check(config?.adapter === 'local-verified-curve-v1', 'unknown adapter');
  for (const field of ['source', 'publisher']) check(isAddress(config[field]) && config[field] !== ZeroAddress, 'invalid ' + field);
  for (const field of ['instanceId', 'codeHash']) check(isHexString(config[field], 32) && config[field] !== ZeroHash, 'invalid ' + field);
  check(typeof config.deferDirectBuys === 'boolean', 'invalid deferral policy');
}
export function confirmationLogs(profile, receipt) {
  if (!profile.recognition) return [];
  return receipt.logs.filter(log => low(log.address) === low(profile.recognition.source)
    && low(log.topics[0]) === low(RECOGNITION.getEvent('PurchasesRecognized').topicHash));
}
export function deferDecision(profile, decision) {
  if (decision.status === 'UNSUPPORTED_ROUTE' || (profile.recognition?.deferDirectBuys && decision.status === 'ELIGIBLE' && decision.reason === 'SUPPORTED_BUY')) {
    return { ...decision, status: 'WAITING_RECOGNITION', reason: decision.reason };
  }
  return decision;
}

// Derived view only: stored original decisions and their block positions never change.
export function creditedEvents(state) {
  const events = state.blocks.flatMap(block => block.events).map(event => structuredClone(event));
  const config = state.profile.recognition;
  if (!config) return events;
  validateRecognition(config);
  const byId = new Map();
  for (const event of events) {
    check(!byId.has(event.candidateId), 'duplicate candidate');
    byId.set(event.candidateId, event);
  }
  const seen = new Set();
  for (const block of state.blocks) for (const confirmation of block.confirmations ?? []) {
    const { transaction, receipt, log, bundle } = confirmation;
    check(block.recognitionCodeHash === config.codeHash, 'source runtime mismatch');
    check(receipt.logs.some(item => digest(item) === digest(log)), 'missing confirmation log');
    check(confirmationLogs(state.profile, receipt).some(item => digest(item) === digest(log)), 'wrong source');
    check(BigInt(receipt.status) === 1n && low(receipt.blockHash) === low(block.hash)
      && low(receipt.transactionHash) === low(transaction.hash)
      && low(log.blockHash) === low(block.hash) && Number(BigInt(log.blockNumber)) === block.number
      && low(log.transactionHash) === low(transaction.hash) && !log.removed, 'confirmation branch');
    const parsed = RECOGNITION.parseLog(log), encoded = RECOGNITION.encodeEventLog(parsed.fragment, parsed.args);
    check(digest(encoded.topics.map(low)) === digest(log.topics.map(low)) && low(encoded.data) === low(log.data), 'noncanonical event');
    const [instanceId, committedHash, count] = parsed.args;
    check(low(transaction.from) === low(config.publisher) && low(transaction.to) === low(config.source)
      && BigInt(transaction.value) === 0n
      && low(transaction.input) === low(RECOGNITION.encodeFunctionData('confirm', [committedHash, count])), 'confirmation authority');
    check(low(instanceId) === low(config.instanceId) && count > 0n && count <= 50n && !seen.has(committedHash), 'invalid or duplicate commitment');
    seen.add(committedHash);
    check(bundle && Buffer.byteLength(JSON.stringify(bundle)) <= MAX_BUNDLE_BYTES && bundleHash(bundle) === committedHash, 'missing or corrupt bundle');
    check(bundle.schema === 'launchpad-local-recognition-v1' && bundle.profileHash === digest(state.profile)
      && Array.isArray(bundle.candidates) && bundle.candidates.length === Number(count), 'bundle domain/count');
    const within = new Set();
    for (const candidateId of bundle.candidates) {
      check(typeof candidateId === 'string' && !within.has(candidateId), 'duplicate purchase in bundle');
      within.add(candidateId);
      const original = byId.get(candidateId);
      check(original, 'unknown purchase');
      const sourceBlock = state.blocks.find(item => item.number === original.blockNumber);
      check(sourceBlock && sourceBlock.number < block.number && low(sourceBlock.hash) === low(original.blockHash), 'nonhistorical/orphan purchase');
      const rows = sourceBlock.evidence.filter(row => low(row.transaction.hash) === low(original.transactionHash));
      check(rows.length === 1, 'missing or ambiguous purchase evidence');
      const row = rows[0];
      check(low(row.receipt.blockHash) === low(sourceBlock.hash) && low(row.receipt.transactionHash) === low(row.transaction.hash)
        && row.receipt.logs.every(item => !item.removed && low(item.blockHash) === low(sourceBlock.hash)
          && low(item.transactionHash) === low(row.transaction.hash)), 'purchase branch');
      const decisions = recognize(state.profile, row.transaction, row.receipt);
      check(decisions.length === 1 && decisions[0].candidateId === candidateId && decisions[0].status === 'ELIGIBLE', 'purchase not verified by supported adapter');
      const verified = decisions[0];
      if (original.recognition) {
        check(original.recognition.decisionHash === digest(verified), 'conflicting repeat');
        continue;
      }
      check(original.status === 'WAITING_RECOGNITION', 'purchase already counted or ineligible');
      Object.assign(original, verified, {
        reason: 'VERIFIED_LATE_PURCHASE',
        recognition: { bundleHash: committedHash, decisionHash: digest(verified) },
        creditedAt: { blockNumber: block.number, blockHash: block.hash, transactionHash: transaction.hash,
          transactionIndex: Number(BigInt(log.transactionIndex)), logIndex: Number(BigInt(log.logIndex)) },
      });
    }
  }
  return events;
}
