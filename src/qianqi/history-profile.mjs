import { createRequire } from 'node:module';
import { Interface, AbiCoder, keccak256 } from 'ethers';
import { check, low, integer } from './ticket-shadow.mjs';
import { snapshotDomain } from './history-replay.mjs';
import { qianqiProfile } from './shadow-reader.mjs';
const require = createRequire(import.meta.url), fields = require('./routes/genesis-fields.json');
export const factory = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
export const policy = '0x4C6fCD1645f15E6eCFc02E74A68ac81e3eD02738';
const rules = 'tuple(uint32 version,uint32 pNumerator,uint32 pDenominator,uint32 hNumerator,uint32 hDenominator)';
export const historyAbi = new Interface([
  ...['datasetRegistry', 'datasetVault', 'memeHook', 'token', 'pairToken', 'factory', 'feePolicy'].map(n => `function ${n}() view returns(address)`),
  ...['datasetInstance', 'monthlyInstance', 'instanceId', 'genesisHash', 'currentHash'].map(n => `function ${n}() view returns(bytes32)`),
  ...['shortRulesNotice', 'shortRulesStartedAt', 'monthlyInterval', 'monthlyStartedAt', 'monthlyRulesNotice', 'feeBps', 'publishedCount'].map(n => `function ${n}() view returns(uint256)`),
  `function shortEpochPolicy(uint64) view returns(tuple(${rules} outcome,uint256[] weights,uint256 minimumUnit,bytes32 hash,uint256 firstBlock))`,
  `function monthlyEpochPolicy(uint64) view returns(tuple(${rules} outcome,bytes32 hash,uint256 firstBlock))`,
  'function getLaunchedToken(address) view returns((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))',
]);
export async function readHistoryProfile(rpc, head, anchor) {
  const tag = '0x' + head.number.toString(16), { short, monthly, token } = qianqiProfile;
  const read = async (to, name, args = []) => historyAbi.decodeFunctionResult(name, await rpc('eth_call', [{ to, data: historyAbi.encodeFunctionData(name, args) }, tag]))[0];
  const codeHash = async address => keccak256(await rpc('eth_getCode', [address, tag]));
  const record = await read(factory, 'getLaunchedToken', [token]);
  check(record.exists && low(record.token) === token && record.phase === 0n, 'Profile requires ungraduated QIANQI');
  const profile = { schema: fields.schema, routeVersion: fields.routeVersion, chainId: 4663, eligibility: 'automatic-buy-v1', quoteBasis: 'wallet-net-debit-v1', quoteDecimals: 6, entryThresholdRaw: '100000000', anchor,
    factory, token: record.token, curve: record.curve, quote: record.pairToken, registry: await read(short, 'datasetRegistry'), hook: await read(factory, 'memeHook'), creatorTaxBps: Number(record.creatorTaxBps), hookFeeBps: Number(await read(record.curve, 'feeBps')), codeHashes: {} };
  for (const [key, [address, hash]] of Object.entries(fields.pins)) { profile[key] = address; profile.codeHashes[key] = hash; }
  for (const key of fields.fields) {
    const observed = await codeHash(profile[key]);
    if (profile.codeHashes[key]) check(observed === profile.codeHashes[key], 'Historical route pin mismatch');
    profile.codeHashes[key] = observed;
  }
  for (const [getter, key] of [['token', 'token'], ['pairToken', 'quote'], ['factory', 'factory'], ['feePolicy', 'hook']]) check(low(await read(profile.curve, getter)) === low(profile[key]), 'Curve binding mismatch');
  profile.poolKey = [...[profile.quote, profile.token].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1), String(record.poolFee), String(record.tickSpacing), profile.hook];
  profile.poolId = keccak256(AbiCoder.defaultAbiCoder().encode(['(address,address,uint24,int24,address)'], [profile.poolKey]));
  const sg = await read(short, 'shortEpochPolicy', [1]), mg = await read(monthly, 'monthlyEpochPolicy', [1]);
  const lifecycle = { source: short, sourceCodeHash: await codeHash(short), instanceId: await read(short, 'datasetInstance'), monthlySource: monthly, monthlySourceCodeHash: await codeHash(monthly), monthlyInstanceId: await read(monthly, 'monthlyInstance'), vault: await read(short, 'datasetVault'),
    shortRules: { rulesHash: sg.hash, noticeSeconds: String(await read(short, 'shortRulesNotice')), startedAt: String(await read(short, 'shortRulesStartedAt')), firstBlock: String(sg.firstBlock) },
    monthlyPolicy: { rulesHash: mg.hash, interval: String(await read(monthly, 'monthlyInterval')), startedAt: String(await read(monthly, 'monthlyStartedAt')) },
    monthlyRules: { noticeSeconds: String(await read(monthly, 'monthlyRulesNotice')), firstBlock: String(mg.firstBlock) } };
  lifecycle.vaultCodeHash = await codeHash(lifecycle.vault);
  const genesisHash = await read(policy, 'genesisHash');
  check(await read(policy, 'instanceId') === lifecycle.instanceId && await read(policy, 'currentHash') === genesisHash && await read(policy, 'publishedCount') === 0n, 'Unsupported BUY policy history');
  check(integer(sg.firstBlock) <= anchor.number && integer(mg.firstBlock) <= anchor.number, 'Rules start after token anchor');
  return { profile, lifecycle, policy: { address: policy, genesisHash, runtimeHash: await codeHash(policy) }, domain: snapshotDomain({ ...lifecycle, registry: profile.registry, quote: profile.quote, token: profile.token, genesisHash }) };
}
