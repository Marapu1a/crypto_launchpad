import {test} from 'node:test';
import assert from 'node:assert/strict';
import {drawEligibleAt} from '../../src/worker/draw-schedule.mjs';
import {igwMonthlyDraft,upgradeProgramDraft,validateProgramConfig} from '../../src/draws/program-config.mjs';
import {qianqiPreset} from '../../src/draws/config.mjs';
test('Monthly IGW is explicit, isolated from legacy config and preserves financial settings',()=>{
 const old=upgradeProgramDraft(qianqiPreset(),5000),before=structuredClone(old),c=igwMonthlyDraft(old);
 assert.deepEqual(old,before);assert.equal(c.version,3);assert.equal(c.short.intervalSeconds,2592000);
 assert.equal(c.monthly.enabled,false);assert.equal(c.allocation.shortBps,10000);assert.deepEqual(c.fees,old.fees);
 assert.deepEqual(c.short.basket,old.short.basket);assert.equal(c.ticketPurchase,old.ticketPurchase);
 for(const change of [{version:2},{schedule:{algorithm:'monthly',cadence:'launch-then-terminal-30d'}},{short:{...c.short,intervalSeconds:86400}},{monthly:{...c.monthly,enabled:true}}])assert.throws(()=>validateProgramConfig({...c,...change}));
});
test('First cycle starts at canonical token launch; later cycles and legacy keep terminal time',async()=>{
 const policy={template:{config:{version:3,schedule:{cadence:'launch-then-terminal-30d'}}},anchor:{number:10,hash:'0xab'}};
 const provider={getBlock:async n=>{assert.equal(n,11);return {timestamp:200,parentHash:'0xAB'};}};
 assert.equal(await drawEligibleAt(provider,policy,'short',0n,100n,2592000n),2592200n);
 const noRead={getBlock:()=>{throw Error('unexpected read');}};
 assert.equal(await drawEligibleAt(noRead,policy,'short',1n,300n,2592000n),2592300n);
 assert.equal(await drawEligibleAt(noRead,{...policy,template:{config:{version:2}}},'short',0n,100n,86400n),86500n);
 await assert.rejects(drawEligibleAt({getBlock:async()=>null},policy,'short',0n,100n,2592000n));
 await assert.rejects(drawEligibleAt({getBlock:async()=>({timestamp:200,parentHash:'0xcd'})},policy,'short',0n,100n,2592000n));
});
