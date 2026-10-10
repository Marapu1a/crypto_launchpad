import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transition,probe} from '../../ops/watchdog/run.mjs';
test('single transient failure is suppressed; second check alerts; reminders and recovery',()=>{
 const first=transition({},['offline'],1000);assert.equal(first.notify,false);
 const second=transition(first.state,['offline'],301000);assert.equal(second.notify,true);
 const sent={...second.state,announced:['offline'],sentAt:301000};
 assert.equal(transition(sent,['offline'],601000).notify,false);
 assert.equal(transition(sent,['offline'],301000+6*3600000).notify,true);
 assert.equal(transition(sent,[],701000).recovery,true);
 assert.equal(transition(sent,['offline','backup'],701000).notify,true);
});
test('failed notification remains eligible for retry without marking it sent',()=>{
 const second=transition(transition({},['offline'],1000).state,['offline'],301000);
 assert.equal(transition(second.state,['offline'],601000).notify,true);
});
test('API probe refuses errors, invalid payloads and redirects; stale is reachable',async()=>{
 for(const status of ['observed','stale'])assert.equal(await probe('https://example.invalid',async()=>({ok:true,json:async()=>({status})})),true);
 assert.equal(await probe('https://example.invalid',async()=>({ok:false})),false);
 assert.equal(await probe('https://example.invalid',async()=>({ok:true,json:async()=>({})})),false);
 assert.equal(await probe('https://example.invalid',async()=>{throw Error('offline');}),false);
});
