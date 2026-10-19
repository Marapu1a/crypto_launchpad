import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,ZeroAddress} from 'ethers';
import {serviceFundingLogs} from '../../src/holders/service-funding.mjs';
import {holderFundingInstance} from '../../src/holders/funding-receipt.mjs';
import {digest} from '../../src/tickets/digest.mjs';
const address=n=>'0x'+String(n).padStart(40,'0'),hash=n=>'0x'+String(n).repeat(64);
const policy={projectId:'77777777-7777-4777-8777-777777777777',executor:address(9),project:address(8),contracts:Object.fromEntries(['token','collector','splitter','vault','short'].map((k,i)=>[k,{address:address(i+1)}]))};
const instance=holderFundingInstance({projectId:policy.projectId,chainId:4663,token:address(1),asset:ZeroAddress});
const abi=new Interface(['function forward()','function deliver(uint256)','event Revenue(bytes32 indexed instance,address indexed source,uint256 amount,uint256 totalReceived)','event Deposited(bytes32 indexed instance,address indexed source,uint256 amount,uint256 totalReceived)','event Delivered(uint256 indexed lane,address indexed recipient,uint256 amount)']);
function fixture(lane){
 const forward=lane===undefined,to=policy.contracts[forward?'collector':'splitter'].address,data=abi.encodeFunctionData(forward?'forward':'deliver',forward?[]:[lane]);
 const transaction={hash:hash(1),blockHash:hash(2),blockNumber:12,nonce:5,chainId:4663n,value:0n,to,from:policy.executor,data};
 const history={hash:hash(1),blockHash:hash(2),blockNumber:12,nonce:5,action:'runtime:1:'+(forward?'collector.forward':'splitter.deliver'),requestHash:digest({to,data,value:'0'})};
 const log=(name,role,args,index)=>({...abi.encodeEventLog(abi.getEvent(name),args),address:policy.contracts[role].address,index});
 const logs=forward?[log('Revenue','splitter',[instance,address(2),10n,10n],0)]:[
  ...(lane===0?[log('Deposited','vault',[instance,address(3),6n,6n],0)]:[]),
  log('Delivered','splitter',[lane,lane===0?address(4):lane===1?address(5):policy.project,6n],1)
 ];
 return {history,transaction,receipt:{hash:hash(1),blockHash:hash(2),blockNumber:12,status:1,logs}};
}
test('only the saved call determines required funding events, including legitimate non-holder lanes',()=>{
 for(const lane of [undefined,0,1,2]){
  const f=fixture(lane),run=()=>serviceFundingLogs(policy,f.history,f.transaction,f.receipt);
  assert.equal(run().length,lane===undefined||lane===0?1:0);
  f.receipt.logs=[];assert.throws(run,/holder-funding-evidence-missing/);
 }
});
test('wrong intent, amount, source, emitter, duplicate or missing deposit cannot pass',()=>{
 const mutations=[
  f=>f.transaction.nonce++,f=>f.transaction.to=address(8),f=>f.transaction.from=address(8),
  f=>f.transaction.data=abi.encodeFunctionData('deliver',[1]),
  f=>f.receipt.logs.shift(),f=>f.receipt.logs.push(f.receipt.logs[0]),
  f=>f.receipt.logs[0].address=address(8),
  f=>Object.assign(f.receipt.logs[0],abi.encodeEventLog(abi.getEvent('Deposited'),[instance,address(3),7n,7n])),
  f=>Object.assign(f.receipt.logs[0],abi.encodeEventLog(abi.getEvent('Deposited'),[instance,address(8),6n,6n])),
  f=>f.receipt.blockHash=hash(3)
 ];
 for(const mutate of mutations){const f=fixture(0);mutate(f);assert.throws(()=>serviceFundingLogs(policy,f.history,f.transaction,f.receipt),/holder-funding-evidence-missing/);}
});
