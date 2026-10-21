import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Wallet,Transaction,id} from 'ethers';
import {createTestPostgres} from '../contracts/production-postgres.mjs';
import {registerServiceGasBudget,serviceGasBudget} from '../../server/shared/service-gas-budget.mjs';
import {inProject} from '../../server/shared/store.mjs';
const root='.local/test-results/service-gas-budget-'+new Date().toISOString().replace(/[:.]/g,'-');mkdirSync(root,{recursive:true});
const report={status:'FAIL',checks:[],limits:['Isolated PostgreSQL; signed test transactions only; no network sends']};let db;
try{
 db=await createTestPostgres(root+'/postgres');
 const a=Wallet.createRandom(),b=Wallet.createRandom(),target=Wallet.createRandom().address,projectId='88888888-8888-4888-8888-888888888888',other='99999999-9999-4999-8999-999999999999';
 await db.admin.query("INSERT INTO launchpad.projects VALUES($1,'gas-budget','Gas',4663,$2,'test')",[projectId,target.toLowerCase()]);
 const policy={schema:'service-gas-budget-v1',chainId:4663,projectId,launchAt:1000,periodSeconds:2592000,limitWei:'100000',senders:[a.address.toLowerCase(),b.address.toLowerCase()].sort()};
 let at=1100;const make=()=>serviceGasBudget(db.pools.executor,policy,{clock:()=>at});
 const req=nonce=>({to:target,chainId:4663,nonce,type:2,value:0,data:'0x',gasLimit:60000,maxFeePerGas:1,maxPriorityFeePerGas:0});
 await registerServiceGasBudget(db.pools.executor,policy);await registerServiceGasBudget(db.pools.executor,policy);
 await assert.rejects(registerServiceGasBudget(db.pools.executor,{...policy,limitWei:'200000'}),/already fixed/);
 const results=await Promise.allSettled([make().reserve(req(0),a.address),make().reserve(req(0),b.address)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'SERVICE_GAS_BUDGET_EXHAUSTED');
 const winner=results[0].status==='fulfilled'?a:b,loser=winner===a?b:a;
 assert.equal((await make().snapshot()).reservedWei,'60000');
 assert.equal((await make().snapshot()).blocked,true);
 const prepared=await make().prepared(winner.address,0);assert.equal(prepared.maxFeePerGas,'1');assert.equal(prepared.gasLimit,'60000');
 assert.equal((await make().reserve(prepared,winner.address)).replayed,true);
 await assert.rejects(make().reserve({...req(0),data:'0x01'},winner.address),/Changed reserved/);
 await assert.rejects(make().assertReserved(req(1),winner.address),/before signing/);
 // Independent process, same persisted ledger, no shared JS state.
 const child=`import {createPool} from './server/shared/store.mjs';import {serviceGasBudget} from './server/shared/service-gas-budget.mjs';const p=createPool(process.env.TEST_GAS_DB);try{console.log(JSON.stringify(await serviceGasBudget(p,JSON.parse(process.env.TEST_GAS_POLICY),{clock:()=>1100}).snapshot()));}finally{await p.end();}`;
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',child],{windowsHide:true,env:{...process.env,TEST_GAS_DB:db.url('lp_executor'),TEST_GAS_POLICY:JSON.stringify(policy)}});
 assert.equal(JSON.parse(stdout).reservedWei,'60000');
 const raw=await winner.signTransaction(req(0)),hash=Transaction.from(raw).hash;
 at=policy.launchAt+policy.periodSeconds;
 assert.equal((await make().snapshot()).reservedWei,'60000');
 await assert.rejects(make().reserve(req(0),loser.address),e=>e.code==='SERVICE_GAS_BUDGET_EXHAUSTED');
 // A reverted transaction consumes gas in the period where it is mined.
 const block={number:10,hash:id('block10'),timestamp:at},receipt={hash,status:0,blockNumber:10,blockHash:block.hash,gasUsed:21000n,gasPrice:1n};
 await assert.rejects(make().settle(raw,{...receipt,blockHash:id('other')},block),/Invalid finalized/);
 const settled=await make().settle(raw,receipt,block);assert.equal(settled.actualWei,'21000');assert.equal(settled.period,1);
 assert.equal((await make().settle(raw,receipt,block)).replayed,true);
 await assert.rejects(make().settle(raw,{...receipt,gasUsed:22000n},block),/changed/);
 assert.equal((await make().snapshot()).spentWei,'21000');
 assert.equal((await make().snapshot()).blocked,false);
 await make().reserve(req(0),loser.address);
 assert.equal((await make().snapshot()).availableWei,'19000');
 await assert.rejects(make().reserve(req(1),winner.address),e=>e.code==='SERVICE_GAS_BUDGET_EXHAUSTED');
 const priorAt=at;at--;
 await assert.rejects(make().snapshot(),/clock regressed/);at=priorAt+policy.periodSeconds;
 assert.equal((await make().snapshot()).spentWei,'0');assert.equal((await make().snapshot()).reservedWei,'60000');
 const hidden=await inProject(db.pools.executor,other,async c=>(await c.query('SELECT * FROM launchpad.service_gas_reservations')).rows);assert.equal(hidden.length,0);
 await assert.rejects(inProject(db.pools.api,projectId,c=>c.query('SELECT * FROM launchpad.service_gas_budgets')),/permission denied/);
 await assert.rejects(inProject(db.pools.executor,projectId,c=>c.query('UPDATE launchpad.service_gas_budgets SET body=body'),{readOnly:false}),/permission denied/);
 report.checks=['Concurrent executor/publisher cannot overspend one budget','Independent Node process preserves reservation','Unknown signed operation carries across periods','Reverted finalized receipt charged once; changed receipt rejected','Next period resets spent only, never pending reservation','Different project and API role cannot access ledger; runtime cannot change cap','Clock regression and changed nonce intent fail closed'];report.status='PASS';
}catch(e){report.error=e.message;console.error(e);process.exitCode=1;}
finally{writeFileSync(root+'/report.json',JSON.stringify(report,null,2));await db?.close();console.log(root+'/report.json',report.status);}
