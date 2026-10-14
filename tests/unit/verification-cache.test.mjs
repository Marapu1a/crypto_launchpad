import test from 'node:test';
import assert from 'node:assert/strict';
import {enableVerificationCache,cachedVerification,rememberVerification} from '../../src/worker/verification-cache.mjs';
test('verification cannot cross provider, policy, block number or reorg hash',()=>{
 const p={},other={},result={schema:'test',blockNumber:12,blockHash:'branch-a',authorizationToSend:false};
 rememberVerification(p,'policy',result);assert.equal(cachedVerification(p,'policy',{number:12,hash:'branch-a'}),null);
 enableVerificationCache(p);rememberVerification(p,'policy',result);
 for(const [provider,key,block] of [[other,'policy',{number:12,hash:'branch-a'}],[p,'changed-policy',{number:12,hash:'branch-a'}],[p,'policy',{number:13,hash:'branch-a'}],[p,'policy',{number:12,hash:'branch-b'}]])assert.equal(cachedVerification(provider,key,block),null);
 const copy=cachedVerification(p,'policy',{number:12,hash:'branch-a'});copy.authorizationToSend=true;
 assert.equal(cachedVerification(p,'policy',{number:12,hash:'branch-a'}).authorizationToSend,false);
});
