import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {withFence,checkFence,requireFence}=require('../../server/adapters/qianqi/fence.cjs');

test('production policy is fail-closed outside scope; local default remains usable',async()=>{
 await checkFence();
 await assert.rejects(checkFence({required:true}),/fence missing/);
 assert.throws(()=>withFence(null,()=>{}),/fence required/);
 requireFence();
 await assert.rejects(checkFence(),/fence missing/);
 let checks=0;
 await withFence(async()=>{checks++;},async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  await checkFence();
 });
 assert.equal(checks,1);
 await assert.rejects(checkFence(),/fence missing/);
 await assert.rejects(withFence(async()=>{throw Error('lease lost');},()=>checkFence()),/lease lost/);
});
