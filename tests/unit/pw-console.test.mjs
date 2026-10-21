import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,Transaction} from 'ethers';
import {createPwConsole} from '../../server/owner-launch/pw-console.mjs';
const owner=new Wallet('0x'+'11'.repeat(32)); // public test key, never used on a network
function fixture({enabled=true,signer=owner}={}){
 let state=null,at=1000,records=0,broadcasts=0,signatures=0,fail=false;
 const request={from:owner.address,to:null,chainId:4663,nonce:0,type:2,value:'0',data:'0x1234',gasLimit:'21000',maxFeePerGas:'100',maxPriorityFeePerGas:'1'};
 const quote={kind:'vault',request,estimatedGas:'21000',maximumNativeCost:'2100000',totalNativeLimit:'9999999',authorizationToSend:false};
 const coordinator={info:()=>({mode:'preview'}),inspect:async()=>state,prepare:async()=>state={stage:'prepared',steps:[{kind:'vault'}],history:[],pending:null},quote:async()=>structuredClone(quote),record:async(id,raw)=>{records++;if(fail){fail=false;throw Error('temporary DB error');}state.pending={kind:'vault',raw,hash:Transaction.from(raw).hash};state.stage='pending';return state;},broadcast:async()=>{broadcasts++;},resolve:async()=>state};
 const app=createPwConsole({coordinator,input:{id:'fixture',draft:{name:'PW',symbol:'TEST'}},owner:owner.address,enabled,now:()=>at,signer:{getAddress:()=>signer.getAddress(),signTransaction:r=>{signatures++;return signer.signTransaction(r);}}});
 return {app,quote,expire:()=>at+=120001,fail:()=>fail=true,counts:()=>({records,broadcasts,signatures})};
}
test('sign persists first, never broadcasts, retries same bytes after DB failure, redacts raw',async()=>{
 const f=fixture();await f.app.run('prepare');const q=await f.app.run('quote');f.fail();
 await assert.rejects(f.app.run('sign',{reviewId:q.reviewId}),/temporary/);
 const saved=await f.app.run('sign',{reviewId:q.reviewId});assert.equal(saved.stage,'pending');assert.equal(saved.pending.raw,undefined);
 assert.deepEqual(f.counts(),{records:2,broadcasts:0,signatures:1});
 await assert.rejects(f.app.run('broadcast',{hash:'wrong'}));
 await f.app.run('broadcast',{hash:saved.pending.hash});assert.equal(f.counts().broadcasts,1);
 assert.equal(JSON.stringify(await f.app.run('status')).includes('raw'),false);
});
test('disabled, stale, altered quote and signer cannot authorize a signature',async()=>{
 const disabled=fixture({enabled:false});await disabled.app.run('prepare');const q=await disabled.app.run('quote');await assert.rejects(disabled.app.run('sign',{reviewId:q.reviewId}));assert.equal(disabled.counts().signatures,0);
 const stale=fixture();await stale.app.run('prepare');const s=await stale.app.run('quote');stale.expire();await assert.rejects(stale.app.run('sign',{reviewId:s.reviewId}));assert.equal(stale.counts().signatures,0);
 const changed=fixture();await changed.app.run('prepare');const c=await changed.app.run('quote');changed.quote.request.maxFeePerGas='101';await assert.rejects(changed.app.run('sign',{reviewId:c.reviewId}));assert.equal(changed.counts().signatures,0);
 const wrong=fixture({signer:Wallet.createRandom()});await wrong.app.run('prepare');const w=await wrong.app.run('quote');await assert.rejects(wrong.app.run('sign',{reviewId:w.reviewId}));assert.equal(wrong.counts().signatures,0);
});
test('signer cannot change reviewed fees even within launch policy limits',async()=>{
 const f=fixture({signer:{getAddress:()=>owner.getAddress(),signTransaction:r=>owner.signTransaction({...r,maxFeePerGas:101})}});
 await f.app.run('prepare');const q=await f.app.run('quote');await assert.rejects(f.app.run('sign',{reviewId:q.reviewId}));assert.equal(f.counts().records,0);
});

test('browser arm uses a live review, persists before returning and recovers after restart without signing',async()=>{
 let state={stage:'prepared',steps:[{kind:'vault'}],history:[],pending:null},armed=0,quotes=0,at=0;
 const request={from:owner.address,nonce:0};
 const coordinator={info:()=>({mode:'preview'}),inspect:async()=>state,quote:async()=>{quotes++;return {kind:'vault',request};},armWallet:async(id,q)=>{armed++;state={...state,stage:'wallet-pending',walletPending:q};return state;}};
 const make=(enabled=true)=>createPwConsole({coordinator,input:{id:'fixture',draft:{name:'PW'}},owner:owner.address,browserWallet:true,enabled,now:()=>at});
 let app=make();const q=await app.run('quote');
 await assert.rejects(app.run('wallet-arm',{reviewId:'wrong'}));assert.equal(armed,0);
 await assert.rejects(make(false).run('wallet-arm',{reviewId:q.reviewId}));
 at=120001;await assert.rejects(app.run('wallet-arm',{reviewId:q.reviewId}));assert.equal(armed,0);
 const live=await app.run('quote');const result=await app.run('wallet-arm',{reviewId:live.reviewId});
 assert.deepEqual(result.walletPending.request,request);assert.equal(armed,1);assert.equal(quotes,2);
 app=make();assert.deepEqual((await app.run('wallet-arm')).walletPending.request,request);assert.equal(armed,1);
});
