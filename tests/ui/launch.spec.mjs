import { test, expect } from '@playwright/test';
import { initialDraft } from '../../src/pons/plan.mjs';
const logo = 'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee';
const account = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
async function seed(page, extra = {}) {
  await page.addInitScript(data => {
    if (!localStorage.getItem('crypto-launchpad:pons:v1')) localStorage.setItem('crypto-launchpad:pons:v1', JSON.stringify(data));
  }, { mode: 'fork', account, draft: { ...initialDraft(), name: 'Browser Token', symbol: 'BRWS', logo, ...extra } });
}
test('Draft survives reload, destination and fee preview update', async ({ page }) => {
  await seed(page); await page.goto('/');
  await page.getByLabel('Название', { exact: true }).fill('My Browser Token');
  await expect(page.locator('#card-name')).toHaveText('My Browser Token');
  await page.reload(); await expect(page.getByLabel('Название', { exact: true })).toHaveValue('My Browser Token');
  await page.getByRole('button', { name: '2 Экономика' }).click();
  await page.getByLabel('Creator fee, %', { exact: true }).fill('3.5');
  await page.getByRole('radio', { name: /^Держателям/ }).check();
  await expect(page.locator('#card-fee')).toHaveText('3.5%');
  await expect(page.locator('#fee-wallet')).toBeHidden();
  await page.screenshot({ path: '.local/test-results/economics-desktop.png', fullPage: true });
});
test('Actual local launch, receipt display and reload recovery', async ({ page }) => {
  await seed(page, { openingBuy: '0.001', creatorFee: '1' }); await page.goto('/');
  await page.getByRole('button', { name: '3 Проверка' }).click();
  await page.getByRole('button', { name: 'Проверить запуск', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Запустить на локальной сети' })).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: 'Запустить на локальной сети' }).click();
  await expect(page.getByText('ТОКЕН СОЗДАН НА FORK')).toBeVisible({ timeout: 45000 });
  await page.screenshot({ path: '.local/test-results/launch-desktop.png', fullPage: true });
  // Emulate reload after broadcast, before the app persisted the final result.
  await page.evaluate(() => {
    const key = 'crypto-launchpad:pons:v1', saved = JSON.parse(localStorage.getItem(key));
    delete saved.result; saved.journal.at(-1).state = 'pending';
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload(); await page.getByRole('button', { name: '3 Проверка' }).click();
  await expect(page.getByText('ТОКЕН СОЗДАН НА FORK')).toHaveCount(0);
  await page.getByRole('button', { name: 'Проверить подтверждения' }).click();
  await expect(page.getByRole('status')).toHaveText('Подтверждения проверены');
  await expect(page.getByText('ТОКЕН СОЗДАН НА FORK')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Запустить на локальной сети' })).toHaveCount(0);
});
test('Invalid metadata blocks preparation', async ({ page }) => {
  await seed(page, { logo: 'blob:temporary' }); await page.goto('/');
  await page.getByRole('button', { name: '3 Проверка' }).click();
  await expect(page.locator('#error-logo')).toContainText('ipfs://');
  await expect(page.getByRole('button', { name: 'Проверить запуск', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Запустить на локальной сети' })).toHaveCount(0);
});
test('RPC outage is visible and cannot produce a launch button', async ({ page }) => {
  await seed(page);
  await page.route('http://127.0.0.1:8545/', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'RPC unavailable' } }) }));
  await page.goto('/');
  await expect(page.locator('#network-status')).toHaveText('○ Сеть недоступна');
  await page.getByRole('button', { name: '3 Проверка' }).click();
  await expect(page.getByRole('button', { name: 'Запустить на локальной сети' })).toHaveCount(0);
  await expect(page.locator('#card-launch')).toHaveText('—');
});
test('Mobile viewport has no horizontal overflow', async ({ page }) => {
  await seed(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'От идеи — к токену.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/test-results/identity-mobile.png', fullPage: true });
});

test('Invalid economics stay visible and block navigation; correction clears errors', async ({ page }) => {
  await seed(page); await page.goto('/');
  await page.getByRole('button', { name: '2 Экономика' }).click();
  await page.locator('[name=creatorFee]').fill('1000');
  await page.locator('[name=openingBuy]').fill('-5000');
  await expect(page.locator('#error-creatorFee')).toBeVisible();
  await expect(page.locator('#error-openingBuy')).toBeVisible();
  await expect(page.locator('#card-fee')).toHaveText('—');
  await page.getByRole('button', { name: '3 Проверка' }).click();
  await expect(page.locator('[name=openingBuy]')).toHaveValue('-5000');
  await expect(page.locator('#simulate')).toHaveCount(0);
  await page.screenshot({ path: '.local/test-results/validation-economics.png', fullPage: true });
  await page.locator('[name=creatorFee]').fill('3,25');
  await page.locator('[name=openingBuy]').fill('0,001');
  await expect(page.locator('#error-creatorFee')).toBeHidden();
  await expect(page.locator('#error-openingBuy')).toBeHidden();
  await page.getByRole('button', { name: '3 Проверка' }).click();
  await expect(page.locator('#simulate')).toBeEnabled();
});
