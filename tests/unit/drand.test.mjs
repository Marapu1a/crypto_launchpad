import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBeacon,validateInfo } from '../../src/randomness/drand.mjs';
const vector=JSON.parse(readFileSync(new URL('../../vendor/qianqi/research/drand-feasibility/vector.json',import.meta.url)));
test('Pin drand chain, scheme, key and schedule; reject changed API profile',()=>{
  assert.equal(validateInfo(vector.info),vector.info);
  for(const patch of [{period:30},{genesis_time:1},{hash:'other'},{public_key:'other'},{schemeID:'other'}])assert.throws(()=>validateInfo({...vector.info,...patch}));
});
test('Beacon must match fixed round and signature hash; malformed data rejected',()=>{
  const b=vector.beacon;assert.equal(validateBeacon(b,b.round),'0x'+b.signature);
  for(const patch of [{round:b.round+1},{signature:'00'},{randomness:'0'.repeat(64)},{signature:null}])assert.throws(()=>validateBeacon({...b,...patch},b.round));
});
