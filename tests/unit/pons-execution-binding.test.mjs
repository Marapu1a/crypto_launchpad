import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {validatePonsExecutionBinding} from '../../server/adapters/qianqi/pons-execution-binding.mjs';
test('legacy public config without bps uses only the pinned QIANQI admission allocation',()=>{
 const c=createRequire(import.meta.url)('../../server/adapters/qianqi/runtime/test/fixtures/pons-public-config.json');
 const args={config:{manifest:c.manifest,lifecycle:c.lifecycle},publicConfig:c,sender:c.executor,deliveryJob:c.deliveryJob,funding:{collector:c.collector,escrow:c.escrow,quote:c.manifest.quote,campaignId:c.campaignId,recipients:c.recipients,bps:[9000,500,500],codeHashes:c.codeHashes}};
 assert.equal(c.bps,undefined);validatePonsExecutionBinding(args);
 for(const change of [{bps:[8000,1000,1000]},{campaignId:'2'},{recipients:[...c.recipients].reverse()}])assert.throws(()=>validatePonsExecutionBinding({...args,funding:{...args.funding,...change}}));
});
