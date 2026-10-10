import { keccak256 } from 'ethers';
import { recognize } from './recognition.mjs';
import batch from '../qianqi/routes/ordinary-batch.cjs';
import shape from '../qianqi/routes/pons-batch-buy.cjs';
import pins from '../qianqi/routes/genesis-fields.json' with { type:'json' };
import { ticketProfile, check, same } from '../worker/production-template.mjs';

// Reuse the reviewed QIANQI execution verifier, not its deployment/configuration.
// This version admits only USDG approve+buy self-batches; no native funding inference.
export function batchProfile(policy) {
  const pin = policy.contracts.batchExecutor;
  check(pin && same(pin.address,pins.pins.batchExecutor[0]) && same(pin.codeHash,pins.pins.batchExecutor[1]), 'Unreviewed batch executor');
  return {...ticketProfile(policy),batchExecutor:pin.address};
}
export function recognizeProduction(policy,transaction,receipt,context) {
  const ordinary = recognize(ticketProfile(policy),transaction,receipt);
  if (!policy.contracts.batchExecutor || !same(transaction.from,transaction.to) || !ordinary.length) return ordinary;
  const p = batchProfile(policy);
  // Unsupported call sequences remain uncredited; never fall through to the native adapter.
  if (shape.decode(p,transaction,receipt).status !== 'SHAPE_MATCH') return ordinary;
  check(context && same(context.hash,transaction.blockHash) && context.executorCodeHash === policy.contracts.batchExecutor.codeHash
    && context.parentExecutorCodeHash === context.executorCodeHash, 'Missing batch runtime provenance');
  return batch.decode(p,transaction,receipt,context);
}
export async function captureBatchContext(provider,policy,block,transaction) {
  if (!policy.contracts.batchExecutor || !same(transaction.from,transaction.to)) return;
  const p = batchProfile(policy), height = Number(BigInt(block.number)), parent = await provider.getBlock(height-1);
  check(parent && same(parent.hash,block.parentHash),'Batch parent changed');
  const [current,previous,account] = await Promise.all([
    provider.getCode(p.batchExecutor,height),provider.getCode(p.batchExecutor,height-1),provider.getCode(transaction.from,height-1),
  ]);
  return {hash:block.hash,parentHash:block.parentHash,timestamp:Number(BigInt(block.timestamp)),
    executorCodeHash:keccak256(current),parentExecutorCodeHash:keccak256(previous),
    transactions:block.transactions.map(tx=>({tx})),
    batchAccounts:{[transaction.from.toLowerCase()]:{parentHash:block.parentHash,code:account}}};
}
