import { test, expect } from '@playwright/test';
test('Simulation repeats exactly, invalidates stale output and validates participants',async({page})=>{
  await page.goto('/draws.html');
  await page.locator('#simulate-short').click();
  await expect(page.locator('#sim-result')).toContainText('Результат симуляции');
  const first=await page.locator('#sim-result').textContent();
  await page.locator('#simulate-short').click();
  expect(await page.locator('#sim-result').textContent()).toBe(first);
  await page.locator('#sim-cycle').fill('2');
  await expect(page.locator('#sim-result')).toBeEmpty();
  await page.locator('#simulate-short').click();
  expect(await page.locator('#sim-result').textContent()).not.toBe(first);
  await page.locator('#sim-participants').fill('bad address');
  await page.locator('#simulate-short').click();
  await expect(page.locator('#sim-error')).toContainText('Строка 1');
  await expect(page.locator('#sim-result')).toBeEmpty();
});
test('1000 generated participants and 64 slots work on mobile without overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/draws.html');
  await page.locator('[name=count]').fill('64');await page.locator('[name=budget]').fill('1000');
  await page.locator('[data-generate="1000"]').click();await page.locator('#simulate-short').click();
  await expect(page.locator('#sim-result')).toContainText('Участников: 1000');
  await expect(page.locator('#sim-result')).toContainText('Победителей: 64');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'.local/test-results/short-simulator-mobile.png',fullPage:true});
});
