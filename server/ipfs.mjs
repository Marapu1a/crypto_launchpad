import { createHash } from 'node:crypto';
import { CID } from 'multiformats/cid';
import { ipfsUri } from '../src/pons/validation.mjs';

export const PONS_UPLOAD_PAGE = 'https://ponsfamily.com/launchpad/create';
const uploadUrl = 'https://ponsfamily.com/api/ipfs/image';
const contentUrl = 'https://dbk-vercel.vercel.app/api/ipfs/content/';
let active = false;
export class ImageUploadError extends Error {}

export function publicationFromPons(value) {
  if (!value || typeof value.uri !== 'string' || typeof value.cid !== 'string') throw new ImageUploadError('Pons не вернул ссылку на картинку');
  try {
    const cid = CID.parse(value.cid);
    ipfsUri(value.uri);
    if (value.uri !== 'ipfs://' + value.cid) throw Error();
    return { uri: 'ipfs://' + cid.toV1().toString(), cid: cid.toV1().toString() };
  } catch { throw new ImageUploadError('Pons вернул некорректную IPFS-ссылку'); }
}

async function verifyContent(publication, buffer, fetcher) {
  const response = await fetcher(contentUrl + publication.cid, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw Error('Readback unavailable');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length; if (size > buffer.length) throw Error('Content changed');
    chunks.push(chunk);
  }
  if (!Buffer.concat(chunks).equals(buffer)) throw Error('Content changed');
}

// Local owner helper: drives the real Pons file input in a fresh browser context.
// No forged Origin, session import, login, wallet, CAPTCHA solving, or launch click.
export function ponsPublisher({ launchBrowser, fetcher = fetch } = {}) {
  return async (buffer, image) => {
    if (active) throw new ImageUploadError('Другая картинка уже загружается в Pons. Дождитесь результата.');
    active = true;
    let browser, deadline;
    try {
      try { browser = await (launchBrowser ?? (async () => (await import('playwright')).chromium.launch({ timeout: 15000 })))(); }
      catch { throw new ImageUploadError('Не удалось открыть помощник Pons. Установите Chromium: npx playwright install chromium'); }
      deadline = setTimeout(() => { void browser.close().catch(() => {}); }, 60000);
      const page = await browser.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(PONS_UPLOAD_PAGE, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (page.url() !== PONS_UPLOAD_PAGE) throw new ImageUploadError('Pons перенаправил загрузчик. Откройте его сайт вручную.');
      // SSR inputs can precede React handlers. Retry only the harmless local
      // draft edit, never the upload, until persistence confirms hydration.
      let hydrated = false;
      for (let attempt = 0; attempt < 3 && !hydrated; attempt++) {
        const name = `Image upload ${attempt}`;
        await page.getByPlaceholder('Pons Coin', { exact: true }).fill(name);
        try {
          await page.waitForFunction(expected => {
            try { return JSON.parse(localStorage.getItem('pons-launch-draft:v1') || '{}').name === expected; }
            catch { return false; }
          }, name, { timeout: 3000 });
          hydrated = true;
        } catch {}
      }
      if (!hydrated) throw new ImageUploadError('Форма Pons не загрузилась. Попробуйте открыть сайт Pons вручную.');
      const responsePromise = page.waitForResponse(r => r.url() === uploadUrl && r.request().method() === 'POST', { timeout: 30000 });
      responsePromise.catch(() => {});
      await page.locator('input[type=file]').setInputFiles({ name: 'token.' + image.type.split('/')[1], mimeType: image.type, buffer });
      const response = await responsePromise;
      if (!response.ok()) {
        if (response.status() === 429) throw new ImageUploadError('Pons ограничил частоту загрузок. Попробуйте позже.');
        throw new ImageUploadError(`Pons не принял картинку (HTTP ${response.status()}). Проверьте её через форму Pons.`);
      }
      const raw = await response.body();
      if (raw.length > 8192) throw new ImageUploadError('Неожиданный ответ загрузчика Pons');
      const publication = publicationFromPons(JSON.parse(raw.toString('utf8')));
      // Keep a successful URI even when the gateway has not caught up yet.
      let verified = false;
      try { await verifyContent(publication, buffer, fetcher); verified = true; } catch {}
      return { ...publication, storage: 'pons', sha256: createHash('sha256').update(buffer).digest('hex'),
        uploadedAt: new Date().toISOString(), verified,
        warning: verified ? undefined : 'Pons вернул ссылку, но чтение исходного файла пока не подтверждено. Ссылка сохранена; повторная загрузка не нужна.' };
    } catch (error) {
      if (error instanceof ImageUploadError) throw error;
      throw new ImageUploadError('Загрузчик Pons не завершил работу. Можно загрузить картинку на сайте Pons и вставить готовую IPFS-ссылку.');
    } finally {
      clearTimeout(deadline);
      try { await browser?.close(); } catch {} finally { active = false; }
    }
  };
}
