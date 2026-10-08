// Configuration and preview only. No custody, RNG, ticket ledger or deployment.
import { parseUnits } from 'ethers';
const MAX = (1n << 256n) - 1n;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
function keys(value, allowed, path) {
  if (!plain(value) || Object.keys(value).some(k => !allowed.includes(k))) throw Error(`${path}: неверный состав полей`);
}
function integer(value, min, max, path) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error(`${path}: ожидается целое от ${min} до ${max}`);
  return value;
}
export function amount(value, path = 'Сумма') {
  if (typeof value !== 'string' || value.length > 80 || !/^(0|[1-9]\d*)(?:[.,]\d{1,6})?$/.test(value)) throw Error(`${path}: число с точностью до 6 знаков`);
  const result = parseUnits(value.replace(',', '.'), 6);
  if (result <= 0n || result > MAX) throw Error(`${path}: сумма вне допустимого диапазона`);
  return result;
}
export function equalWeights(count) {
  integer(count, 1, 64, 'Количество мест');
  return Array(count).fill(1);
}
export function validateBasket(basket) {
  keys(basket, ['weights', 'minimumUnit'], 'Корзина');
  if (!Array.isArray(basket.weights) || basket.weights.length < 1 || basket.weights.length > 64) throw Error('Корзина: от 1 до 64 мест');
  const weights = basket.weights.map(w => BigInt(integer(w, 1, Number.MAX_SAFE_INTEGER, 'Вес приза')));
  const sum = weights.reduce((a, b) => a + b, 0n);
  const minimumUnit = amount(basket.minimumUnit, 'Минимальная единица');
  if (sum * minimumUnit > MAX) throw Error('Корзина превышает uint256');
  return { weights, sum, minimumUnit, minimumBudget: sum * minimumUnit };
}
// Exact port of QIANQI ShortPrizeBasket.build: divide budget once, then multiply.
export function previewBasket(budget, basket) {
  if (typeof budget !== 'bigint' || budget < 0n || budget > MAX) throw Error('Бюджет: требуется uint256 bigint');
  const { weights, sum, minimumUnit, minimumBudget } = validateBasket(basket);
  const unit = budget / sum;
  if (unit < minimumUnit) return { ready: false, minimumBudget, missing: minimumBudget - budget, prizes: [], total: 0n, remainder: budget };
  const prizes = weights.map(w => unit * w);
  const total = unit * sum;
  return { ready: true, minimumBudget, missing: 0n, prizes, total, remainder: budget - total };
}
export function qianqiPreset() {
  return { version: 1, asset: 'USDG', ticketPurchase: '100',
    fees: { prizesBps: 9000, teamBps: 500, operationsBps: 500 },
    short: { enabled: true, intervalSeconds: 21600, minimumFund: '100',
      basket: { weights: [7, 4, 2, 1, 1, 1, 1, 1, 1, 1], minimumUnit: '5' } },
    monthly: { enabled: true, intervalSeconds: 2592000, minimumFund: '100',
      nextReserve: '100', winnerCount: 1 },
  };
}
export function validateConfig(config) {
  keys(config, ['version', 'asset', 'ticketPurchase', 'fees', 'short', 'monthly'], 'Программа');
  if (config.version !== 1 || config.asset !== 'USDG') throw Error('Поддерживается конфигурация v1 / USDG');
  amount(config.ticketPurchase, 'Покупки на билет');
  keys(config.fees, ['prizesBps', 'teamBps', 'operationsBps'], 'Доли комиссий');
  const total = ['prizesBps', 'teamBps', 'operationsBps'].reduce((sum, k) => sum + integer(config.fees[k], 0, 10000, k), 0);
  if (total !== 10000) throw Error('Доли комиссий должны составлять 100%');
  for (const kind of ['short', 'monthly']) {
    const lane = config[kind];
    keys(lane, kind === 'short' ? ['enabled', 'intervalSeconds', 'minimumFund', 'basket'] : ['enabled', 'intervalSeconds', 'minimumFund', 'nextReserve', 'winnerCount'], kind);
    if (typeof lane.enabled !== 'boolean') throw Error(`${kind}: enabled должен быть boolean`);
    integer(lane.intervalSeconds, 1, Number.MAX_SAFE_INTEGER, `${kind}: интервал`);
    amount(lane.minimumFund, `${kind}: минимальный фонд`);
  }
  validateBasket(config.short.basket);
  amount(config.monthly.nextReserve, 'Следующий месячный резерв');
  // Multi-winner Monthly requires a new outcome algorithm, not a basket substitution.
  if (config.monthly.winnerCount !== 1) throw Error('Monthly: несколько победителей ещё не реализованы');
  if (!config.short.enabled && !config.monthly.enabled) throw Error('Включите хотя бы один розыгрыш; без розыгрышей используйте базовый запуск Pons');
  if (!config.fees.prizesBps) throw Error('Включённым розыгрышам нужна ненулевая призовая доля');
  return structuredClone(config);
}
export function previewShort(config, budget) {
  validateConfig(config);
  const basket = previewBasket(budget, config.short.basket);
  const threshold = amount(config.short.minimumFund);
  const minimumBudget = threshold > basket.minimumBudget ? threshold : basket.minimumBudget;
  const ready = config.short.enabled && budget >= minimumBudget;
  return { ...basket, enabled: config.short.enabled, ready, minimumBudget,
    missing: budget < minimumBudget ? minimumBudget - budget : 0n,
    prizes: ready ? basket.prizes : [], total: ready ? basket.total : 0n,
    remainder: ready ? basket.remainder : budget };
}
