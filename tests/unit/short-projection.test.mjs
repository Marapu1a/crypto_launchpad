import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Interface,keccak256} from 'ethers';
import {ABI} from '../../src/worker/production-template.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {buildShortSnapshot,publishShortView} from '../../server/short-runtime/projection.mjs';

const hash='0x'+'a'.repeat(64),abi=new Interface(ABI.program),code='0x6000';
function fixture(){
 const policy={contracts:{program:{address:'0x'+'1'.repeat(40),codeHash:keccak256(code)}},template:{thresholdRaw:'10000000',minimumFund:'1',minimumUnit:'5000000',weights:[7,1],interval:'86400',creatorTaxBps:200,bps:[8000,1500,500]}};
 const state={identity:digest(policy),pending:{raw:'secret-raw'},runtime:{schema:'production-runtime-v1',ledger:{head:{number:1,hash},events:[],confirmations:[],bundles:{},evidence:{}},cycles:{'1':{participantsHash:hash,budget:'40000000'}}}};
 const values={freeFund:50000000n,liabilities:0n,cycle:1n,pending:false,lastTerminal:100n,draws:[hash,hash,hash,40000000n,0n,true]},calls=[];
 const provider={getBlock:async n=>({number:n==='finalized'?2:n,hash,timestamp:200}),getCode:async()=>code,call:async req=>{assert.equal(req.blockTag,1);calls.push(req);const name=abi.parseTransaction(req).name;return abi.encodeFunctionResult(name,name==='draws'?values[name]:[values[name]]);}};
 return {provider,policy,state,calls};
}
test('Snapshot is an explicit finalized whitelist; basket floor and no-winner draw remain exact',async()=>{
 const f=fixture(),s=await buildShortSnapshot({...f,metadata:{symbol:'TOK',privateKey:'secret-key'}});
 assert.equal(s.settings.minimumFundRaw,'40000000');assert.equal(s.nextEligibleAt,'86500');assert.equal(s.draw.awardedRaw,'0');assert.equal(s.draw.settled,true);assert.equal(s.tickets.totalIssued,'0');assert.equal(s.checkpoint.number,1);assert.equal(s.finalized.number,2);assert.ok(!JSON.stringify(s).includes('secret'));assert.equal(f.calls.length,6);
});
test('Unfinalized, reorged or unmatched draw snapshots fail instead of publishing plausible values',async()=>{
 const a=fixture();a.provider.getBlock=async n=>({number:n==='finalized'?0:n,hash,timestamp:200});await assert.rejects(buildShortSnapshot(a),/finalized/);
 const b=fixture();b.state.runtime.cycles['1'].budget='3';await assert.rejects(buildShortSnapshot(b),/snapshot/);
 const c=fixture();let heads=0;const read=c.provider.getBlock;c.provider.getBlock=async n=>{const block=await read(n);if(n===1&&++heads>1)block.hash='changed';return block;};await assert.rejects(buildShortSnapshot(c),/branch changed/);
});
test('Paused publication never reads chain; public clock/gas attention carries no RPC exception text',async()=>{
 const writes=[],client={query:async(sql,args)=>{if(sql.startsWith('INSERT'))writes.push(args);return {rows:[]};},release(){}};
 const pool={query:async()=>({rows:[{name:'lp_executor',rolsuper:false,rolbypassrls:false}]}),connect:async()=>client};
 const args={pool,provider:{getBlock:()=>{throw Error('must not call');}},projectId:'a5897d1a-def5-4c9f-a7bb-a76f2b16519e',moduleId:'a5897d1a-def5-4c9f-a7bb-a76f2b16519e'};
 await publishShortView({...args,status:'paused'});assert.equal(writes[0][2],'paused');assert.equal(writes[0][3],false);
 await publishShortView({...args,status:'waiting',reason:'chain-clock'});assert.equal(writes[1][2],'blocked');assert.equal(writes[1][3],true);
});
