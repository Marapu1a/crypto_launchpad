import { keccak256 } from 'ethers';
import { digest } from './digest.mjs';
import { recognize } from './recognition.mjs';
import { replayTickets } from './ledger.mjs';
import { RECOGNITION, bundleHash } from './late-recognition.mjs';
import { participantsHash } from '../draws/short-outcome.mjs';
import { ticketProfile, check, same } from '../worker/production-template.mjs';

const hex = n => '0x' + BigInt(n).toString(16);
export function newLedger(policy) { return { head: { ...policy.anchor }, events: [], evidence: {}, confirmations: [], bundles: {} }; }
export function makeBundle(policy, ids) {
  check(ids.length > 0 && ids.length <= 50 && new Set(ids).size === ids.length, 'Invalid recognition batch');
  return { schema: 'production-recognition-v1', policyHash: digest(policy), candidates: [...ids].sort() };
}
export function verifiedCandidate(policy, ledger, candidateId) {
  const event = ledger.events.find(e => e.candidateId === candidateId), row = ledger.evidence[event?.transactionHash];
  check(event && row && row.receipt.blockHash === event.blockHash, 'Missing purchase evidence');
  const decoded = recognize(ticketProfile(policy), row.transaction, row.receipt);
  const verified = decoded.find(e => e.candidateId === candidateId);
  check(decoded.length === 1 && verified?.status === 'ELIGIBLE' && digest(verified) === digest(event), 'Unverified purchase');
  return verified;
}
export function creditedPurchases(policy, ledger, cutoff = ledger.head.number) {
  const credited = new Map();
  for (const notice of ledger.confirmations) {
    if (notice.number > cutoff) continue;
    const bundle = ledger.bundles[notice.hash];
    check(bundle && bundleHash(bundle) === notice.hash && bundle.schema === 'production-recognition-v1' && bundle.policyHash === digest(policy), 'Bundle identity mismatch');
    check(new Set(bundle.candidates).size === bundle.candidates.length && bundle.candidates.length === notice.count, 'Bundle count mismatch');
    for (const id of bundle.candidates) {
      const event = verifiedCandidate(policy, ledger, id);
      check(event.blockNumber < notice.number, 'Nonhistorical recognition');
      if (!credited.has(id)) credited.set(id, { ...event, creditedAt: notice.number });
    }
  }
  return [...credited.values()];
}

// Sequential finalized blocks, canonical receipts, no explorer/API-derived payer or amount.
// Bounded scan. The enclosing PostgreSQL lease commits cursor/evidence together.
export async function scanProductionLedger(provider, policy, ledger, finalized, limit = 250) {
  check(Number.isSafeInteger(limit) && limit > 0 && limit <= 500, 'Invalid scan batch limit');
  check(same((await provider.getBlock(ledger.head.number))?.hash, ledger.head.hash), 'Indexed finalized branch changed');
  check(finalized.number >= ledger.head.number, 'Finalized index moved backwards');
  const target = Math.min(finalized.number, ledger.head.number + limit), profile = ticketProfile(policy);
  for (let number = ledger.head.number + 1; number <= target; number++) {
    const block = await provider.send('eth_getBlockByNumber',[hex(number),true]);
    check(block && Number(BigInt(block.number)) === number && same(block.parentHash,ledger.head.hash), 'Discontinuous finalized history');
    const seen = new Set();
    for (const [index, transaction] of block.transactions.entries()) {
      const receipt = await provider.send('eth_getTransactionReceipt',[transaction.hash]);
      check(!seen.has(transaction.hash), 'Duplicate block transaction'); seen.add(transaction.hash);
      check(receipt && same(transaction.blockHash,block.hash) && same(receipt.blockHash,block.hash) && same(receipt.transactionHash,transaction.hash)
        && Number(BigInt(transaction.transactionIndex)) === index && Number(BigInt(receipt.transactionIndex)) === index
        && Number(BigInt(receipt.blockNumber)) === number && [0n,1n].includes(BigInt(receipt.status)), 'Receipt branch mismatch');
      let last = -1;
      for (const log of receipt.logs) {
        const position = Number(BigInt(log.logIndex));
        check(!log.removed && same(log.blockHash,block.hash) && same(log.transactionHash,transaction.hash) && Number(BigInt(log.blockNumber)) === number && Number(BigInt(log.transactionIndex)) === index && position > last, 'Log branch/order mismatch'); last = position;
      }
      const events = recognize(profile,transaction,receipt);
      if (events.length) { ledger.events.push(...events); ledger.evidence[transaction.hash] = { transaction, receipt }; }
      for (const log of receipt.logs.filter(l => same(l.address,policy.contracts.recognition.address) && l.topics[0] === RECOGNITION.getEvent('PurchasesRecognized').topicHash)) {
        const [instance, hash, count] = RECOGNITION.parseLog(log).args;
        check(BigInt(receipt.status) === 1n && same(instance,policy.template.instanceId) && same(transaction.from,policy.publisher) && same(transaction.to,policy.contracts.recognition.address)
          && BigInt(transaction.value) === 0n && same(transaction.input,RECOGNITION.encodeFunctionData('confirm',[hash,count])) && count > 0n && count <= 50n, 'Recognition authority mismatch');
        check(keccak256(await provider.getCode(policy.contracts.recognition.address,number)) === policy.contracts.recognition.codeHash, 'Recognition runtime changed');
        check(!ledger.confirmations.some(n => n.hash === hash), 'Duplicate recognition commitment');
        ledger.confirmations.push({ hash, count: Number(count), number, blockHash: block.hash, transactionHash: transaction.hash });
      }
    }
    ledger.head = { number, hash: block.hash, timestamp: Number(BigInt(block.timestamp)) };
  }
  check(same((await provider.getBlock(ledger.head.number))?.hash,ledger.head.hash), 'Scan branch changed');
  creditedPurchases(policy,ledger); // Missing bundles or bad evidence fail before durable cursor advance.
  replayTickets(ledger.events,policy.template.thresholdRaw); // Includes duplicate-ID validation.
  return ledger.head.number === finalized.number;
}
export async function snapshotProductionTickets(policy, ledger, program, cutoff = ledger.head) {
  const events = creditedPurchases(policy,ledger,cutoff.number), wallets = replayTickets(events,policy.template.thresholdRaw);
  const participants = [];
  for (const wallet of Object.keys(wallets).sort()) {
    const used = await program.consumedThrough(wallet), end = BigInt(wallets[wallet].tickets);
    check(used <= end, 'Consumed attempts exceed indexed history');
    if (used < end) participants.push({ wallet, firstAttempt: String(used + 1n), lastAttempt: String(end) });
  }
  check(participants.length <= 1000, 'Participant contract limit exceeded');
  const content = { policyHash: digest(policy), cutoff, events, participants };
  return { participants, participantsHash: participantsHash(participants), checkpoint: { number: cutoff.number, blockHash: cutoff.hash, timestamp: cutoff.timestamp,
    ledgerHash: '0x' + digest(content) } };
}
