import { Contract, Interface, JsonRpcProvider, ZeroAddress, keccak256 } from 'ethers';
import factoryAbi from './abi/launch-factory.json' with { type: 'json' };
import routerAbi from './abi/router.json' with { type: 'json' };
import candidates from './pair-candidates.json' with { type: 'json' };
import { fieldError } from './validation.mjs';

export const NETWORK = {
  chainId: 4663, rpc: 'https://rpc.mainnet.chain.robinhood.com',
  factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
  router: '0xe33E9E479dF8802cb0866d5d05258bEc4cF62948',
  holders: '0x70e95CC5f03DB2906081E7a8D16e4C4209291507',
  factoryHash: '0x89a27da6f703e0a7cdd4f233e7cb57604ff75b164530962d3ff7cf8483a67d84',
};
export const ERC20 = new Interface([
  'function decimals() view returns(uint8)', 'function symbol() view returns(string)',
  'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)',
]);
export const HOLDERS = new Interface([
  'function createFor(address token) returns(address)',
  'function distributorOf(address token) view returns(address)',
]);
export const FACTORY = new Interface(factoryAbi);
export const ROUTER = new Interface(routerAbi);
export const DIRECT = FACTORY.fragments.find(f => f.name === 'launchToken' && f.inputs.length === 4).format('sighash');
export const stringify = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v, 2);
export function providerFor(url = NETWORK.rpc) {
  return new JsonRpcProvider(url, undefined, { batchMaxCount: 10, cacheTimeout: -1 });
}
export async function readAt(provider, to, abi, method, args, blockTag) {
  const result = await provider.call({ to, data: abi.encodeFunctionData(method, args), blockTag });
  return abi.decodeFunctionResult(method, result);
}

// Every value belongs to one numeric block. No zero/default economics on RPC failure.
export async function readTerms(provider, { account = ZeroAddress, pair = ZeroAddress, configId = 0 } = {}) {
  const network = await provider.getNetwork();
  if (![4663n, 31337n].includes(network.chainId)) throw Error('Неподдерживаемая сеть');
  const block = await provider.getBlock('latest');
  if (!block?.hash) throw Error('Блок сети недоступен');
  const call = async (name, args = []) => (await readAt(provider, NETWORK.factory, FACTORY, name, args, block.number))[0];
  const count = await call('launchConfigCount');
  if (!Number.isSafeInteger(configId) || configId < 0 || BigInt(configId) >= count) throw fieldError('configId', 'Конфигурация Pons не существует');
  if (pair.toLowerCase() !== ZeroAddress && !await call('approvedPairTokens', [pair])) throw fieldError('pair', 'Pons не разрешает запуск с этой парой');
  const config = await call('getLaunchConfig', [configId]);
  if (!config.enabled) throw fieldError('configId', 'Конфигурация Pons выключена');
  const [fee, cap, enabled, canLaunch, economics, router, snipeSeconds, code] = await Promise.all([
    call('launchFee'), call('maxCreatorTaxBps'), call('launchEnabled'), call('canLaunch', [account]),
    call('previewLaunchEconomics', [configId, pair]),
    call('launchForwarder'), call('snipeTaxSeconds'),
    provider.getCode(NETWORK.factory, block.number),
  ]);
  if (keccak256(code) !== NETWORK.factoryHash) throw Error('Код фабрики изменился: профиль требует сверки');
  if (/^0x0{64}$/.test(economics)) throw Error('Не получена защита условий запуска');
  let quote = { address: pair, symbol: 'ETH', decimals: 18, phantomQuote: config.phantomQuote, graduationThreshold: config.graduationThreshold };
  if (pair.toLowerCase() !== ZeroAddress) {
    const [pairEconomics, decimals, symbol] = await Promise.all([
      readAt(provider, NETWORK.factory, FACTORY, 'pairTokenEconomics', [pair], block.number),
      readAt(provider, pair, ERC20, 'decimals', [], block.number),
      readAt(provider, pair, ERC20, 'symbol', [], block.number),
    ]);
    if (Number(decimals[0]) !== Number(pairEconomics[2])) throw Error('Decimals токена и конфигурации различаются');
    quote = { address: pair, symbol: symbol[0], decimals: Number(decimals[0]), phantomQuote: pairEconomics[0], graduationThreshold: pairEconomics[1] };
  }
  const again = await provider.getBlock(block.number);
  if (again?.hash !== block.hash) throw Error('Блок изменился во время чтения. Повторите проверку');
  const localInstanceId = network.chainId === 31337n ? (await provider.send('hardhat_metadata', [])).instanceId : null;
  return {
    chainId: Number(network.chainId), localInstanceId, block: block.number, blockHash: block.hash,
    observedAt: new Date().toISOString(), account, configId, configCount: Number(count),
    fee, cap: Number(cap), enabled, canLaunch, economics, router,
    supply: config.supply, curveFeeBps: Number(config.curveFeeBps), snipeSeconds: Number(snipeSeconds),
    quote,
  };
}

export async function listPairs(provider) {
  const block = await provider.getBlockNumber();
  const pairs = [{ address: ZeroAddress, symbol: 'ETH', name: 'Ether' }];
  // Candidate addresses are sourced from Pons UI; inclusion always requires live approval.
  for (let i = 0; i < candidates.length; i += 10) {
    const results = await Promise.all(candidates.slice(i, i + 10).map(async pair => ({ pair,
      approved: (await readAt(provider, NETWORK.factory, FACTORY, 'approvedPairTokens', [pair.address], block))[0],
    })));
    for (const result of results) if (result.approved) pairs.push(result.pair);
  }
  return pairs;
}

export async function launchRecord(provider, token) {
  return (await readAt(provider, NETWORK.factory, FACTORY, 'getLaunchedToken', [token], 'latest'))[0];
}

export function receiptLaunch(receipt, account) {
  if (Number(receipt.status) !== 1) throw Error('Транзакция завершилась с ошибкой');
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== NETWORK.factory.toLowerCase()) continue;
    let parsed;
    try { parsed = FACTORY.parseLog(log); } catch { continue; }
    if (parsed?.name === 'TokenLaunched' && parsed.args.deployer.toLowerCase() === account.toLowerCase()) {
      return { token: parsed.args.token, curve: parsed.args.curve, pair: parsed.args.pairToken, configId: String(parsed.args.launchConfigId) };
    }
  }
  throw Error('В receipt нет ожидаемого TokenLaunched');
}

export { Contract, ZeroAddress };
