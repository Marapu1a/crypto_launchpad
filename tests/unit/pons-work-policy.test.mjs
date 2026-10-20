import {test} from 'node:test';
import assert from 'node:assert/strict';
import {schedulePonsResult,shouldPublishContracts} from '../../server/shared/pons-work-policy.mjs';
import {createPonsService} from '../../server/shared/pons-service.mjs';

test('every adapter shares waiting cadence and suppresses contract projection, but can publish local status',async()=>{
 for(const reason of ['receiptFinality','receipt-finality','receipt','recognition-finality','finality-unavailable']){
  let projections=0,localStatus;
  const service=createPonsService({now:()=>1000,loadReport:async()=>null,run:async()=>({status:'waiting',reason}),observe:()=>({status:'unknown'}),publish:async result=>{localStatus=result;if(shouldPublishContracts(result))projections++;}});
  const result=await service();assert.equal(result.retryAt,61000);assert.equal(projections,0);assert.equal(localStatus.reason,reason);
 }
});
test('resource wait backs off; budget deadline is preserved; completed work publishes',()=>{
 assert.equal(schedulePonsResult({status:'waiting',reason:'native-balance'},1000).retryAt,301000);
 assert.equal(schedulePonsResult({status:'error',reason:'rpc-budget-exhausted',retryAt:3600000},1000).retryAt,3600000);
 assert.equal(shouldPublishContracts({status:'confirmed'}),true);
 assert.equal(shouldPublishContracts({status:'waiting',reason:'conditions',serviceIdle:true}),true);
 assert.equal(shouldPublishContracts({status:'blocked'}),false);
});
