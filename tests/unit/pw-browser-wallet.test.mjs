import test from 'node:test';
import assert from 'node:assert/strict';
import {sendPwBrowserStep} from '../../src/launch/pw-browser-wallet.mjs';
const owner='0x'+'11'.repeat(20);
const request={chainId:4663,nonce:7,value:'0',type:2,gasLimit:'25000',maxFeePerGas:'42000000',maxPriorityFeePerGas:'1',data:'0x1234',to:null};
function wallet(overrides={}){
 const calls=[];
 return {calls,request:async({method,params})=>{
  calls.push({method,params});if(method in overrides)return overrides[method];
  if(method==='eth_accounts'||method==='eth_requestAccounts')return [owner];
  if(method==='eth_chainId')return '0x1237';
  if(method==='eth_getTransactionCount')return '0x7';
  if(method==='eth_sendTransaction')return '0x'+'aa'.repeat(32);
  throw Error(method);
 }};
}
test('browser wallet sends explicit nonce, chain, gas and exact payload once',async()=>{
 const w=wallet();await sendPwBrowserStep(w,request,owner);
 const sent=w.calls.filter(x=>x.method==='eth_sendTransaction');assert.equal(sent.length,1);
 assert.deepEqual(sent[0].params,[{from:owner,data:'0x1234',chainId:'0x1237',nonce:'0x7',value:'0x0',type:'0x2',gas:'0x61a8',maxFeePerGas:'0x280de80',maxPriorityFeePerGas:'0x1'}]);
});
test('wrong account, changed nonce and missing wallet never send',async()=>{
 for(const override of [{eth_requestAccounts:['0x'+'22'.repeat(20)]},{eth_accounts:[]},{eth_getTransactionCount:'0x8'}]){
  const w=wallet(override);await assert.rejects(sendPwBrowserStep(w,request,owner));assert.equal(w.calls.some(c=>c.method==='eth_sendTransaction'),false);
 }
 await assert.rejects(sendPwBrowserStep(undefined,request,owner));
});
