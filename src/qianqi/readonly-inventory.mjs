import { Interface, keccak256 } from 'ethers';

const allowed = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call']);
export function readonlyRpc(transport) {
  return (method, params) => {
    if (!allowed.has(method)) throw Error('Read-only RPC method rejected');
    return transport(method, params);
  };
}
export const inventoryAbi = new Interface([
  ...['datasetVault', 'monthlyVault', 'projectToken', 'quoteToken', 'shortController', 'monthlyController', 'randomProvider'].map(n => `function ${n}() view returns(address)`),
  ...['freeShort', 'freeCurrent', 'freeNext', 'nextStartTarget', 'SHORT_INTERVAL', 'lastShortTerminalAt', 'monthlyInterval', 'lastMonthAt', 'minimumMonthlyBudget'].map(n => `function ${n}() view returns(uint256)`),
  'function reserved(address) view returns(uint256)', 'function claimable(address) view returns(uint256)',
  'function balanceOf(address) view returns(uint256)', 'function decimals() view returns(uint8)',
]);
const abi = inventoryAbi;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
function requireThat(ok, message) { if (!ok) throw Error(message); }

// Discovery is deliberately not execution admission or trusted deployment pinning.
export async function inspectQianqi({ overview, rpc: transport, short }) {
  const rpc = readonlyRpc(transport);
  requireThat(overview.schema === 'promo-overview-v1' && overview.status === 'observed', 'API unavailable or stale');
  requireThat(BigInt(await rpc('eth_chainId', [])) === 4663n && overview.provenance.chainId === '4663', 'Wrong chain');
  const head = overview.provenance.head;
  requireThat(Number.isSafeInteger(head.number) && head.number >= 0, 'Invalid API height');
  const tag = '0x' + head.number.toString(16);
  const block = await rpc('eth_getBlockByNumber', [tag, false]);
  requireThat(same(block.hash, head.hash) && BigInt(block.number) === BigInt(head.number), 'API block mismatch');
  const finalized = await rpc('eth_getBlockByNumber', ['finalized', false]);
  requireThat(BigInt(finalized.number) >= BigInt(block.number), 'API observation is not finalized');
  if (BigInt(finalized.number) === BigInt(block.number)) requireThat(same(finalized.hash, block.hash), 'Finalized hash mismatch');
  const read = async (to, name, args = []) => abi.decodeFunctionResult(name, await rpc('eth_call', [{ to, data: abi.encodeFunctionData(name, args) }, tag]))[0];
  const vault = await read(short, 'datasetVault');
  const monthly = await read(vault, 'monthlyController');
  const quote = await read(vault, 'quoteToken');
  const token = await read(vault, 'projectToken');
  requireThat(same(await read(vault, 'shortController'), short) && same(await read(monthly, 'monthlyVault'), vault), 'Controller binding mismatch');
  requireThat(same(quote, overview.asset.address) && Number(await read(quote, 'decimals')) === overview.asset.decimals, 'Asset mismatch');
  const shortRng = await read(short, 'randomProvider'), monthlyRng = await read(monthly, 'randomProvider');
  const contracts = {};
  for (const [role, address] of Object.entries({ short, monthly, vault, quote, token, shortRng, monthlyRng })) {
    const code = await rpc('eth_getCode', [address, tag]);
    requireThat(code !== '0x', 'Missing contract code');
    contracts[role] = { address: address.toLowerCase(), runtimeHash: keccak256(code) };
  }
  requireThat(same(contracts.quote.runtimeHash, overview.asset.codeHash), 'Asset runtime mismatch');
  const reserves = {};
  for (const n of ['freeShort', 'freeCurrent', 'freeNext', 'nextStartTarget']) reserves[n] = String(await read(vault, n));
  for (const n of ['reserved', 'claimable']) reserves[n] = String(await read(vault, n, [quote]));
  reserves.balance = String(await read(quote, 'balanceOf', [vault]));
  for (const [key, value] of Object.entries(reserves)) requireThat(value === overview.reserves[key], `Reserve mismatch: ${key}`);
  requireThat(['freeShort', 'freeCurrent', 'freeNext', 'reserved', 'claimable'].reduce((sum, key) => sum + BigInt(reserves[key]), 0n) <= BigInt(reserves.balance), 'Reserve deficit');
  const timing = {
    SHORT: { earliestAt: String(await read(short, 'lastShortTerminalAt') + await read(short, 'SHORT_INTERVAL')) },
    MONTHLY: { earliestAt: String(await read(monthly, 'lastMonthAt') + await read(monthly, 'monthlyInterval')), minimumRaw: String(await read(monthly, 'minimumMonthlyBudget')) },
  };
  for (const [lane, values] of Object.entries(timing)) for (const [key, value] of Object.entries(values)) requireThat(value === overview.draws[lane][key], `Timing mismatch: ${lane}/${key}`);
  requireThat(same((await rpc('eth_getBlockByNumber', [tag, false])).hash, block.hash), 'Block changed during observation');
  return { schema: 'qianqi-readonly-inventory-v1', block: { number: head.number, hash: block.hash }, finalized: { number: Number(BigInt(finalized.number)), hash: finalized.hash }, contracts, reserves, timing,
    limits: ['RPC-trusted canonicality; not an independent consensus proof', 'Discovered runtime hashes are observations, not trusted deployment pins', 'No ticket replay, active draw reconstruction, journal import or execution admission', 'Short minimum/prize policy and history payouts are not independently verified'] };
}
