import { ValidationError } from './validation.mjs';
async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (body.fields) throw new ValidationError(body.fields);
    throw Error(body.error || 'Сервер проверки недоступен');
  }
  return body;
}
export async function prepareOnServer(draft, account, mode) {
  const { plan } = await responseJson(await fetch('/api/pons/prepare', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft, account, mode }), signal: AbortSignal.timeout(60000),
  }));
  for (const key of ['fee', 'supply']) plan.terms[key] = BigInt(plan.terms[key]);
  for (const key of ['phantomQuote', 'graduationThreshold']) plan.terms.quote[key] = BigInt(plan.terms.quote[key]);
  plan.input.amount = BigInt(plan.input.amount);
  for (const step of plan.steps) step.value = BigInt(step.value);
  if (plan.tx) plan.tx.value = BigInt(plan.tx.value);
  for (const key of ['tokensOut', 'minOut', 'gas', 'gasCost']) if (plan[key] !== undefined) plan[key] = BigInt(plan[key]);
  return plan;
}
export async function checkImageOnServer(file) {
  return responseJson(await fetch('/api/pons/image-check', { method: 'POST', headers: { 'Content-Type': file.type }, body: file, signal: AbortSignal.timeout(30000) }));
}
export async function publishImageOnServer(file) {
  return responseJson(await fetch('/api/pons/image-publish', { method: 'POST', headers: { 'Content-Type': file.type }, body: file, signal: AbortSignal.timeout(60000) }));
}
