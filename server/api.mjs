import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { providerFor, stringify } from '../src/pons/client.mjs';
import { preparePlan, simulatePlan } from '../src/pons/plan.mjs';
import { IMAGE_LIMITS, imageMetadataErrors, requestFields, ValidationError } from '../src/pons/validation.mjs';
import { assertLocalFork } from '../src/pons/local-execution.mjs';
import rpcConfig from '../scripts/rpc-config.cjs';
import { ponsPublisher, ImageUploadError } from './ipfs.mjs';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function bodyBytes(req, limit) {
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new HttpError(415, 'Сжатые запросы не поддерживаются');
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new HttpError(413, 'Запрос слишком большой');
  const chunks = []; let total = 0;
  // Keep the socket alive long enough to return a structured 413 for chunked bodies.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new HttpError(408, 'Истекло время загрузки')), 15_000);
    const finish = error => { clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', aborted); if (error) { req.resume(); reject(error); } else resolve(); };
    const data = chunk => { total += chunk.length; if (total > limit) finish(new HttpError(413, 'Запрос слишком большой')); else chunks.push(chunk); };
    const end = () => finish(); const fail = () => finish(new HttpError(400, 'Ошибка чтения запроса')); const aborted = () => finish(new HttpError(400, 'Загрузка прервана'));
    req.on('data', data); req.on('end', end); req.on('error', fail); req.on('aborted', aborted);
  });
  return Buffer.concat(chunks);
}
export async function checkImage(buffer, type) {
  const invalid = imageMetadataErrors({ size: buffer.length, type });
  if (invalid) throw new ValidationError({ image: invalid });
  try {
    const image = sharp(buffer, { failOn: 'warning', limitInputPixels: IMAGE_LIMITS.side ** 2 });
    const meta = await image.metadata();
    if (`image/${meta.format}` !== type || (meta.pages ?? 1) !== 1) throw Error('format');
    const invalidSize = imageMetadataErrors({ size: buffer.length, type, width: meta.width, height: meta.height });
    if (invalidSize) throw new ValidationError({ image: invalidSize });
    await image.stats(); // Decode pixels too: a plausible header alone is not enough.
    return { width: meta.width, height: meta.height, type, size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError({ image: 'Файл повреждён, имеет неверный формат или превышает допустимые размеры' });
  }
}
function configuredProvider(mode) {
  return providerFor(mode === 'fork' ? 'http://127.0.0.1:8545' : rpcConfig.resolveRpc().url);
}
export function createApiMiddleware({ getProvider = configuredProvider, prepare = preparePlan, simulate = simulatePlan, publishImage = ponsPublisher() } = {}) {
  let running = 0;
  return async (req, res, next = () => { res.statusCode = 404; res.end(); }) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/')) return next();
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(stringify(body)); };
    let acquired = false, provider;
    try {
      if (!['/api/pons/prepare', '/api/pons/image-check', '/api/pons/image-publish'].includes(path)) throw new HttpError(404, 'Маршрут не найден');
      if (req.method !== 'POST') throw new HttpError(405, 'Требуется POST');
      if (req.headers.origin) {
        let origin; try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, 'Недопустимый Origin'); }
        if (origin.host !== req.headers.host) throw new HttpError(403, 'Недопустимый Origin');
      }
      if (running >= 4) throw new HttpError(429, 'Слишком много проверок одновременно. Повторите позже');
      running++; acquired = true;
      const type = req.headers['content-type']?.split(';')[0].trim().toLowerCase();
      if (path === '/api/pons/image-check' || path === '/api/pons/image-publish') {
        if (path.endsWith('image-publish')) {
          if (!req.headers.origin || !['127.0.0.1', '[::1]', 'localhost'].includes(new URL(req.headers.origin).hostname)) throw new HttpError(403, 'Публикация доступна только из локальной панели');
          if (!publishImage) throw new HttpError(503, 'Загрузчик Pons недоступен. Можно указать готовый ipfs:// адрес.');
        }
        if (!IMAGE_LIMITS.types.includes(type)) throw new HttpError(415, 'Нужен PNG, JPEG или WebP');
        const buffer = await bodyBytes(req, IMAGE_LIMITS.bytes);
        const result = await checkImage(buffer, type);
        if (path.endsWith('image-publish')) {
          let publication;
          try { publication = await publishImage(buffer, result); }
          catch (error) { throw new HttpError(503, error instanceof ImageUploadError ? error.message : 'Pons не подтвердил загрузку. Проверьте картинку через сайт Pons.'); }
          reply(200, { image: result, publication });
        } else reply(200, { image: result });
        return;
      }
      if (type !== 'application/json') throw new HttpError(415, 'Требуется application/json');
      let body; try { body = JSON.parse((await bodyBytes(req, 32 * 1024)).toString('utf8')); }
      catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Неверный JSON'); }
      const { draft, account, mode } = requestFields(body);
      provider = getProvider(mode);
      if (mode === 'fork') await assertLocalFork(provider);
      else if ((await provider.getNetwork()).chainId !== 4663n) throw new HttpError(503, 'RPC настроен на другую сеть');
      // Client supplies neither economics, decimals, fee limits, RPC URL, nor calldata.
      let plan = await prepare(provider, draft, account);
      if (!plan.steps.length) plan = await simulate(provider, plan);
      reply(200, { plan });
    } catch (error) {
      if (error instanceof ValidationError) reply(422, { error: 'Проверьте поля формы', fields: error.fields });
      else if (error instanceof HttpError) reply(error.status, { error: error.message });
      else reply(503, { error: 'Проверка в сети не завершена. Обновите условия и повторите попытку.' });
      // Never return raw provider errors: they may include the credential-bearing RPC URL.
    } finally { if (acquired) running--; provider?.destroy?.(); }
  };
}
