import '../style.css';
import './editor.css';
import { formatUnits } from 'ethers';
import { amount, equalWeights, previewShort, qianqiPreset, validateConfig } from './config.mjs';
import { percentBps } from '../pons/validation.mjs';
import { simulateShort, generateParticipants } from './simulator.mjs';
const KEY = 'crypto-launchpad:draw-editor:v1';
const preset = qianqiPreset();
const defaults = { ticket: preset.ticketPurchase, prizes: '90', team: '5', operations: '5', short: true, monthly: true,
  hours: '6', days: '30', shortFund: '100', monthlyFund: '100', nextReserve: '100', count: '10',
  distribution: 'weighted', weights: '7:4:2', weightMode: 'auto', unit: '5', budget: '100' };
let state = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  for (const key of Object.keys(defaults)) if (typeof saved?.[key] === typeof defaults[key]) state[key] = saved[key];
  if (saved && !Object.hasOwn(saved, 'weightMode')) state.weights = state.weights.replace(/(?::1)+$/, '');
} catch { /* Use preset when storage is unavailable or corrupt. */ }
const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const field = (key, label) => `<label class="field"><span>${label}</span><input name="${key}" value="${esc(state[key])}" inputmode="decimal"><small id="error-${key}" class="field-error" aria-live="polite"></small></label>`;
const toggle = (key, label) => `<label class="draw-toggle"><input name="${key}" type="checkbox" ${state[key] ? 'checked' : ''}> ${label}</label>`;
document.querySelector('#app').innerHTML = `<header><a class="brand" href="/">↗ launchpad</a><a href="/">Создать токен →</a></header>
<main><div class="page-heading"><div><span class="eyebrow">МЕХАНИКИ QIANQI</span><h1>Настройте розыгрыши.</h1><p>Черновик программы. Настройки пока не подключаются к запуску токена.</p></div></div>
<div class="layout"><section class="editor"><form id="draw-form" novalidate>
<h2>Билеты и комиссии</h2>${field('ticket', 'Объём покупок на билет, USDG')}
<p class="hint">Накопленные покупки дают билеты. Это отдельный порог от минимального фонда розыгрыша.</p>
<div class="draw-three">${field('prizes', 'Призам, %')}${field('team', 'Команде, %')}${field('operations', 'Обслуживание, %')}</div>
<p id="split-error" class="field-error" aria-live="polite"></p>
${toggle('short', 'Короткий розыгрыш (Short)')}<fieldset id="short-fields">
<div class="two">${field('hours', 'Интервал Short, часов')}${field('shortFund', 'Минимальный фонд Short, USDG')}</div>
<div class="two">${field('count', 'Максимум победителей Short')}${field('unit', 'Минимальная базовая единица приза, USDG')}</div>
<label class="field"><span>Распределение призов</span><select name="distribution"><option value="weighted">По весам, как в QIANQI</option><option value="equal">Поровну</option></select></label>
<div id="weight-field">${field('weights', 'Веса крупных призов')}<p class="hint" id="weight-hint"></p>
<details><summary>Ручная настройка корзины</summary><label class="field"><span>Остальные места</span><select name="weightMode"><option value="auto">Заполнить весом 1 автоматически</option><option value="manual">Задать все веса вручную</option></select></label></details></div>
<p class="hint">Максимум один приз на адрес. Призы назначаются случайно; невыданные остаются в фонде.</p></fieldset>
${toggle('monthly', 'Месячный розыгрыш (Monthly)')}<fieldset id="monthly-fields"><div class="two">${field('days', 'Интервал Monthly, суток')}${field('monthlyFund', 'Минимальный фонд Monthly, USDG')}</div>
${field('nextReserve', 'Резерв следующего Monthly, USDG')}<p class="hint">Профиль QIANQI: один победитель, 75% — выплата, 25% — перенос. Несколько победителей добавим отдельным шагом.</p></fieldset>
<p id="config-error" class="field-error" role="alert"></p>
<section class="simulation"><h2>Тестовый розыгрыш Short</h2><p class="hint">Локальная симуляция. Seed задаётся вручную для повторяемости; это не источник случайности для реального розыгрыша. Фонд берётся из предпросмотра справа.</p>
<div class="two"><label class="field"><span>Тестовый проект</span><input id="sim-instance" value="my-token"></label><label class="field"><span>Номер цикла</span><input id="sim-cycle" value="1" inputmode="numeric"></label></div>
<label class="field"><span>Тестовый seed (bytes32)</span><input id="sim-seed" value="0x${'01'.repeat(32)}"></label>
<p>Создать тестовых участников: ${[10,100,1000].map(n=>`<button type="button" class="button secondary" data-generate="${n}">${n}</button>`).join(' ')}</p>
<label class="field"><span>Участники: адрес и число билетов, по одному на строку</span><textarea id="sim-participants" rows="6" spellcheck="false">${generateParticipants(10)}</textarea></label>
<button type="button" class="button primary" id="simulate-short">Провести тестовый розыгрыш</button><p id="sim-error" class="field-error" role="alert"></p><div id="sim-result" aria-live="polite"></div></section>
<div class="actions"><button id="export-draw" type="button" class="button primary">Скачать настройки</button><button id="reset-draw" type="button" class="button secondary">Пресет QIANQI</button></div>
<p id="save-status" class="hint" role="status"></p></form></section>
<aside><div class="preview"><span class="eyebrow">ПРЕДПРОСМОТР SHORT</span><h2>Призовая корзина</h2>${field('budget', 'Фонд для примера, USDG')}<div id="basket" aria-live="polite"></div></div>
<div class="side-note"><p>Это расчёт размеров призов, а не симуляция выбора победителей.</p><p>Распределение призового потока между Short и Monthly настроим при подключении финансирования.</p></div></aside></div></main>`;
const form = document.querySelector('#draw-form');
document.querySelector('[name=distribution]').value = state.distribution;
document.querySelector('[name=weightMode]').value = state.weightMode;
let validConfig;
const money = n => `${formatUnits(n, 6)} USDG`;
function update() {
  document.querySelector('#sim-result').replaceChildren();
  document.querySelector('#sim-error').textContent = '';
  const errors = {};
  const read = (key, fn) => { try { return fn(state[key]); } catch (e) { errors[key] = e.message; return undefined; } };
  const integer = (value, max = Number.MAX_SAFE_INTEGER) => { if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw Error(`Целое число от 1 до ${max}`); return Number(value); };
  const positive = key => read(key, v => { amount(v); return v; });
  const config = qianqiPreset();
  config.ticketPurchase = positive('ticket');
  config.fees = Object.fromEntries(['prizes', 'team', 'operations'].map(k => [k + 'Bps', read(k, v => { const n = percentBps(v); if (n > 10000) throw Error('От 0 до 100%'); return n; })]));
  config.short.enabled = state.short; config.monthly.enabled = state.monthly;
  config.short.intervalSeconds = read('hours', v => integer(v, Math.floor(Number.MAX_SAFE_INTEGER / 3600))) * 3600;
  config.monthly.intervalSeconds = read('days', v => integer(v, Math.floor(Number.MAX_SAFE_INTEGER / 86400))) * 86400;
  config.short.minimumFund = positive('shortFund'); config.monthly.minimumFund = positive('monthlyFund'); config.monthly.nextReserve = positive('nextReserve');
  const count = read('count', v => integer(v, 64));
  config.short.basket.minimumUnit = positive('unit');
  config.short.basket.weights = read('weights', v => {
    if (!count) return [];
    if (state.distribution === 'equal') return equalWeights(count);
    if (state.distribution !== 'weighted') throw Error('Выберите способ распределения');
    const weights = !v.trim() && state.weightMode === 'auto' ? [] : v.split(':').map(w => integer(w.trim()));
    if (state.weightMode === 'auto') {
      if (weights.length > count) throw Error(`Задано ${weights.length} призов, а мест ${count}. Уберите лишние веса или увеличьте число мест.`);
      return [...weights, ...Array(count - weights.length).fill(1)];
    }
    if (state.weightMode !== 'manual') throw Error('Выберите способ заполнения остальных мест');
    if (weights.length !== count) throw Error(`Нужно ${count} весов; сейчас ${weights.length}`);
    return weights;
  });
  const sum = Object.values(config.fees).reduce((a, b) => a + b, 0);
  document.querySelector('#split-error').textContent = Number.isFinite(sum) && sum !== 10000 ? 'Доли должны давать ровно 100%.' : '';
  let configError = '';
  validConfig = undefined;
  if (!Object.keys(errors).length) { try { validConfig = validateConfig(config); } catch (e) { configError = e.message; } }
  const budget = read('budget', v => v === '0' ? 0n : amount(v, 'Фонд'));
  for (const key of Object.keys(defaults)) {
    const input = document.querySelector(`[name="${key}"]`), error = document.querySelector(`#error-${key}`);
    if (input && error) { error.textContent = errors[key] || ''; input.setAttribute('aria-invalid', errors[key] ? 'true' : 'false'); input.setAttribute('aria-describedby', error.id); }
  }
  // Keep disabled lane parameters editable so invalid saved values can be corrected.
  document.querySelector('#weight-field').hidden = state.distribution === 'equal';
  document.querySelector('[name=weights]').previousElementSibling.textContent = state.weightMode === 'auto' ? 'Веса крупных призов' : 'Все веса через двоеточие';
  const entered = state.weights.trim() ? state.weights.split(':').length : 0;
  document.querySelector('#weight-hint').textContent = state.weightMode === 'auto'
    ? `Например, 7:4:2. ${count && entered <= count ? `Остальные ${count - entered} мест — автоматически с весом 1.` : 'Остальные места получат вес 1.'} Пустое поле — всем поровну.`
    : 'Укажите вес каждого места. Количество весов должно совпадать с количеством мест.';
  document.querySelector('#config-error').textContent = configError;
  document.querySelector('#export-draw').disabled = !validConfig;
  document.querySelector('#simulate-short').disabled = !validConfig || !state.short || budget === undefined;
  const target = document.querySelector('#basket');
  if (!validConfig || budget === undefined) target.textContent = 'Исправьте ошибки для расчёта корзины.';
  else if (!state.short) target.textContent = 'Short выключен. Его корзина не разыгрывается.';
  else {
    const result = previewShort(validConfig, budget);
    target.innerHTML = `<p>Минимальный фонд: <strong>${money(result.minimumBudget)}</strong></p>` + (result.ready
      ? `<table><thead><tr><th>Призовой слот</th><th>Сумма</th></tr></thead><tbody>${result.prizes.map((n, i) => `<tr><td>${i + 1}</td><td>${money(n)}</td></tr>`).join('')}</tbody></table><p>В корзине: ${money(result.total)}<br>Остаток округления: ${money(result.remainder)}</p><p class="hint">Это все возможные призы. Фактически победителей может быть меньше.</p>`
      : `<p>Фонд ещё не готов. Не хватает ${money(result.missing)}.</p>`);
  }
  try { localStorage.setItem(KEY, JSON.stringify(state)); document.querySelector('#save-status').textContent = 'Черновик сохранён в этом браузере.'; }
  catch { document.querySelector('#save-status').textContent = 'Не удалось сохранить черновик. Скачайте настройки перед закрытием.'; }
}
document.querySelectorAll('input[name], select[name]').forEach(input => input.addEventListener('input', () => {
  if (input.name === 'weightMode' && input.value !== state.weightMode) {
    if (input.value === 'manual' && validConfig && state.distribution === 'weighted') state.weights = validConfig.short.basket.weights.join(':');
    else if (input.value === 'auto') state.weights = state.weights.replace(/(?::1)+$/, '');
    document.querySelector('[name=weights]').value = state.weights;
  }
  state[input.name] = input.type === 'checkbox' ? input.checked : input.value; update();
}));
form.addEventListener('submit', event => event.preventDefault());
document.querySelector('#reset-draw').onclick = () => { state = { ...defaults }; document.querySelectorAll('input[name], select[name]').forEach(input => { if (input.type === 'checkbox') input.checked = state[input.name]; else input.value = state[input.name]; }); update(); };
document.querySelector('#export-draw').onclick = () => { if (!validConfig) return; const url = URL.createObjectURL(new Blob([JSON.stringify(validConfig, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'draw-config.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
document.querySelectorAll('[data-generate]').forEach(button => button.onclick = () => { document.querySelector('#sim-participants').value = generateParticipants(Number(button.dataset.generate)); update(); });
document.querySelectorAll('.simulation input, .simulation textarea').forEach(input => input.addEventListener('input', update));
document.querySelector('#simulate-short').onclick = () => {
  update();
  try {
    if (!validConfig) throw Error('Исправьте настройки');
    const value = key => document.querySelector(`#sim-${key}`).value;
    const output = simulateShort(validConfig, state.budget === '0' ? 0n : amount(state.budget), value('participants'), value('seed'), value('instance'), value('cycle'));
    const r = output.result;
    const winners = new Map(r.winners.map((wallet,i)=>[wallet,{amount:r.amounts[i],slot:r.prizeIndices[i]}]));
    document.querySelector('#sim-result').innerHTML = `<h3>Результат симуляции</h3><p>Участников: ${output.participants.length} · Допущено: ${r.admittedCount} · Победителей: ${r.winners.length}</p>
    <p>Назначено: ${money(output.paid)}<br>Невыданные призы: ${money(output.unawarded)}<br>Округление: ${money(output.rounding)}<br>Осталось в фонде: ${money(output.remaining)}</p>
    <details><summary>Контекст и хеш результата</summary><p class="mono">${output.context}<br>${r.resultHash}</p></details>
    <div class="sim-table"><table><thead><tr><th>Адрес / билеты</th><th>Допуск</th><th>Приз</th></tr></thead><tbody>${output.participants.map(p=>{const win=winners.get(p.wallet);return `<tr><td><code>${p.wallet}</code><br>${p.lastAttempt} билетов</td><td>${p.admitted?'Да':'Нет'}</td><td>${win?`${money(win.amount)}<br>Слот ${win.slot+1n}`:'—'}</td></tr>`;}).join('')}</tbody></table></div>`;
  } catch (e) { document.querySelector('#sim-error').textContent = e.message; }
};
update();
