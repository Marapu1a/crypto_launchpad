import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Wallet} from 'ethers';
import {initialDraft} from '../../src/pons/plan.mjs';
import {validateLaunch,USDG} from '../../server/studio/template.mjs';
import {transact} from '../../server/studio/journal.mjs';
import os from 'node:os';
import path from 'node:path';
import {createStudio} from '../../server/studio/service.mjs';
const draws=JSON.parse(fs.readFileSync('config/rehearsals/first-token.json')).draws;
const input=()=>({id:randomUUID(),slug:'my-token',draft:{...initialDraft(),name:'Token',symbol:'TKN',logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee',pair:USDG,creatorFee:'2',openingBuy:'6'},draws:structuredClone(draws),team:Wallet.createRandom().address,operations:Wallet.createRandom().address});
test('template preserves flexible settings and rejects unsupported or invalid launch requests',()=>{
 const i=input();i.draws.ticketPurchase='12';i.draws.fees={prizesBps:7000,teamBps:2000,operationsBps:1000};assert.deepEqual(validateLaunch(i).draws,i.draws);
 for(const change of [x=>x.slug='../qianqi',x=>x.draws.monthly.enabled=true,x=>x.draws.fees.prizesBps=9000,x=>x.draft.feeWallet=x.team,x=>x.draft.creatorFee='-1',x=>delete x.draft.salt,x=>x.rpc='https://example.invalid']){const bad=input();change(bad);assert.throws(()=>validateLaunch(bad));}
 assert.deepEqual(validateLaunch(i),validateLaunch(i),'validation must not generate another salt');
});
test('launch journal saves signed intent, refuses lost lease, resumes same hash and rejects changed request/reorg',async()=>{
 const signer=Wallet.createRandom(),target=Wallet.createRandom().address,state={instance:'fixture',transactions:{}},blockHash='0x'+'1'.repeat(64);let lost=false,sends=0,receipt=null;
 const provider={_getConnection:()=>({url:'http://127.0.0.1:1234'}),getNetwork:async()=>({chainId:31337n}),send:async()=>({instanceId:'fixture',forkedNetwork:{chainId:4663}}),getTransactionCount:async()=>0,getFeeData:async()=>({gasPrice:1n}),estimateGas:async()=>21000n,getTransactionReceipt:async()=>receipt,getBlock:async()=>({hash:blockHash}),broadcastTransaction:async raw=>{sends++;const {keccak256}=await import('ethers');receipt={hash:keccak256(raw),status:1,blockNumber:1,blockHash};return {hash:receipt.hash,wait:async()=>receipt};}};
 let saved;const args={provider,signer,state,save:async()=>{saved=structuredClone(state);},guard:async()=>{if(lost)throw Error('lease lost');},key:'step',request:{to:target,value:2n,data:'0x'}};
 await assert.rejects(transact({...args,hook:async phase=>{if(phase==='signed')lost=true;}}),/lease lost/);
 assert.equal(sends,0);assert(saved.transactions.step.raw);const hash=saved.transactions.step.hash;
 lost=false;assert.equal((await transact(args)).hash,hash);assert.equal(sends,1);await transact(args);assert.equal(sends,1);
 await assert.rejects(transact({...args,request:{...args.request,value:3n}}),/Изменился/);
 receipt=null;await assert.rejects(transact(args),/ветка/);
});
test('registered project with lost launch journal cannot be redeployed',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-lost-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const value=input();let released=false;
 const pools={admin:{connect:async()=>({on(){},removeListener(){},query:async()=>({rows:[{held:true}]}),release(){released=true;}}),query:async()=>({rowCount:1,rows:[{id:value.id}]})}};
 const studio=createStudio({root,provider:{},signer:{address:value.team},pools});
 await assert.rejects(studio.launch(value),/отсутствующий журнал/);assert.equal(released,true);assert.deepEqual(fs.readdirSync(root),[]);
});
