import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseUnits } from 'ethers';
import { validateConfig, previewShort } from '../../src/draws/config.mjs';
test('QIANQI preview, equal prizes, persistence and export', async ({ page }) => {
  await page.goto('/draws.html');
  await expect(page.locator('#basket tbody tr')).toHaveCount(10);
  await expect(page.locator('#basket tbody tr').first()).toContainText('35.0 USDG');
  await page.locator('[name=distribution]').selectOption('equal');
  await page.locator('[name=count]').fill('3');
  await expect(page.locator('#basket tbody tr')).toHaveCount(3);
  await expect(page.locator('#basket')).toContainText('0.000001 USDG');
  await page.locator('[name=ticket]').fill('10');
  await page.reload();
  await expect(page.locator('[name=ticket]')).toHaveValue('10');
  await expect(page.locator('[name=count]')).toHaveValue('3');
  const download = page.waitForEvent('download');
  await page.locator('#export-draw').click();
  expect((await download).suggestedFilename()).toBe('draw-config.json');
  await page.screenshot({ path: '.local/test-results/draws-desktop.png', fullPage: true });
});
test('Invalid shares and weights block export; toggles and budget show true readiness', async ({ page }) => {
  await page.goto('/draws.html');
  await page.locator('[name=team]').fill('1000');
  await expect(page.locator('#error-team')).toBeVisible();
  await expect(page.locator('#export-draw')).toBeDisabled();
  await page.locator('[name=team]').fill('6');
  await expect(page.locator('#split-error')).toContainText('100%');
  await page.locator('[name=team]').fill('5');
  await page.getByText('Ручная настройка корзины', { exact: true }).click();
  await page.locator('[name=weightMode]').selectOption('manual');
  await page.locator('[name=count]').fill('3');
  await expect(page.locator('#error-weights')).toContainText('Нужно 3');
  await page.locator('[name=weights]').fill('7:2:1');
  await page.locator('[name=budget]').fill('99');
  await expect(page.locator('#basket')).toContainText('Не хватает 1.0 USDG');
  await page.locator('[name=short]').uncheck();
  await expect(page.locator('#basket')).toContainText('Short выключен');
  await page.locator('[name=monthly]').uncheck();
  await expect(page.locator('#export-draw')).toBeDisabled();
  await page.locator('#reset-draw').click();
  await expect(page.locator('#basket tbody tr')).toHaveCount(10);
});

test('64 places auto-fill, legacy drafts migrate and manual mode preserves basket', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('crypto-launchpad:draw-editor:v1')) localStorage.setItem('crypto-launchpad:draw-editor:v1', JSON.stringify({ count: '64', weights: '4:3:2:1:1:1:1:1:1:1' })); });
  await page.goto('/draws.html');
  await expect(page.locator('[name=weights]')).toHaveValue('4:3:2');
  await expect(page.locator('#weight-hint')).toContainText('61 мест');
  await page.locator('[name=budget]').fill('1000');
  await expect(page.locator('#basket tbody tr')).toHaveCount(64);
  await expect(page.locator('#export-draw')).toBeEnabled();
  await page.reload();
  await expect(page.locator('[name=weights]')).toHaveValue('4:3:2');
  await page.getByText('Ручная настройка корзины', { exact: true }).click();
  await page.locator('[name=weightMode]').selectOption('manual');
  expect((await page.locator('[name=weights]').inputValue()).split(':')).toHaveLength(64);
  await page.locator('[name=weightMode]').selectOption('auto');
  await expect(page.locator('[name=weights]')).toHaveValue('4:3:2');
  await page.locator('[name=count]').fill('2');
  await expect(page.locator('#export-draw')).toBeDisabled();
  await expect(page.locator('#error-weights')).toContainText('Уберите лишние');
  await page.locator('[name=weights]').fill('');
  await expect(page.locator('#basket tbody tr')).toHaveCount(2);
  await expect(page.locator('#export-draw')).toBeEnabled();
});
test('Mobile view and malformed stored draft remain usable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('crypto-launchpad:draw-editor:v1', '{broken'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/draws.html');
  await expect(page.locator('#export-draw')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/test-results/draws-mobile.png', fullPage: true });
});

test('All 1–64 basket sizes export exact weights and agree with displayed amounts', async ({ page }) => {
  const crashes = []; page.on('pageerror', error => crashes.push(error.message));
  await page.goto('/draws.html');
  await page.locator('[name=weights]').fill('');
  await page.locator('[name=budget]').fill('1000');
  for (let count = 1; count <= 64; count++) {
    await page.locator('[name=count]').fill(String(count));
    await expect(page.locator('#basket tbody tr')).toHaveCount(count);
    await expect(page.locator('#export-draw')).toBeEnabled();
  }
  await page.locator('[name=weights]').fill('7:4:2');
  const downloaded = page.waitForEvent('download'); await page.locator('#export-draw').click();
  const config = validateConfig(JSON.parse(await readFile(await (await downloaded).path(), 'utf8')));
  expect(config.short.basket.weights).toEqual([7, 4, 2, ...Array(61).fill(1)]);
  const displayed = await page.locator('#basket tbody td:last-child').allTextContents();
  const actual = displayed.map(text => parseUnits(text.replace(' USDG', ''), 6));
  const expected = previewShort(config, 1000000000n);
  expect(actual).toEqual(expected.prizes);
  expect(actual.reduce((sum, n) => sum + n, 0n) + expected.remainder).toBe(1000000000n);
  expect(crashes).toEqual([]);
});

test('Bad numeric input never leaves stale prizes; corrections restore the form', async ({ page }) => {
  await page.goto('/draws.html');
  for (const [field, values] of Object.entries({ count: ['0', '65', '-1', '1.5', '1e1', ''], weights: ['0', '-1', '7::2', '7:4:', '1e2', '9007199254740992'], ticket: ['0', '-10', '0.0000001', 'NaN'], unit: ['0', '-5', '1e2'] })) {
    const original = await page.locator(`[name=${field}]`).inputValue();
    for (const value of values) {
      await page.locator(`[name=${field}]`).fill(value);
      await expect(page.locator('#export-draw')).toBeDisabled();
      await expect(page.locator('#basket tbody tr')).toHaveCount(0);
    }
    await page.locator(`[name=${field}]`).fill(original);
    await expect(page.locator('#export-draw')).toBeEnabled();
  }
  await page.locator('[name=budget]').fill('0');
  await expect(page.locator('#basket')).toContainText('Не хватает 100.0 USDG');
  await page.locator('[name=budget]').fill('99,999999');
  await expect(page.locator('#basket')).toContainText('Не хватает 0.000001 USDG');
  await page.locator('[name=budget]').fill('100');
  await expect(page.locator('#basket tbody tr')).toHaveCount(10);
});

test('Storage failure is visible and export still works', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('quota'); }; });
  await page.goto('/draws.html');
  await expect(page.locator('#save-status')).toContainText('Не удалось сохранить');
  await page.locator('[name=ticket]').fill('10');
  const downloaded = page.waitForEvent('download'); await page.locator('#export-draw').click();
  const config = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
  expect(config.ticketPurchase).toBe('10');
});
