import { createRequire } from 'node:module';
import { isAddress, keccak256 } from 'ethers';
import { check, low, integer, replayWallet, compareWallet } from './ticket-shadow.mjs';
const require = createRequire(import.meta.url);
const { verify } = require('./routes/verify.cjs');
const { EVENTS } = require('../tickets/direct-curve.cjs');
const pins = require('./routes/pons-park-native-pins.json');

// QIANQI-specific reviewed profile, not a configurable launch template.
export const routeProfile = Object.freeze({ chainId: '4663',
  quote: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
  token: '0x6ea39a23aa46e51ca6cd2d1cbc0b5bfb29ecb216',
  curve: '0x12ba58b5455fdbc15165e0e8b2096498d2c684f1',
  weth: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  fundingPool: '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca',
});
const manifest = { ...routeProfile, codeHashes: Object.fromEntries(['quote', 'token', 'curve', 'weth', 'fundingPool'].map(k => [k, pins[routeProfile[k]]])) };
const trust = { adapter: 'pons-native-reviewed-v2', implementations: {
  quote: { address: '0x68184c449e1a8f34fa18d289737129fd27b66f8f', codeHash: pins['0x68184c449e1a8f34fa18d289737129fd27b66f8f'] },
  weth: { address: '0xc6b81b429797e0f555440b70cd99e032d7ae947e', codeHash: pins['0xc6b81b429797e0f555440b70cd99e032d7ae947e'] },
} };
export function verifyRoute({ proof, tx, receipt, block, parent, runtimes }) {
  check(low(tx.hash) === low(proof.transactionHash) && low(tx.blockHash) === low(proof.blockHash) && low(block.hash) === low(proof.blockHash), 'Wrong original transaction');
  check(integer(block.number) === integer(tx.blockNumber) && integer(parent.number) + 1 === integer(block.number) && low(parent.hash) === low(block.parentHash), 'Wrong original ancestry');
  check(low(block.transactions[integer(tx.transactionIndex)]) === low(tx.hash), 'Transaction absent from block');
  check(low(receipt.transactionHash) === low(tx.hash) && low(receipt.blockHash) === low(block.hash) && integer(receipt.blockNumber) === integer(block.number) && integer(receipt.transactionIndex) === integer(tx.transactionIndex), 'Wrong original receipt');
  check(BigInt(receipt.status) === 1n && low(receipt.from) === low(tx.from) && low(receipt.to) === low(tx.to), 'Wrong execution envelope');
  const seen = new Set();
  for (const log of receipt.logs) {
    const index = integer(log.logIndex);
    check(!log.removed && !seen.has(index) && low(log.blockHash) === low(block.hash) && low(log.transactionHash) === low(tx.hash) && integer(log.blockNumber) === integer(block.number) && integer(log.transactionIndex) === integer(tx.transactionIndex), 'Wrong original log'); seen.add(index);
  }
  const addresses = Object.keys(proof.codeHashes);
  check(addresses.length > 0 && addresses.length <= 100 && Object.keys(proof.parentCodeHashes).length === addresses.length, 'Invalid runtime evidence set');
  for (const address of addresses) {
    check(isAddress(address) && address === low(address), 'Invalid runtime address');
    const evidence = runtimes[address];
    check(evidence && keccak256(evidence.at) === proof.codeHashes[address] && keccak256(evidence.before) === proof.parentCodeHashes[address], 'Historical runtime mismatch');
  }
  const result = verify(manifest, trust, { tx, receipt }, proof, block);
  check(result.payer === result.recipient && isAddress(result.payer) && BigInt(result.grossQuoteRaw) > 0n, 'Invalid verified purchase');
  const logs = receipt.logs.filter(l => low(l.address) === routeProfile.curve && l.topics[0] === EVENTS.getEvent('CurveBuy').topicHash);
  check(logs.length === 1, 'Expected one curve purchase');
  return { ...result, transactionHash: low(tx.hash), blockHash: low(block.hash), blockNumber: integer(block.number), transactionIndex: integer(tx.transactionIndex), logIndex: integer(logs[0].logIndex),
    family: low(tx.to) === '0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc' ? '65050' : low(tx.to) === '0x9689992f5b5c09447f15906d8d11214944488341' || low(tx.to) === low(tx.from) ? 'park-native' : 'native-settlement' };
}

export function replayVerifiedCohort({ verified, events, anchor, head, apiWallets }) {
  const byWallet = new Map(), seen = new Set();
  for (const credit of verified) {
    check(!seen.has(credit.transactionHash), 'Duplicate verified purchase'); seen.add(credit.transactionHash);
    check(credit.creditedAt && credit.recognition, 'Missing verified credit commitment');
    if (!byWallet.has(credit.payer)) byWallet.set(credit.payer, []);
    byWallet.get(credit.payer).push({ ...credit, status: 'ELIGIBLE' });
  }
  const results = [];
  for (const [wallet, purchases] of byWallet) {
    const id = p => `4663:${p.blockHash}:${p.transactionHash}:${p.logIndex}`;
    purchases.sort((a, b) => a.creditedAt.blockNumber - b.creditedAt.blockNumber || a.creditedAt.transactionIndex - b.creditedAt.transactionIndex || a.creditedAt.logIndex - b.creditedAt.logIndex || id(a).localeCompare(id(b)));
    let carry = 0n;
    for (const p of purchases) { const amount = carry + BigInt(p.grossQuoteRaw); p.entriesMinted = String(amount / 100000000n); carry = amount % 100000000n; }
    const replay = replayWallet({ wallet, purchases, events, thresholdRaw: '100000000', anchor, head });
    const api = apiWallets.find(w => low(w.wallet) === wallet); check(api, 'Verified payer missing from API comparison');
    const differences = compareWallet(replay, api);
    for (const p of purchases) {
      const row = api.purchases.items.find(r => low(r.transactionHash) === p.transactionHash && integer(r.logIndex) === p.logIndex);
      if (!row || row.status !== 'ELIGIBLE' || row.grossQuoteRaw !== p.grossQuoteRaw || row.entriesMinted !== p.entriesMinted) differences.push(`purchase:${p.transactionHash}`);
    }
    results.push({ ...replay, differences });
  }
  check(apiWallets.every(w => byWallet.has(low(w.wallet))), 'API cohort has unverified wallets');
  return results;
}
