import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeDeliveryReady} from '../../src/worker/native-delivery.mjs';
import {drawServiceObservation} from '../../server/shared/pons-draw-service.mjs';
test('Only native recipient refusal is deferred, never transport or solvency failures',async()=>{
 const c={claim:{staticCall:async()=>{}}};assert.equal(await nativeDeliveryReady(c,'claim',[1,'wallet'],'100000'),true);
 const refusal=Object.assign(Error('recipient'),{code:'CALL_EXCEPTION',reason:'native payout'});
 c.claim.staticCall=async()=>{throw refusal;};assert.equal(await nativeDeliveryReady(c,'claim',[],100000n),false);
 for(const failure of [Object.assign(Error('rpc'),{code:'NETWORK_ERROR'}),Object.assign(Error('insolvent'),{code:'CALL_EXCEPTION',reason:'claim'})]){
  c.claim.staticCall=async()=>{throw failure;};await assert.rejects(nativeDeliveryReady(c,'claim',[],100000n),e=>e===failure);
 }
});
test('Deferred native recipient exposes reason while permitting bounded service sleep',()=>{
 assert.deepEqual(drawServiceObservation({status:'waiting',reason:'native-recipient-unavailable',serviceIdle:true,nextCheckAt:3601}),{status:'idle',nextCheckAt:3601000});
 assert.equal(drawServiceObservation({status:'waiting',reason:'native-recipient-unavailable',serviceIdle:false,nextCheckAt:3601}).status,'unknown');
});
