import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchesOwnerTransaction} from '../../server/owner-launch/coordinator.mjs';
import {signReservedOwnerStep} from '../../src/pons/owner-signing.mjs';
const owner='0x0000000000000000000000000000000000000001',to='0x0000000000000000000000000000000000000002';
const request={from:owner,to,data:'0xab',value:'5',nonce:8,chainId:4663,gasLimit:'200000',gasPrice:'100'};
const tx={...request,value:5n,chainId:4663n,gasLimit:200000n,gasPrice:100n};
test('Receipt recovery binds owner, chain, nonce, call and both gas caps',()=>{
 assert.equal(matchesOwnerTransaction(tx,{request},owner),true);
 for(const change of [{from:to},{chainId:31337n},{nonce:9},{to:owner},{data:'0xac'},{value:6n},{gasLimit:200001n},{gasPrice:101n},{maxFeePerGas:101n},{authorizationList:[{}]}])assert.equal(matchesOwnerTransaction({...tx,...change},{request},owner),false);
 assert.equal(matchesOwnerTransaction({...tx,to:null},{request:{...request,to:null}},owner),true);
 assert.equal(matchesOwnerTransaction({...tx,gasPrice:undefined},{request},owner),false);
});
test('Wallet signs only a reserved request on the matching rehearsal instance',async()=>{
 const calls=[],state={owner,instanceId:'fork',pending:{state:'requesting',request}};
 const wallet={request:async args=>{calls.push(args);return {eth_chainId:'0x1237',eth_accounts:[owner],hardhat_metadata:{chainId:4663,instanceId:'fork',forkedNetwork:{chainId:4663}},eth_sendTransaction:'0x'+'ab'.repeat(32)}[args.method];}};
 assert.match(await signReservedOwnerStep(wallet,state),/^0x/);
 assert.deepEqual(calls.at(-1).params,[{from:owner,to,data:'0xab',value:'0x5',nonce:'0x8',chainId:'0x1237',gas:'0x30d40',gasPrice:'0x64'}]);
 await assert.rejects(signReservedOwnerStep(wallet,{...state,instanceId:'other'}));
 await assert.rejects(signReservedOwnerStep(wallet,{...state,pending:{...state.pending,hash:'0xalready'}}));
 assert.equal(calls.filter(c=>c.method==='eth_sendTransaction').length,1);
});
