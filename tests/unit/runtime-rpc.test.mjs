import test from 'node:test';
import assert from 'node:assert/strict';
import {requestGate} from '../../server/short-runtime/rpc-provider.mjs';
test('concurrent primary and trace requests share a paced queue',async()=>{
 let clock=0;const starts=[],gate=requestGate({intervalMs:50,now:()=>clock,sleep:async ms=>{clock+=ms;}});
 await Promise.all(Array.from({length:60},async()=>{await gate();starts.push(clock);}));
 assert.equal(starts.length,60);
 for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=50);
 clock+=1000;await gate();assert.equal(clock,3950);
});
