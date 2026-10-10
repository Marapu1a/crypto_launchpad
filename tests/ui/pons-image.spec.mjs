import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import sharp from 'sharp';
const logo='ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee';
const config=JSON.parse(fs.readFileSync('config/rehearsals/first-token.json'));
test('Studio uses the Pons upload result, blocks launch during upload and saves URI',async({page})=>{
 await page.route('**/api/studio/projects',route=>route.fulfill({json:{projects:[],defaults:{config,team:'0x0000000000000000000000000000000000000001',operations:'0x0000000000000000000000000000000000000002'}}}));
 let release;
 await page.route('**/api/pons/image-publish',async route=>{
  await new Promise(r=>release=r);
  await route.fulfill({json:{publication:{uri:logo+'/image.png',storage:'pons',verified:false,warning:'Чтение пока не подтверждено'}}});
 });
 await page.goto('/launch.html');
 const buffer=await sharp({create:{width:32,height:32,channels:3,background:'red'}}).png().toBuffer();
 await page.locator('#studio-image').setInputFiles({name:'image.png',mimeType:'image/png',buffer});
 await page.locator('#studio-upload').click();
 await expect(page.locator('#create')).toBeDisabled();await expect(page.locator('#new')).toBeDisabled();
 await expect.poll(()=>typeof release).toBe('function');release();
 await expect(page.locator('[name=logo]')).toHaveValue(logo+'/image.png');
 await expect(page.locator('#notice')).toHaveText('Чтение пока не подтверждено');
 await expect(page.locator('#create')).toBeEnabled();
 await page.reload();await expect(page.locator('[name=logo]')).toHaveValue(logo+'/image.png');
});
