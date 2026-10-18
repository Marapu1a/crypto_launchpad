import { keccak256 } from 'ethers';
import { digest } from './digest.mjs';
import {recognizeDraw as recognizeProduction,captureBatchContext} from './draw-recognition.mjs';
import {amount} from '../draws/config.mjs';
import { replayTickets } from './ledger.mjs';
import { RECOGNITION, bundleHash } from './late-recognition.mjs';
import { participantsHash } from '../draws/short-outcome.mjs';
import { check, same } from '../worker/production-template.mjs';
import {deferred,discoverPurchases,verifyDeferredProof,deferredBundle} from './deferred-recognition.mjs';

const hex = n => '0x' + BigInt(n).toString(16);
export function newLedger(policy) { return { head: { ...policy.anchor }, events: [], evidence: {}, confirmations: [], bundles: {} }; }
export function makeBundle(policy, ids, ledger) {
  check(ids.length > 0 && ids.length <= 50 && new Set(ids).size === ids.length, 'Invalid recognition batch');
  if(deferred(policy))return deferredBundle(policy,ledger,ids);
  return { schema: 'production-recognition-v1', policyHash: digest(policy), candidates: [...ids].sort() };
}
export function verifiedCandidate(policy, ledger, candidateId, proof) {
  if(deferred(policy))return verifyDeferredProof(policy,ledger,candidateId,proof??ledger.recognitionQueue?.proofs?.[candidateId]);
  const event = ledger.events.find(e => e.candidateId === candidateId), row = ledger.evidence[event?.transactionHash];
  check(event && row && row.receipt.blockHash === event.blockHash, 'Missing purchase evidence');
  const decoded = recognizeProduction(policy, row.transaction, row.receipt, row.context);
  const verified = decoded.find(e => e.candidateId === candidateId);
  check(decoded.length === 1 && verified?.status === 'ELIGIBLE' && digest(verified) === digest(event), 'Unverified purchase');
  return verified;
}
export function bundlePurchases(policy,ledger,bundle){
  check(bundle&&bundle.schema===(deferred(policy)?'draw-recognition-v2':'production-recognition-v1')&&bundle.policyHash===digest(policy),'Bundle identity mismatch');
  check(Array.isArray(bundle.candidates)&&bundle.candidates.length>0&&bundle.candidates.length<=50&&new Set(bundle.candidates).size===bundle.candidates.length,'Bundle count mismatch');
  if(deferred(policy))check(bundle.proofs?.length===bundle.candidates.length&&bundle.proofs.every((p,i)=>p.candidateId===bundle.candidates[i])&&JSON.stringify(bundle).length*3<=1100000,'Bundle proof binding mismatch');
  return bundle.candidates.map((id,i)=>verifiedCandidate(policy,ledger,id,deferred(policy)?bundle.proofs[i]:undefined));
}
export function creditedPurchases(policy, ledger, cutoff = ledger.head.number) {
  const credited = new Map();
  for (const notice of ledger.confirmations) {
    if (notice.number > cutoff) continue;
    const bundle = ledger.bundles[notice.hash];
    check(bundle && bundleHash(bundle) === notice.hash, 'Bundle identity mismatch');
    const events=bundlePurchases(policy,ledger,bundle);check(events.length===notice.count,'Bundle count mismatch');
    for (const event of events) {
      const id=event.candidateId;
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
  const target = Math.min(finalized.number, ledger.head.number + limit);
  // Fetch a bounded window concurrently; validation and ledger mutation stay ordered.
  let prefetched=new Map(),receipts=new Map();
  for (let number = ledger.head.number + 1; number <= target; number++) {
    if(!prefetched.has(number)){
      const numbers=Array.from({length:Math.min(10,target-number+1)},(_,i)=>number+i);
      const blocks=await Promise.all(numbers.map(n=>provider.send('eth_getBlockByNumber',[hex(n),true])));
      prefetched=new Map(numbers.map((n,i)=>[n,blocks[i]]));receipts=new Map();
      const hashes=blocks.flatMap(b=>b?.transactions?.map(t=>t.hash)??[]);let cursor=0;
      await Promise.all(Array.from({length:Math.min(10,hashes.length)},async()=>{while(cursor<hashes.length){const h=hashes[cursor++];receipts.set(h,await provider.send('eth_getTransactionReceipt',[h]));}}));
    }
    const block = prefetched.get(number);
    check(block && Number(BigInt(block.number)) === number && same(block.parentHash,ledger.head.hash), 'Discontinuous finalized history');
    const seen = new Set();
    for (const [index, transaction] of block.transactions.entries()) {
      const receipt = receipts.get(transaction.hash);
      check(!seen.has(transaction.hash), 'Duplicate block transaction'); seen.add(transaction.hash);
      check(receipt && same(transaction.blockHash,block.hash) && same(receipt.blockHash,block.hash) && same(receipt.transactionHash,transaction.hash)
        && Number(BigInt(transaction.transactionIndex)) === index && Number(BigInt(receipt.transactionIndex)) === index
        && Number(BigInt(receipt.blockNumber)) === number && [0n,1n].includes(BigInt(receipt.status)), 'Receipt branch mismatch');
      let last = -1;
      for (const log of receipt.logs) {
        const position = Number(BigInt(log.logIndex));
        check(!log.removed && same(log.blockHash,block.hash) && same(log.transactionHash,transaction.hash) && Number(BigInt(log.blockNumber)) === number && Number(BigInt(log.transactionIndex)) === index && position > last, 'Log branch/order mismatch'); last = position;
      }
      const context = deferred(policy)?undefined:await captureBatchContext(provider,policy,block,transaction,receipt);
      const events = deferred(policy)?discoverPurchases(policy,transaction,receipt):recognizeProduction(policy,transaction,receipt,context);
      if (events.length) { ledger.events.push(...events); ledger.evidence[transaction.hash] = { transaction, receipt, ...(context ? {context} : {}),...(deferred(policy)?{block:{number:block.number,hash:block.hash,parentHash:block.parentHash,timestamp:block.timestamp}}:{}) }; }
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
  replayTickets(ledger.events,String(amount(policy.template.config.ticketPurchase,undefined,policy.template.config.asset))); // Includes duplicate-ID validation.
  return ledger.head.number === finalized.number;
}
export async function snapshotProductionTickets(policy, ledger, program, cutoff = ledger.head) {
  const events = creditedPurchases(policy,ledger,cutoff.number), wallets = replayTickets(events,String(amount(policy.template.config.ticketPurchase,undefined,policy.template.config.asset)));
  const participants = [];
  for (const wallet of Object.keys(wallets).sort()) {
    const used = await program.consumedThrough(wallet), end = BigInt(wallets[wallet].tickets);
    check(used <= end, 'Consumed attempts exceed indexed history');
    if (used < end) participants.push({ wallet, firstAttempt: String(used + 1n), lastAttempt: String(end) });
  }
  check(participants.length <= 1000, 'Participant contract limit exceeded');
  const content = { program:program.target.toLowerCase(), policyHash: digest(policy), cutoff, events, participants };
  return { participants, participantsHash: participantsHash(participants), checkpoint: { number: cutoff.number, blockHash: cutoff.hash, timestamp: cutoff.timestamp,
    ledgerHash: '0x' + digest(content) } };
}
