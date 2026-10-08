import { getAddress, parseUnits, ZeroAddress } from 'ethers';
import { CID } from 'multiformats/cid';

export const DRAFT_FIELDS = ['name', 'symbol', 'description', 'logo', 'twitter', 'telegram', 'website',
  'discord', 'farcaster', 'pair', 'configId', 'feeWallet', 'creatorFee', 'destination', 'openingBuy', 'slippage', 'exemptions', 'salt'];
export const IDENTITY_FIELDS = ['name', 'symbol', 'description', 'logo', 'twitter', 'telegram', 'website', 'discord', 'farcaster'];
export const ECONOMICS_FIELDS = DRAFT_FIELDS.filter(key => !IDENTITY_FIELDS.includes(key));
export const IMAGE_LIMITS = { bytes: 5 * 1024 * 1024, side: 4096, types: ['image/png', 'image/jpeg', 'image/webp'] };
export const TERMS_MAX_AGE_MS = 60_000;
const UINT256_MAX = (1n << 256n) - 1n;
const bytes = value => new TextEncoder().encode(value).length;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;

export class ValidationError extends Error {
  constructor(fields) { super(Object.values(fields).join('; ')); this.name = 'ValidationError'; this.fields = fields; }
}
export const fieldError = (field, message) => new ValidationError({ [field]: message });
export function percentBps(value) {
  if (typeof value !== 'string' || value.length > 7 || !/^(?:0|[1-9]\d*)(?:[.,]\d{1,2})?$/.test(value.trim())) throw Error('Укажите процент без знака и экспоненты, до 2 знаков после запятой');
  return Number(parseUnits(value.trim().replace(',', '.'), 2));
}
function address(value, allowZero = false) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value.trim())) throw Error('Укажите полный адрес 0x… из 40 hex-символов');
  let normalized;
  try { normalized = getAddress(value.trim()); } catch { throw Error('Неверная контрольная сумма адреса'); }
  if (!allowZero && normalized === ZeroAddress) throw Error('Нулевой адрес недопустим');
  return normalized;
}
export function httpsUrl(value) {
  if (!value) return '';
  if (!/^https:\/\//i.test(value) || /[\s\\]/u.test(value)) throw Error('Укажите полную ссылку https:// без пробелов');
  let u;
  try { u = new URL(value); } catch { throw Error('Неверный адрес ссылки'); }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) throw Error('Ссылка должна быть https:// без логина и пароля');
  if (bytes(u.href) > 256) throw Error('Ссылка: максимум 256 байт UTF-8');
  return u.href;
}
function social(value, type) {
  if (!value) return '';
  let handle = value.replace(/^@/, '');
  const hosts = type === 'twitter' ? ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'] : ['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'];
  if (handle.includes('/')) {
    let u; try { u = new URL(handle.includes('://') ? handle : 'https://' + handle); } catch { throw Error('Неверная ссылка на аккаунт'); }
    if (!['https:', 'http:'].includes(u.protocol) || !hosts.includes(u.hostname) || u.username || u.password || u.port || u.search || u.hash) throw Error('Нужна ссылка на профиль X или Telegram без дополнительных параметров');
    handle = u.pathname.replace(/^\/|\/$/g, '');
  }
  const pattern = type === 'twitter' ? /^[A-Za-z0-9_]{1,15}$/ : /^[A-Za-z0-9_]{5,32}$/;
  if (!pattern.test(handle)) throw Error(type === 'twitter' ? 'X: 1–15 букв, цифр или подчёркиваний' : 'Telegram: 5–32 буквы, цифры или подчёркивания');
  return `https://${hosts[0]}/${handle}`;
}
export function ipfsUri(value) {
  if (!value.startsWith('ipfs://') || bytes(value) > 512 || /[\s?#\\]/u.test(value)) throw Error('Укажите ipfs:// адрес картинки, максимум 512 байт');
  const [cid, ...path] = value.slice(7).split('/');
  try { CID.parse(cid); } catch { throw Error('В ipfs:// адресе неверный CID'); }
  for (const part of path) {
    let decoded; try { decoded = decodeURIComponent(part); } catch { throw Error('Неверный путь IPFS'); }
    if (decoded === '.' || decoded === '..' || /[\s/?#\\\u0000-\u001f]/u.test(decoded)) throw Error('Неверный путь IPFS');
  }
  return value;
}
export function imageMetadataErrors({ size, type, width, height }) {
  if (!IMAGE_LIMITS.types.includes(type)) return 'Нужна картинка PNG, JPG или WebP';
  if (!Number.isSafeInteger(size) || size <= 0 || size > IMAGE_LIMITS.bytes) return 'Картинка должна быть непустой и не больше 5 МБ';
  if (width !== undefined && (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || width !== height || width > IMAGE_LIMITS.side)) return 'Нужна квадратная картинка размером до 4096 × 4096';
  return null;
}
export function termsMatch(terms, draft) {
  return !!terms && typeof draft.pair === 'string' && terms.quote?.address?.toLowerCase() === draft.pair.trim().toLowerCase() && terms.configId === Number(draft.configId);
}
export function termsFresh(terms) {
  const age = Date.now() - Date.parse(terms?.observedAt);
  return Number.isFinite(age) && age >= -5000 && age <= TERMS_MAX_AGE_MS;
}

// Pure shared rules: collect all errors, never coerce objects/numbers into money strings.
export function validateDraft(raw, { terms = null, account = '', requireAccount = false, requireTerms = false } = {}) {
  const errors = {}, values = {};
  const put = (key, message) => { errors[key] ??= message; };
  if (!plain(raw)) return { valid: false, errors: { _form: 'Черновик должен быть объектом' } };
  if (Object.keys(raw).some(key => !DRAFT_FIELDS.includes(key))) put('_form', 'В черновике есть неизвестные поля');
  for (const key of DRAFT_FIELDS) {
    if (typeof raw[key] !== 'string') { put(key, 'Поле должно быть строкой'); values[key] = ''; }
    else if (raw[key].length > 16_384) { put(key, 'Значение слишком длинное'); values[key] = ''; }
    else { values[key] = raw[key].trim(); if (controls.test(raw[key])) put(key, 'Уберите скрытые и управляющие символы'); }
  }
  const read = (key, fn) => { if (errors[key]) return; try { return fn(values[key]); } catch (e) { put(key, e.message); } };
  const name = read('name', v => { if (!/^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/.test(v) || v.length > 32) throw Error('Название: 1–32 символа, латиница, цифры и одиночные пробелы'); return v; });
  const symbol = read('symbol', v => { if (!/^[A-Za-z0-9]{1,10}$/.test(v)) throw Error('Тикер: 1–10 латинских букв или цифр'); return v.toUpperCase(); });
  const description = read('description', v => { if ([...v].length > 256 || bytes(v) > 2048) throw Error('Описание: до 256 символов'); return v; });
  const logo = read('logo', ipfsUri);
  const socials = {};
  for (const key of ['twitter', 'telegram']) socials[key] = read(key, v => social(v, key));
  for (const key of ['website', 'discord', 'farcaster']) socials[key] = read(key, httpsUrl);
  const pair = read('pair', v => address(v, true));
  const configId = read('configId', v => { if (!/^(0|[1-9]\d*)$/.test(v) || !Number.isSafeInteger(Number(v))) throw Error('Конфигурация: целое неотрицательное число'); return Number(v); });
  const matching = termsMatch(terms, values);
  if (matching && terms.configCount !== undefined && configId >= terms.configCount) put('configId', 'Конфигурация не существует');
  const cap = matching ? Math.min(1000, terms.cap, 2000 - terms.curveFeeBps) : 1000;
  const creatorTaxBps = read('creatorFee', v => { const n = percentBps(v); if (n > cap) throw Error(`Creator fee: от 0 до ${cap / 100}%`); return n; });
  const slippageBps = read('slippage', v => { const n = percentBps(v); if (n >= 10000) throw Error('Проскальзывание: от 0 до 99,99%'); return n; });
  const destination = read('destination', v => { if (!['wallet', 'buyback', 'holders'].includes(v)) throw Error('Выберите режим получения комиссий'); return v; });
  let launchingAccount;
  if (requireAccount || account) { try { launchingAccount = address(account); } catch (e) { put('account', e.message); } }
  // Holders uses the launcher, so an inactive wallet field has no monetary meaning.
  const feeRecipient = destination === 'holders' ? launchingAccount : values.feeWallet ? read('feeWallet', address) : launchingAccount;
  const salt = read('salt', v => { if (!/^0x[0-9a-fA-F]{64}$/.test(v)) throw Error('Неверный salt запуска: создайте новый черновик'); return v; });
  const amount = read('openingBuy', v => {
    if (!v) return 0n;
    const canonical = v.replace(',', '.');
    if (v.length > 160 || !/^(?:0|[1-9]\d*)(?:[.,]\d+)?$/.test(v)) throw Error('Сумма покупки: неотрицательное число без знака и экспоненты');
    const decimals = matching ? terms.quote.decimals : pair === ZeroAddress ? 18 : null;
    if (decimals === null) { if ((canonical.split('.')[1]?.length ?? 0) > 80 || BigInt(canonical.split('.')[0]) > UINT256_MAX) throw Error('Сумма покупки слишком велика'); return null; }
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 80) throw Error('Неподдерживаемая точность торговой пары');
    if ((canonical.split('.')[1]?.length ?? 0) > decimals) throw Error(`Сумма покупки: максимум ${decimals} знаков после запятой`);
    const n = parseUnits(canonical, decimals);
    if (n > UINT256_MAX) throw Error('Сумма покупки превышает uint256');
    return n;
  });
  const hasBuy = typeof amount === 'bigint' ? amount > 0n : /[1-9]/.test(values.openingBuy);
  const exemptions = read('exemptions', v => {
    const items = v.split(/[\s,;]+/).filter(Boolean);
    if (items.length > (hasBuy ? 31 : 32)) throw Error(`Исключений не больше ${hasBuy ? 31 : 32}`);
    const addresses = items.map(v => address(v));
    if (new Set(addresses.map(a => a.toLowerCase())).size !== addresses.length) throw Error('В исключениях есть повторяющиеся адреса');
    return addresses;
  });
  if (requireTerms && (!matching || !termsFresh(terms))) put('_network', 'Обновите условия выбранной пары перед продолжением');
  if (requireTerms && matching && (!/^0x[0-9a-fA-F]{64}$/.test(terms.economics) || /^0x0{64}$/.test(terms.economics))) put('_network', 'Не получена защита условий запуска');
  const valid = Object.keys(errors).length === 0;
  return { valid, errors, values, input: valid && matching ? {
    pair, configId, amount, slippageBps, exemptions,
    params: { name, symbol, logo, description, socials, creatorFeeRecipient: feeRecipient,
      creatorTaxBps, buybackEnabled: destination === 'buyback', expectedEconomics: terms.economics, salt },
  } : undefined };
}
export function assertDraft(raw, options) {
  const result = validateDraft(raw, options);
  if (!result.valid) throw new ValidationError(result.errors);
  return result;
}
export function requestFields(body) {
  if (!plain(body) || Object.keys(body).some(key => !['draft', 'account', 'mode'].includes(key))) throw fieldError('_form', 'Неверный состав запроса');
  if (!['read', 'fork'].includes(body.mode)) throw fieldError('_form', 'Неизвестное окружение');
  assertDraft(body.draft, { account: body.account, requireAccount: true });
  return body;
}
