import './style.css';
import { formatEther, formatUnits, getAddress } from 'ethers';
import { NETWORK, ZeroAddress, providerFor, readTerms, listPairs, stringify } from './pons/client.mjs';
import { initialDraft } from './pons/plan.mjs';
import { prepareOnServer, checkImageOnServer } from './pons/api-client.mjs';
import { validateDraft, DRAFT_FIELDS, IDENTITY_FIELDS, termsMatch, termsFresh, imageMetadataErrors } from './pons/validation.mjs';
import { assertLocalFork, executeLocalLaunch, continueLocalHolders, sendLocal, reconcileJournal, verifyLaunch } from './pons/local-execution.mjs';

const KEY = 'crypto-launchpad:pons:v1';
const app = document.querySelector('#app');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = value => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Не подключён';
function stored() { try { const value = JSON.parse(localStorage.getItem(KEY)); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
const saved = stored();
const restored = saved.draft && typeof saved.draft === 'object' && !Array.isArray(saved.draft) ? saved.draft : {};
let draft = { ...initialDraft(), ...Object.fromEntries(DRAFT_FIELDS.filter(k => Object.hasOwn(restored, k)).map(k => [k, typeof restored[k] === 'string' ? restored[k] : ''])) }, mode = saved.mode === 'fork' ? 'fork' : 'read';
let account = typeof saved.account === 'string' ? saved.account : '', stage = 1, terms, pairs = [{ address: ZeroAddress, symbol: 'ETH', name: 'Ether' }];
let touched = new Set(), attempted = new Set(), serverErrors = {}, imageRequest = 0;
let plan, journal = Array.isArray(saved.journal) ? saved.journal : [], result = saved.result, busy = false, message = '', tone = '', requestId = 0, localImage;
let provider = providerFor(mode === 'fork' ? 'http://127.0.0.1:8545' : NETWORK.rpc);
function persist() {
  if (plan) saved.reviewed = plan;
  localStorage.setItem(KEY, stringify({ draft, account, mode, journal, result, reviewed: saved.reviewed }));
}
function feedback(text, status = '') { message = text; tone = status; renderMessage(); }
function renderMessage() { const e = document.querySelector('#notice'); if (e) { e.textContent = message; e.className = `notice ${tone}`; e.hidden = !message; } }
const field = (name, label, placeholder = '', extra = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${escape(draft[name])}" placeholder="${placeholder}" ${extra}></label>`;
function format(value, decimals = 18) { return Number(formatUnits(value, decimals)).toLocaleString('ru-RU', { maximumFractionDigits: 6 }); }
function option(value, label, selected) { return `<option value="${escape(value)}" ${value.toLowerCase() === String(selected).toLowerCase() ? 'selected' : ''}>${escape(label)}</option>`; }
function destination(value, title, description) { return `<label class="destination"><input type="radio" name="destination" value="${value}" ${draft.destination === value ? 'checked' : ''}><span><strong>${title}</strong><small>${description}</small></span></label>`; }

function identity() {
  return `<div class="section-heading"><span class="eyebrow">01 / ТОКЕН</span><h2>Начнём с идеи.</h2><p>Имя, образ и несколько слов о вашем проекте.</p></div>
    <div class="image-row"><div id="image-preview" class="token-image">↗</div><div><label class="button secondary file-button">Выбрать картинку<input id="image-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></label><p class="hint">Квадратная · PNG, JPG или WebP · до 5 МБ · до 4096 × 4096</p></div></div>
    ${field('logo', 'Картинка в IPFS', 'ipfs://…')}<p class="hint">Пока нужен адрес уже опубликованной картинки. Выбор файла показывает локальный предпросмотр.</p>
    <div class="two">${field('name', 'Название', 'It Gets Worse', 'maxlength="32" required')}${field('symbol', 'Тикер', 'IGW', 'maxlength="10" required')}</div>
    <label class="field"><span>Описание <small>до 256 символов</small></span><textarea name="description" rows="3" placeholder="Что стоит за вашим токеном?">${escape(draft.description)}</textarea></label>
    <div class="two">${field('twitter', 'X', '@handle')}${field('telegram', 'Telegram', '@channel')}</div>${field('website', 'Сайт', 'https://')}
    <details><summary>Дополнительные ссылки</summary><div class="two">${field('discord', 'Discord', 'https://discord.gg/…')}${field('farcaster', 'Farcaster', 'https://…')}</div></details>`;
}
function economics() {
  return `<div class="section-heading"><span class="eyebrow">02 / ЭКОНОМИКА</span><h2>Задайте условия запуска.</h2><p>Пара, комиссии и первая покупка через Pons.</p></div>
    <label class="field"><span>Торговая пара</span><select name="pair">${pairs.map(p => option(p.address, `${p.symbol} — ${p.name}`, draft.pair)).join('')}</select></label>
    <div class="two">${field('creatorFee', 'Creator fee, %', '0', 'type="text" inputmode="decimal"' + (terms ? ` max="${terms.cap / 100}"` : ''))}${field('openingBuy', 'Стартовая покупка', '0', 'inputmode="decimal"')}</div>
    <p class="hint" id="fee-hint">${terms ? `Базовая комиссия ${terms.curveFeeBps / 100}% + выбранная creator fee (до ${terms.cap / 100}%). Покупка — в ${escape(terms.quote.symbol)}.` : 'Загружаем условия сети…'}</p>
    <button type="button" class="button text" id="refresh-terms">Обновить условия сети</button>
    <h3>Куда идут комиссии</h3><div class="destinations">
    ${destination('wallet', 'На кошелёк', 'Комиссии накапливаются в Pons и доступны получателю.')}
    ${destination('buyback', 'Buyback & vest', 'Часть дохода выкупает токен с последующим постепенным получением.')}
    ${destination('holders', 'Держателям', 'После запуска создаём distributor и направляем ему комиссии.')}</div>
    <div id="fee-wallet">${field('feeWallet', 'Кошелёк получателя', 'По умолчанию — кошелёк запуска')}</div>
    <details><summary>Дополнительные параметры</summary>
    <div class="two">${field('slippage', 'Проскальзывание покупки, %', '2', 'type="text" inputmode="decimal"')}
    <label class="field"><span>Конфигурация Pons</span><select name="configId">${Array.from({ length: terms?.configCount ?? 1 }, (_, i) => option(String(i), `Конфигурация ${i}`, draft.configId)).join('')}</select></label></div>
    ${field('exemptions', 'Дополнительные исключения snipe tax', 'Адреса через запятую')}<p class="hint">Дополнительная возможность контракта. До 32 адресов, со стартовой покупкой — до 31.</p>
    <p class="hint mono">Salt: ${escape(draft.salt)}</p></details>`;
}
function review() {
  const nativeCost = plan ? plan.terms.fee + (plan.input.pair === ZeroAddress ? plan.input.amount : 0n) : null;
  return `<div class="section-heading"><span class="eyebrow">03 / ПРОВЕРКА</span><h2>Всё готово к проверке.</h2><p>Симуляция проверит создание токена с выбранными параметрами.</p></div>
    <label class="field"><span>Кошелёк запуска</span><input id="account" value="${escape(account)}" placeholder="0x…"></label>
    <p class="hint">${mode === 'fork' ? 'Используется тестовый кошелёк локальной копии сети.' : 'Подключите кошелёк или укажите публичный адрес для симуляции.'}</p>
    <div class="review-list"><div><span>Режим</span><strong>${mode === 'fork' ? 'Локальный fork' : 'Чтение основной сети'}</strong></div>
    <div><span>Получатель комиссий</span><strong>${draft.destination === 'holders' ? 'Держатели' : escape(short(draft.feeWallet || account))}</strong></div>
    <div><span>Стартовая покупка</span><strong>${escape(draft.openingBuy || '0')} ${escape(terms?.quote.symbol || '')}</strong></div>
    <div><span>Отправляется ETH</span><strong>${nativeCost !== null ? format(nativeCost) : '—'}</strong></div>
    <div><span>Оценка gas</span><strong>${plan?.gasCost ? format(plan.gasCost) + ' ETH' : 'После симуляции'}</strong></div>
    <div><span>Минимум токенов за покупку</span><strong>${plan?.minOut ? format(plan.minOut) : '—'}</strong></div></div>
    <button type="button" class="button text" id="refresh-terms">Обновить условия сети</button>
    <div class="actions"><button type="button" id="simulate" class="button primary" ${busy ? 'disabled' : ''}>${busy ? 'Проверяем…' : 'Проверить запуск'}</button>
    ${plan?.steps.length && mode === 'fork' ? '<button type="button" id="approve" class="button secondary">Подтвердить тестовый approve</button>' : ''}
    ${plan?.state === 'ready' && mode === 'fork' && !result ? '<button type="button" id="launch" class="button primary">Запустить на локальной сети</button>' : ''}</div>
    ${plan?.token ? `<div class="result-box"><span class="eyebrow">ПРЕДСКАЗАННЫЙ ТОКЕН</span><code>${escape(plan.token)}</code><p>Симуляция пройдена. ${mode === 'read' ? 'В этой сборке основная сеть доступна для чтения и симуляций.' : 'Можно проверить отправку на fork.'}</p></div>` : ''}
    ${result ? `<div class="result-box"><span class="eyebrow">ТОКЕН СОЗДАН НА FORK</span><code>${escape(result.token)}</code><p>Блок ${result.block} · ${escape(result.distributor ? 'Holders подключён' : 'Запуск подтверждён')}</p>${draft.destination === 'holders' && !result.distributor ? '<button type="button" class="button secondary" id="holders">Продолжить настройку Holders</button>' : ''}</div>` : ''}
    ${journal.length ? `<details open><summary>Журнал запуска · ${journal.length}</summary><ul class="journal">${journal.map(j => `<li><span>${escape(j.kind)}</span><strong>${escape(j.state)}</strong><small>${escape(j.hash ? short(j.hash) : 'nonce ' + j.nonce)}</small></li>`).join('')}</ul><button type="button" id="reconcile" class="button secondary">Проверить подтверждения</button></details>` : ''}`;
}

function render() {
  app.innerHTML = `<header><a class="brand" href="/" aria-label="Launchpad"><span class="brand-mark">↗</span>launchpad<span class="version">PONS BASE</span></a>
    <div class="header-tools"><select id="mode" aria-label="Сеть"><option value="read" ${mode === 'read' ? 'selected' : ''}>Robinhood · чтение</option><option value="fork" ${mode === 'fork' ? 'selected' : ''}>Local fork · тест</option></select><button class="button secondary" id="connect">${account ? escape(short(account)) : 'Подключить кошелёк'}</button></div></header>
    <main><div class="page-heading"><div><span class="eyebrow">СВОЙ ЗАПУСК / ИНФРАСТРУКТУРА PONS</span><h1>От идеи — к токену.</h1><p>Настройте проект и проверьте запуск в одном месте.</p></div><span class="status-pill" id="network-status">${terms ? '● Условия загружены' : '○ Читаем сеть'}</span></div>
    <div class="layout"><section class="editor"><nav class="steps" aria-label="Этапы">${['Токен', 'Экономика', 'Проверка'].map((name, i) => `<button type="button" data-stage="${i + 1}" class="${stage === i + 1 ? 'active' : ''}" ${stage === i + 1 ? 'aria-current="step"' : ''}><span>${i + 1}</span>${name}</button>`).join('')}</nav>
    <form id="draft-form" novalidate><fieldset ${busy ? 'disabled' : ''}>${stage === 1 ? identity() : stage === 2 ? economics() : review()}</fieldset></form>
    <div id="notice" role="status" class="notice" hidden></div>
    <div class="editor-footer"><span id="saved-label">Черновик сохраняется в браузере</span><div>${stage > 1 ? '<button class="button text" id="back">Назад</button>' : ''}${stage < 3 ? '<button class="button primary" id="next">Продолжить <span>→</span></button>' : ''}</div></div></section>
    <aside><div class="preview-label">ВАШ ТОКЕН</div><div class="preview"><div class="preview-head"><div class="token-image small" id="card-image">↗</div><div><h2 id="card-name"></h2><span id="card-symbol" class="mono"></span></div></div><p id="card-description" class="description"></p><span id="card-pair" class="chip"></span>
    <div class="stats"><div><span>Эмиссия</span><strong id="card-supply">—</strong></div><div><span>Порог graduation</span><strong id="card-graduation">—</strong></div><div><span>Creator fee</span><strong id="card-fee">0%</strong></div><div><span>Стоимость запуска</span><strong id="card-launch">—</strong></div></div>
    <div class="preview-bottom"><span id="card-destination"></span><span class="arrow">↗</span></div></div>
    <div class="side-note"><span class="eyebrow">БАЗОВЫЙ ЗАПУСК</span><p>Токен и торговая кривая создаются в Pons. Настройки берём из контракта сети.</p><small id="block-info"></small></div>
    <a class="button text export" href="/draws.html">Настроить розыгрыши →</a><button class="button text export" id="export">↓ Сохранить черновик и результаты</button><button class="button text export" id="new-draft">+ Новый запуск</button></aside></div>
    <footer>CRYPTO LAUNCHPAD <span>Рабочая версия · 01</span></footer></main>`;
  bind(); preview(); renderMessage(); paintValidation();
}
function preview() {
  const set = (id, text) => { const el = document.querySelector('#' + id); if (el) el.textContent = text; };
  set('card-name', draft.name || 'Ваш следующий токен'); set('card-symbol', draft.symbol.toUpperCase() || 'TICKER');
  set('card-description', draft.description || 'У каждого токена своя история. Расскажите вашу.');
  set('card-fee', validateDraft(draft, { terms }).errors.creatorFee ? '—' : `${draft.creatorFee}%`); set('card-pair', (terms?.quote.symbol || pairs.find(p => p.address.toLowerCase() === draft.pair.toLowerCase())?.symbol || '…') + ' pair');
  set('card-destination', ({ wallet: 'Комиссии → кошелёк', buyback: 'Buyback & vest', holders: 'Комиссии → держатели' })[draft.destination]);
  if (terms) {
    set('card-supply', format(terms.supply)); set('card-graduation', `${format(terms.quote.graduationThreshold, terms.quote.decimals)} ${terms.quote.symbol}`);
    set('card-launch', `${formatEther(terms.fee)} ETH`); set('block-info', `Проверено на блоке ${terms.block.toLocaleString('ru-RU')}`);
    set('fee-hint', `Базовая комиссия ${terms.curveFeeBps / 100}% + выбранная creator fee (до ${terms.cap / 100}%). Покупка — в ${terms.quote.symbol}.`);
    const feeInput = document.querySelector('[name=creatorFee]'); if (feeInput) feeInput.max = String(terms.cap / 100);
  } else for (const id of ['card-supply', 'card-graduation', 'card-launch', 'block-info']) set(id, '—');
  const recipient = document.querySelector('#fee-wallet'); if (recipient) recipient.hidden = draft.destination === 'holders';
  for (const id of ['image-preview', 'card-image']) {
    const el = document.getElementById(id);
    if (el && localImage) { const img = document.createElement('img'); img.src = localImage; img.alt = 'Картинка токена'; el.replaceChildren(img); }
  }
}
async function loadTerms() {
  const id = ++requestId; const p = provider;
  try {
    const next = await readTerms(p, { pair: getAddress(draft.pair), account: account ? getAddress(account) : ZeroAddress, configId: Number(draft.configId) });
    if (id !== requestId) return;
    terms = next; preview(); paintValidation(); document.querySelector('#network-status').textContent = '● Условия загружены';
  } catch (error) { if (id === requestId) { terms = null; preview(); paintValidation(); document.querySelector('#network-status').textContent = '○ Сеть недоступна'; feedback(error.shortMessage || error.message, 'error'); } }
}
async function loadPairs() {
  const p = provider;
  try {
    const next = await listPairs(p); if (p !== provider) return;
    pairs = next;
    const select = document.querySelector('[name=pair]');
    if (select) select.innerHTML = pairs.map(p => option(p.address, `${p.symbol} — ${p.name}`, draft.pair)).join('');
  } catch (error) { if (p === provider) feedback('Список пар не загружен: ' + (error.shortMessage || error.message), 'error'); }
}
async function work(fn) {
  if (busy) return; busy = true; render();
  try { await fn(); persist(); } catch (error) { if (error.fields) { serverErrors = error.fields; revealErrors(error.fields); } feedback(error.fields ? 'Проверьте отмеченные поля' : error.shortMessage || error.message, 'error'); }
  finally { busy = false; render(); }
}
function validation() {
  const result = validateDraft(draft, { terms, account, requireAccount: stage === 3, requireTerms: stage >= 2 });
  return { ...result.errors, ...serverErrors };
}
function fieldStage(key) { return IDENTITY_FIELDS.includes(key) || key === 'image' ? 1 : key === 'account' ? 3 : 2; }
function paintValidation() {
  const errors = validation();
  for (const key of [...DRAFT_FIELDS, 'account', 'image']) {
    const controls = key === 'account' ? [document.querySelector('#account')] : key === 'image' ? [document.querySelector('#image-file')] : [...document.querySelectorAll(`[name="${key}"]`)];
    const control = controls.find(Boolean); if (!control) continue;
    let node = document.getElementById(`error-${key}`);
    if (!node) {
      node = document.createElement('p'); node.id = `error-${key}`; node.className = 'field-error'; node.setAttribute('aria-live', 'polite');
      (control.closest('.field') || control.closest('.destinations') || control.closest('.image-row') || control.parentElement).append(node);
    }
    const visible = errors[key] && (touched.has(key) || attempted.has(fieldStage(key)) || serverErrors[key] || draft[key]?.trim());
    node.textContent = visible ? errors[key] : ''; node.hidden = !visible;
    for (const item of controls.filter(Boolean)) { item.setAttribute('aria-invalid', visible ? 'true' : 'false'); item.setAttribute('aria-describedby', node.id); }
  }
  const general = errors._form || (attempted.has(2) ? errors._network : '');
  let summary = document.getElementById('validation-summary');
  if (!summary) { summary = document.createElement('p'); summary.id = 'validation-summary'; summary.className = 'field-error'; document.querySelector('#draft-form').append(summary); }
  summary.textContent = general || ''; summary.hidden = !general;
  const blocked = Object.keys(errors).length > 0 || busy;
  for (const id of ['simulate', 'approve', 'launch']) { const button = document.getElementById(id); if (button) button.disabled = blocked; }
}
function revealErrors(errors) {
  const first = Object.keys(errors).find(key => !key.startsWith('_'));
  if (first) { stage = fieldStage(first); attempted.add(stage); }
}
function focusError() {
  const control = document.querySelector('[aria-invalid="true"]');
  if (control) { const details = control.closest('details'); if (details) details.open = true; control.focus(); }
}
async function goToStage(target) {
  if (busy) return;
  if (target <= stage) { stage = target; render(); return; }
  attempted.add(1);
  let errors = validateDraft(draft).errors;
  const identityErrors = Object.fromEntries(Object.entries(errors).filter(([key]) => IDENTITY_FIELDS.includes(key) || key === '_form'));
  if (serverErrors.image) identityErrors.image = serverErrors.image;
  if (Object.keys(identityErrors).length) { stage = 1; render(); focusError(); return; }
  if (target >= 3) {
    attempted.add(2);
    if (!termsMatch(terms, draft) || !termsFresh(terms)) await work(async () => { await loadTerms(); });
    errors = validateDraft(draft, { terms, requireTerms: true }).errors;
    if (Object.keys(errors).length) { stage = 2; render(); focusError(); return; }
  }
  stage = target; render();
}
function checkAll() {
  attempted = new Set([1, 2, 3]);
  const errors = validation();
  if (Object.keys(errors).length) { revealErrors(errors); render(); focusError(); return false; }
  return true;
}

function bind() {
  document.querySelector('#draft-form').onsubmit = e => e.preventDefault();
  document.querySelectorAll('[data-stage]').forEach(b => b.onclick = () => goToStage(Number(b.dataset.stage)));
  document.querySelector('#next')?.addEventListener('click', () => goToStage(stage + 1));
  document.querySelector('#back')?.addEventListener('click', () => { if (!busy) { stage--; render(); } });
  document.querySelectorAll('[name]').forEach(input => input.addEventListener('input', () => {
    if (journal.some(j => !['rejected', 'reverted'].includes(j.state))) { feedback('У запуска уже есть журнал. Завершите его перед изменением параметров.', 'error'); render(); return; }
    draft[input.name] = input.value; touched.add(input.name); serverErrors = {}; plan = undefined; saved.reviewed = undefined; persist(); preview(); paintValidation();
    if (['pair', 'configId'].includes(input.name)) { terms = null; requestId++; preview(); paintValidation(); loadTerms(); }
  }));
  document.querySelector('#account')?.addEventListener('input', e => {
    if (journal.length) { feedback('Кошелёк закреплён за журналом запуска', 'error'); render(); return; }
    account = e.target.value.trim(); touched.add('account'); serverErrors = {}; plan = undefined; saved.reviewed = undefined; persist(); paintValidation();
  });
  document.querySelector('#mode').onchange = async e => {
    if (busy || journal.length) { feedback('Для смены окружения используйте новый черновик после экспорта журнала.', 'error'); render(); return; }
    mode = e.target.value; account = ''; terms = null; plan = undefined; result = undefined; requestId++;
    saved.reviewed = undefined; pairs = [{ address: ZeroAddress, symbol: 'ETH', name: 'Ether' }];
    provider.destroy(); provider = providerFor(mode === 'fork' ? 'http://127.0.0.1:8545' : NETWORK.rpc); persist(); render(); loadPairs(); await loadTerms();
  };
  document.querySelector('#connect').onclick = () => work(async () => {
    if (journal.length) throw Error('Кошелёк закреплён за журналом запуска. Для другого кошелька создайте новый черновик.');
    if (mode === 'fork') {
      await assertLocalFork(provider); account = await (await provider.getSigner(0)).getAddress();
    } else {
      if (!window.ethereum) throw Error('Кошелёк не найден. На шаге «Проверка» можно указать публичный адрес.');
      [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    }
    plan = undefined; saved.reviewed = undefined; serverErrors = {}; await loadTerms(); feedback('Кошелёк выбран');
  });
  document.querySelector('#simulate')?.addEventListener('click', () => { if (!checkAll()) return; return work(async () => {
    if (journal.some(x => x.kind === 'launch' && !['reverted', 'rejected'].includes(x.state))) throw Error('Запуск уже отправлен. Проверьте подтверждения.');
    const revision = JSON.stringify({ draft, account, mode });
    plan = undefined; saved.reviewed = undefined;
    const prepared = await prepareOnServer(draft, account, mode);
    if (revision !== JSON.stringify({ draft, account, mode })) throw Error('Данные изменились во время проверки. Повторите проверку.');
    plan = prepared; terms = plan.terms;
    if (plan.steps.length) { feedback('Для симуляции покупки сначала требуется approve. Сумма разрешения ограничена выбранной покупкой.'); return; }
    feedback('Симуляция запуска пройдена', 'success');
  }); });
  document.querySelector('#approve')?.addEventListener('click', () => work(async () => {
    if (mode !== 'fork') throw Error('Approve доступен в тестовом окружении');
    for (const step of plan.steps) await sendLocal(provider, account, step, journal, async () => persist(), step.kind);
    plan = await prepareOnServer(draft, account, mode); feedback('Approve и симуляция пройдены', 'success');
  }));
  document.querySelector('#launch')?.addEventListener('click', () => work(async () => {
    result = await executeLocalLaunch(provider, plan, journal, async () => persist());
    persist(); feedback('Токен создан на локальном fork', 'success');
    if (draft.destination === 'holders') { result.distributor = await continueLocalHolders(provider, result.token, account, journal, async () => persist()); feedback('Токен создан, Holders подключён', 'success'); }
  }));
  document.querySelector('#holders')?.addEventListener('click', () => work(async () => {
    result.distributor = await continueLocalHolders(provider, result.token, account, journal, async () => persist()); feedback('Holders подключён', 'success');
  }));
  document.querySelector('#reconcile')?.addEventListener('click', () => work(async () => {
    await reconcileJournal(provider, journal, async () => persist());
    const entry = journal.find(j => j.kind === 'launch' && j.state === 'confirmed');
    if (entry && !result && saved.reviewed) result = await verifyLaunch(provider, await provider.getTransactionReceipt(entry.hash), saved.reviewed);
    feedback(journal.some(j => ['unknown', 'pending', 'requesting'].includes(j.state)) ? 'Не все отправки подтверждены. Повторный запуск заблокирован.' : 'Подтверждения проверены');
  }));
  document.querySelector('#refresh-terms')?.addEventListener('click', () => work(async () => { plan = undefined; saved.reviewed = undefined; serverErrors = {}; await loadTerms(); }));
  document.querySelectorAll('[name]').forEach(input => input.addEventListener('blur', () => { touched.add(input.name); paintValidation(); }));
  document.querySelector('#image-file')?.addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    if (busy || journal.length) { feedback('Картинку уже начатого запуска менять нельзя', 'error'); return; }
    const version = ++imageRequest;
    const invalid = imageMetadataErrors({ size: file.size, type: file.type });
    if (invalid) { serverErrors.image = invalid; paintValidation(); return; }
    feedback('Проверяем картинку…');
    try {
      await checkImageOnServer(file);
      if (version !== imageRequest) return;
      delete serverErrors.image;
      if (localImage) URL.revokeObjectURL(localImage);
      localImage = URL.createObjectURL(file); preview();
      feedback('Картинка проверена. Для запуска пока нужен адрес её публикации в IPFS.');
    } catch (error) { if (version === imageRequest) { serverErrors.image = error.fields?.image || error.message; } }
    paintValidation();
  });
  document.querySelector('#export').onclick = () => {
    const blob = new Blob([stringify({ draft, account, mode, terms, plan, journal, result })], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pons-${draft.symbol || 'draft'}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  document.querySelector('#new-draft').onclick = () => {
    if (busy || journal.some(j => ['requesting', 'pending', 'unknown'].includes(j.state))) { feedback('Сначала нужно установить результат незавершённой отправки', 'error'); return; }
    try {
      persist(); localStorage.setItem(`${KEY}:archive:${Date.now()}`, localStorage.getItem(KEY));
      draft = initialDraft(); touched.clear(); attempted.clear(); serverErrors = {}; imageRequest++; journal = []; result = undefined; plan = undefined; saved.reviewed = undefined; stage = 1;
      if (localImage) URL.revokeObjectURL(localImage); localImage = undefined; terms = null; persist();
      feedback('Предыдущий черновик сохранён в локальном архиве'); render(); loadTerms();
    } catch (error) { feedback('Не удалось сохранить архив: ' + error.message, 'error'); }
  };
}
window.ethereum?.on?.('accountsChanged', accounts => {
  if (mode === 'fork' || journal.length) return;
  account = accounts[0] || ''; plan = undefined; saved.reviewed = undefined; persist(); render(); loadTerms();
});
window.ethereum?.on?.('chainChanged', () => { plan = undefined; saved.reviewed = undefined; feedback('Сеть кошелька изменилась. Обновите проверку запуска.'); });
render(); loadTerms(); loadPairs();
