import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { initialDraft } from '../../src/pons/plan.mjs';
const account = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const logo = 'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee';
async function seed(page) {
  await page.addInitScript(data => {
    if (!localStorage.getItem('crypto-launchpad:pons:v1')) localStorage.setItem('crypto-launchpad:pons:v1', JSON.stringify(data));
    window.ethereum = { on() {}, async request({ method, params = [] }) {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [data.account];
      const r = await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const body = await r.json(); if (body.error) throw Object.assign(Error(body.error.message), { code: body.error.code });
      if (method === 'eth_sendTransaction') {
        localStorage.setItem('test:wallet-hash', body.result);
        throw Error('Test: wallet broadcast succeeded but response was lost');
      }
      return body.result;
    } };
  }, { mode: 'fork', useWallet: true, account, draft: { ...initialDraft(), name: 'Wallet Recovery', symbol: 'WREC', logo } });
}
test('Browser wallet broadcast timeout survives reload and recovers the same launch', async ({ page }) => {
  await seed(page); await page.goto('/');
  await page.getByRole('button', { name: '3 Проверка' }).click();
  await expect(page.locator('#use-wallet')).toBeChecked();
  await page.getByRole('button', { name: 'Проверить запуск', exact: true }).click();
  await page.getByRole('button', { name: 'Запустить на локальной сети' }).click();
  await expect(page.locator('#recovery-hash')).toBeVisible();
  const hash = await page.evaluate(() => localStorage.getItem('test:wallet-hash'));
  expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  await page.reload(); await page.getByRole('button', { name: '3 Проверка' }).click();
  await page.locator('#recovery-hash').fill(hash);
  await page.getByRole('button', { name: 'Найти отправленный шаг' }).click();
  await expect(page.locator('#recovery-hash')).toHaveCount(0);
  await page.getByRole('button', { name: 'Проверить подтверждения' }).click();
  await expect(page.getByText('ТОКЕН СОЗДАН НА FORK')).toBeVisible();
  const journal = await page.evaluate(() => JSON.parse(localStorage.getItem('crypto-launchpad:pons:v1')).journal);
  expect(journal).toHaveLength(1); expect(journal[0].hash).toBe(hash); expect(journal[0].state).toBe('confirmed');
});
test('Published image URI survives reload; failed upload preserves the previous URI', async ({ page }) => {
  await seed(page); await page.goto('/');
  const buffer = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'red' } }).png().toBuffer();
  await page.locator('#image-file').setInputFiles({ name: 'token.png', mimeType: 'image/png', buffer });
  await expect(page.locator('#publish-image')).toBeEnabled();
  await page.route('**/api/pons/image-publish', route => route.fulfill({ status: 503, json: { error: 'IPFS unavailable' } }));
  await page.locator('#publish-image').click();
  await expect(page.locator('#notice')).toHaveText('IPFS unavailable');
  await expect(page.locator('[name=logo]')).toHaveValue(logo);
  await page.unroute('**/api/pons/image-publish');
  await page.route('**/api/pons/image-publish', route => route.fulfill({ json: { publication: { uri: logo + '/image.png' } } }));
  await page.locator('#publish-image').click();
  await expect(page.locator('[name=logo]')).toHaveValue(logo + '/image.png');
  await page.reload(); await expect(page.locator('[name=logo]')).toHaveValue(logo + '/image.png');
});
