import { Transaction, keccak256 } from 'ethers';
import { policyIdentity, verifyProductionBindings, finalizedObservation } from './production-policy.mjs';

const check = (v, message) => { if (!v) throw Error(message); };
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// Candidate sender primitive. No CLI/public route invokes it. Caller owns a durable
// store and a database lease covering chain+sender (not just project), and admits calldata.
// Signing keys are injected by a signer provider; they never enter config/state.
export async function advanceProductionTransaction({ provider, signer, policy, state, save, lease, admit, request, action, role = 'executor', hook = async () => {} }) {
  check(typeof lease === 'function' && typeof admit === 'function' && typeof save === 'function', 'Execution guards required');
  const guard = async () => { await lease(); await verifyProductionBindings(provider, policy); };
  await guard();
  const sender = await signer.getAddress();
  check(['executor', 'publisher'].includes(role) && same(sender, policy[role]), 'Wrong executor/publisher');
  check(state.schema === 'short-production-journal-v1' && state.identity === policyIdentity(policy) + (role === 'publisher' ? ':publisher' : '') && Array.isArray(state.history), 'Journal identity mismatch');
  check(!state.failure, 'Reverted operation requires reconciliation');
  const last = state.history.at(-1);
  if (last) check(same((await provider.getBlock(last.blockNumber))?.hash, last.blockHash), 'Finalized history changed');
  if (!state.pending) {
    if (!request) return { status: 'idle' };
    check(typeof action === 'string' && action.length > 0 && action.length <= 128, 'Missing operation identity');
    // Stable action ID makes a repeated caller request idempotent after confirmation.
    const intent = { to: String(request.to).toLowerCase(), data: request.data ?? '0x', value: String(request.value ?? 0) };
    check(intent.value === '0' && /^0x([0-9a-f]{2})*$/i.test(intent.data), 'Only zero-value contract calls allowed');
    check(Object.values(policy.contracts).some(c => same(c.address, intent.to)), 'Unpinned transaction target');
    const requestHash = policyIdentity(intent), prior = state.history.find(x => x.action === action);
    if (prior) { check(prior.requestHash === requestHash, 'Changed completed intent'); return { status: 'already-confirmed', hash: prior.hash }; }
    await admit({ action, request: intent, phase: 'prepare' });
    const [latest, pending] = await Promise.all([provider.getTransactionCount(sender, 'latest'), provider.getTransactionCount(sender, 'pending')]);
    if (latest !== pending) return { status: 'waiting', reason: 'external-pending-nonce' };
    const price = (await provider.getFeeData()).gasPrice;
    if (price === null || price <= 0n || price > BigInt(policy.limits.maxGasPrice)) return { status: 'waiting', reason: 'gas-price' };
    const gas = ((await provider.estimateGas({ ...intent, from: sender })) * 120n + 99n) / 100n;
    if (gas > BigInt(policy.limits.maxGasLimit)) return { status: 'waiting', reason: 'gas-limit' };
    if (await provider.getBalance(sender) < gas * price + BigInt(policy.limits.nativeFloor)) return { status: 'waiting', reason: 'native-balance' };
    await guard(); await admit({ action, request: intent, phase: 'sign' });
    const raw = await signer.signTransaction({ ...intent, chainId: 4663, nonce: latest, type: 0, gasPrice: price, gasLimit: gas });
    const tx = Transaction.from(raw);
    check(same(tx.from, sender) && same(tx.to, intent.to) && same(tx.data, intent.data) && tx.value === 0n && tx.chainId === 4663n && tx.nonce === latest && tx.type === 0 && tx.gasPrice === price && tx.gasLimit === gas, 'Signer changed intent');
    state.pending = { action, requestHash, raw, hash: keccak256(raw), nonce: latest, ...intent };
    await save(state); await hook('prepared');
  }
  const p = state.pending, tx = Transaction.from(p.raw);
  check(same(tx.from, sender) && tx.chainId === 4663n && tx.value === 0n && tx.type === 0 && tx.gasPrice > 0n && tx.gasPrice <= BigInt(policy.limits.maxGasPrice) && tx.gasLimit <= BigInt(policy.limits.maxGasLimit) && tx.nonce === p.nonce && tx.hash === p.hash && same(tx.to, p.to) && same(tx.data, p.data) && p.value === '0' && p.requestHash === policyIdentity({ to: p.to, data: p.data, value: p.value }) && Object.values(policy.contracts).some(c => same(c.address, p.to)), 'Pending intent mismatch');
  if (request) check(action === p.action && policyIdentity({ to: String(request.to).toLowerCase(), data: request.data ?? '0x', value: String(request.value ?? 0) }) === p.requestHash, 'Changed pending intent');
  let receipt = await provider.getTransactionReceipt(p.hash);
  if (!receipt) {
    check(await provider.getTransactionCount(sender, 'latest') <= p.nonce, 'Nonce consumed by another transaction');
    await guard(); await admit({ action: p.action, request: { to: p.to, data: p.data, value: p.value }, phase: 'broadcast' });
    // A lost RPC response leaves the signed operation intact. Never replace the round/nonce.
    const sent = await provider.broadcastTransaction(p.raw); check(sent.hash === p.hash, 'Broadcast hash mismatch');
    await hook('broadcast'); receipt = await provider.getTransactionReceipt(p.hash);
    if (!receipt) return { status: 'waiting', reason: 'receipt', hash: p.hash };
  }
  check(receipt.hash === p.hash && [0, 1].includes(receipt.status) && same((await provider.getBlock(receipt.blockNumber))?.hash, receipt.blockHash), 'Noncanonical receipt');
  let observation;
  try { observation = await finalizedObservation(provider); }
  catch (e) { if (e.code === 'FINALITY_WAIT') return { status: 'waiting', reason: 'finality-unavailable', hash: p.hash }; throw e; }
  if (receipt.blockNumber > observation.finalized.number) return { status: 'waiting', reason: 'receipt-finality', hash: p.hash };
  await guard();
  check(same((await provider.getBlock(receipt.blockNumber))?.hash, receipt.blockHash), 'Receipt branch changed');
  const resolved = { action: p.action, requestHash: p.requestHash, hash: p.hash, nonce: p.nonce, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, receiptStatus: receipt.status };
  state.history.push(resolved); delete state.pending;
  if (receipt.status === 0) state.failure = resolved;
  await save(state); await hook('confirmed');
  return { ...resolved, status: receipt.status === 1 ? 'confirmed' : 'blocked' };
}
