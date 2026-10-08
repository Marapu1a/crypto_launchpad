import { getAddress, id, ZeroAddress, isHexString, ZeroHash } from 'ethers';
import { previewShort } from './config.mjs';
import { compute, admission, QIANQI_RULES } from './short-outcome.mjs';
export function parseParticipants(text) {
  if (typeof text !== 'string' || text.length > 150000) throw Error('Слишком большой список участников');
  const lines = text.trim() ? text.trim().split(/\r?\n/) : [];
  if (lines.length > 1000) throw Error('В симуляторе максимум 1000 участников');
  const seen = new Set();
  return lines.map((line, i) => {
    const [raw, count, ...extra] = line.trim().split(/\s+/);
    if (extra.length || !/^[1-9]\d*$/.test(count ?? '') || count.length > 39 || BigInt(count) >= (1n << 128n)) throw Error(`Строка ${i + 1}: адрес и положительное число билетов uint128`);
    let wallet; try { wallet = getAddress(raw).toLowerCase(); } catch { throw Error(`Строка ${i + 1}: неверный адрес`); }
    if (wallet === ZeroAddress || seen.has(wallet)) throw Error(`Строка ${i + 1}: нулевой или повторяющийся адрес`);
    seen.add(wallet); return { wallet, firstAttempt: 1n, lastAttempt: BigInt(count) };
  }).sort((a, b) => BigInt(a.wallet) < BigInt(b.wallet) ? -1 : 1);
}
export function generateParticipants(count) {
  if (![10,100,1000].includes(count)) throw Error('Выберите 10, 100 или 1000');
  return Array.from({length:count}, (_, i) => `0x${(i+1).toString(16).padStart(40,'0')} ${i % 20 + 1}`).join('\n');
}
export function simulateShort(config, budget, text, seed, instance, cycle) {
  if (!isHexString(seed,32)) throw Error('Тестовый seed должен быть bytes32');
  if (typeof instance !== 'string' || !instance.trim() || instance.length > 100 || !/^[1-9]\d{0,19}$/.test(cycle)) throw Error('Укажите имя тестового проекта и положительный номер цикла');
  const basket = previewShort(config,budget);
  if (!basket.ready) throw Error(config.short.enabled ? 'Недостаточно фонда для корзины' : 'Short выключен');
  const participants = parseParticipants(text);
  if (!participants.length) throw Error('Нет участников: розыгрыш ожидает, фонд сохраняется');
  // JSON tuple prevents ambiguous project/cycle concatenation; test context only.
  const context = id(JSON.stringify(['launchpad-short-simulator-v1',instance.trim(),cycle]));
  if (context === ZeroHash) throw Error('Неверный контекст');
  const result = compute(context,seed,participants,QIANQI_RULES,basket.prizes);
  const paid = result.amounts.reduce((a,b)=>a+b,0n);
  return { context, seed, result, participants: admission(context,seed,participants), prizes:basket.prizes,
    paid, unawarded:basket.total-paid, rounding:basket.remainder, remaining:budget-paid };
}
