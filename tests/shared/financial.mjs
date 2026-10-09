import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fork } from 'node:child_process';
import { ContractFactory,Wallet,keccak256 } from 'ethers';
import solc from 'solc';
import { providerFor } from '../../src/pons/client.mjs';
import { assertLocalFork } from '../../src/pons/local-execution.mjs';
import { createPool,inProject } from '../../server/shared/store.mjs';
import { registerFinancialExecutor,advanceFinancialOperation } from '../../server/shared/financial-journal.mjs';

export async function exerciseFinancial({admin,api,jobs,url,scenario,report}){
  const provider=providerFor('http://127.0.0.1:8545');provider.pollingInterval=50;
  const pool=createPool(url('lp_executor')),p1='55555555-5555-4555-8555-555555555555',p2='66666666-6666-4666-8666-666666666666';
  const m1='55555555-aaaa-4555-8555-555555555555',m2='66666666-bbbb-4666-8666-666666666666';
  let child;
  try{
    const meta=await assertLocalFork(provider),owner=await provider.getSigner(0),recipient=await (await provider.getSigner(8)).getAddress();
    const signers=[Wallet.createRandom().connect(provider),Wallet.createRandom().connect(provider)];
    for(const signer of signers)await provider.send('hardhat_setBalance',[signer.address,'0x56bc75e2d63100000']);
    const files=['tests/contracts/Fixtures.sol','tests/contracts/JournalPayout.sol'];
    const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:Object.fromEntries(files.map(f=>[f,{content:readFileSync(f,'utf8')}])),settings:{optimizer:{enabled:true,runs:200},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:p=>{try{return {contents:readFileSync(resolve(p.startsWith('@')?'node_modules/'+p:p),'utf8')};}catch{return {error:p};}}}));
    assert.equal((output.errors??[]).filter(e=>e.severity==='error').length,0);
    const deploy=async(file,name,args=[])=>{const a=output.contracts[file][name],c=await new ContractFactory(a.abi,a.evm.bytecode.object,owner).deploy(...args);await c.waitForDeployment();return c;};
    const tokens=[],programs=[],configs=[];
    for(const [i,p,m] of [[0,p1,m1],[1,p2,m2]]){
      const token=await deploy(files[0],'TestUSDG'),program=await deploy(files[1],'JournalPayout',[token.target,signers[i].address,recipient]);
      await (await token.mint(program.target,1000000000)).wait();tokens.push(token);programs.push(program);
      const anchor=await provider.getBlock('latest');
      const config={schema:'local-financial-journal-v1',chainId:'31337',localInstance:meta.instanceId,executor:signers[i].address,program:program.target,
        programCodeHash:keccak256(await provider.getCode(program.target)),anchor:{number:anchor.number,hash:anchor.hash},selectors:[program.interface.getFunction('pay').selector],
        limits:{maxGasPrice:'100000000000',maxGasLimit:'500000',nativeFloor:'1000000000000000'}};
      configs.push(config);
      await admin.query("INSERT INTO launchpad.projects VALUES($1,$2,$2,31337,$3,'test')",[p,'financial-'+i,token.target.toLowerCase()]);
      await admin.query("INSERT INTO launchpad.module_instances VALUES($1,$2,'short','local-financial-test-v1',$3,$4)",[p,m,program.target.toLowerCase(),'a'.repeat(64)]);
      await registerFinancialExecutor(pool,provider,p,m,config);
    }
    const request=i=>({to:programs[i].target,data:programs[i].interface.encodeFunctionData('pay',[1000000]),value:0});
    const params=(i,id)=>({pool,provider,signer:signers[i],projectId:i?p2:p1,moduleId:i?m2:m1,operationId:id,request:request(i),action:'fixture.pay'});
    const read=(p,m,id)=>inProject(pool,p,async c=>(await c.query('SELECT * FROM launchpad.financial_operations WHERE project_id=$1 AND module_id=$2 AND operation_id=$3',[p,m,id])).rows[0]);
    const finish=async options=>{for(let n=0;n<10;n++){const r=await advanceFinancialOperation(options);if(r.status!=='waiting')return r;await new Promise(r=>setTimeout(r,100));}throw Error('Receipt wait exceeded');};
    await scenario('Financial role, immutable executor and scoped signed intents are isolated',async()=>{
      await assert.rejects(registerFinancialExecutor(jobs,provider,p1,m1,configs[0]),/runtime role/);
      await assert.rejects(registerFinancialExecutor(pool,provider,p2,m2,configs[0]),/module mismatch/);
      await assert.rejects(registerFinancialExecutor(pool,provider,p2,m2,{...configs[1],executor:signers[0].address}),e=>e.code==='23505');
      for(const table of ['financial_executors','financial_operations']){
        for(const ordinary of [api,jobs])await assert.rejects(ordinary.query('SELECT * FROM launchpad.'+table),e=>e.code==='42501');
        assert.equal((await pool.query('SELECT * FROM launchpad.'+table)).rowCount,0);
      }
      await assert.rejects(advanceFinancialOperation({...params(0,'foreign'),request:request(1)}),/not allowed/);
      await assert.rejects(advanceFinancialOperation({...params(0,'wrong-signer'),signer:signers[1]}),/Wrong financial signer/);
      await assert.rejects(inProject(pool,p1,c=>c.query("UPDATE launchpad.financial_executors SET config_text='{}'"),{readOnly:false}),e=>e.code==='42501');
    });
    await scenario('Killed process after prepare resumes identical hash, while the other project progresses',async()=>{
      const id='kill-after-prepare';
      child=fork(resolve('tests/shared/financial-child.mjs'),[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
      const stopped=new Promise((ok,bad)=>{
        const timer=setTimeout(()=>bad(Error('Child prepare timeout')),20000);
        child.once('message',message=>{clearTimeout(timer);message.error?bad(Error(message.error)):ok(message);});
        child.once('error',error=>{clearTimeout(timer);bad(error);});
      });
      child.send({rpc:'http://127.0.0.1:8545',database:url('lp_executor'),testPrivateKey:signers[0].privateKey,projectId:p1,moduleId:m1,operationId:id,request:request(0),action:'fixture.pay',stopAt:'prepared'});
      const ready=await stopped,before=await read(p1,m1,id);
      assert.equal(before.tx_hash,ready.hash);assert.equal(before.status,'prepared');
      assert.equal(await provider.getTransaction(ready.hash),null);
      assert.equal((await advanceFinancialOperation(params(0,id))).status,'busy');
      assert.equal((await finish(params(1,id))).status,'confirmed');
      const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;child=null;
      const result=await finish(params(0,id));assert.equal(result.hash,ready.hash);
      assert.equal(await programs[0].calls(),1n);assert.equal(await tokens[0].balanceOf(recipient),1000000n);
      assert.equal((await finish(params(0,id))).hash,ready.hash);assert.equal(await programs[0].calls(),1n);
      await assert.rejects(advanceFinancialOperation({...params(0,id),request:{...request(0),data:programs[0].interface.encodeFunctionData('pay',[2000000])}}),/payload changed/);
      await inProject(pool,p2,async c=>assert.equal((await c.query('SELECT * FROM launchpad.financial_operations WHERE project_id=$1',[p1])).rowCount,0));
    });
    await scenario('Lost broadcast response and receipt-stage crash never pay twice',async()=>{
      for(const phase of ['broadcast','receipt']){
        const id='crash-'+phase,before=await programs[0].calls();
        await assert.rejects(advanceFinancialOperation({...params(0,id),hook:async current=>{if(current===phase)throw Error('injected crash');}}),/injected crash/);
        const pending=await read(p1,m1,id);assert.equal(pending.status,'prepared');
        const restarted=createPool(url('lp_executor'));
        try{assert.equal((await finish({...params(0,id),pool:restarted})).hash,pending.tx_hash);}finally{await restarted.end();}
        assert.equal(await programs[0].calls(),before+1n);
        assert.equal((await finish(params(0,id))).hash,pending.tx_hash);assert.equal(await programs[0].calls(),before+1n);
      }
      const base=provider.broadcastTransaction.bind(provider);let lost=false;
      provider.broadcastTransaction=async raw=>{await base(raw);lost=true;throw Error('lost RPC response');};
      try{await finish(params(0,'lost-response'));}finally{provider.broadcastTransaction=base;}
      assert.equal(lost,true);assert.equal(await programs[0].calls(),4n);
    });
    await scenario('Failed durable insert prevents broadcast; unresolved nonce prevents a new operation',async()=>{
      const before=await programs[0].calls();
      await admin.query(`CREATE FUNCTION launchpad.test_reject_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intent save failed'; END $$;
        CREATE TRIGGER test_reject_intent BEFORE INSERT ON launchpad.financial_operations FOR EACH ROW EXECUTE FUNCTION launchpad.test_reject_intent()`);
      try{await assert.rejects(advanceFinancialOperation(params(0,'save-failure')),/intent save failed/);}finally{await admin.query('DROP TRIGGER test_reject_intent ON launchpad.financial_operations; DROP FUNCTION launchpad.test_reject_intent()');}
      assert.equal(await programs[0].calls(),before);assert.equal(await read(p1,m1,'save-failure'),undefined);
      await assert.rejects(advanceFinancialOperation({...params(0,'pending'),hook:async phase=>{if(phase==='prepared')throw Error('stop');}}),/stop/);
      assert.equal((await advanceFinancialOperation(params(0,'other-action'))).reason,'unresolved-operation');
      await finish(params(0,'pending'));
    });
    await scenario('Lost database session releases ownership and resumes only the stored signed transaction',async()=>{
      const id='db-session-loss',before=await programs[0].calls();
      await assert.rejects(advanceFinancialOperation({...params(0,id),hook:async phase=>{
        if(phase==='prepared'){
          const {rows}=await admin.query(`SELECT DISTINCT a.pid FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid
            WHERE a.usename='lp_executor' AND l.locktype='advisory' AND l.granted`);
          assert.equal(rows.length,1);await admin.query('SELECT pg_terminate_backend($1)',[rows[0].pid]);
          await new Promise(r=>setTimeout(r,50));
        }
      }}),/session lost|terminated|closed|Connection/);
      const pending=await read(p1,m1,id);assert.equal(pending.status,'prepared');
      assert.equal(await provider.getTransaction(pending.tx_hash),null);assert.equal(await programs[0].calls(),before);
      assert.equal((await finish(params(0,id))).hash,pending.tx_hash);assert.equal(await programs[0].calls(),before+1n);
    });
    await scenario('Reverted transaction durably blocks its executor without blocking another token',async()=>{
      await assert.rejects(advanceFinancialOperation({...params(0,'will-revert'),hook:async phase=>{if(phase==='prepared')throw Error('stop');}}),/stop/);
      await (await programs[0].setFailure(true)).wait();
      assert.equal((await finish(params(0,'will-revert'))).status,'blocked');
      assert.equal((await read(p1,m1,'will-revert')).status,'reverted');
      assert.equal((await advanceFinancialOperation(params(0,'after-revert'))).reason,'reverted-transaction');
      assert.equal((await finish(params(1,'after-other-revert'))).status,'confirmed');
    });
    await scenario('A confirmed-history reorg stops replay instead of creating a replacement payment',async()=>{
      const snap=await provider.send('evm_snapshot',[]);
      await finish(params(1,'orphan'));const saved=await read(p2,m2,'orphan');
      await provider.send('evm_revert',[snap]);await provider.send('evm_mine',[]);
      await assert.rejects(advanceFinancialOperation(params(1,'orphan')),/reorg/);
      await assert.rejects(advanceFinancialOperation(params(1,'after-reorg')),/reorg/);
      assert.deepEqual(await read(p2,m2,'orphan'),saved);
    });
    report.financial={projects:[p1,p2],fork:meta,scope:'Actual local test ERC20 payouts, ephemeral dedicated signers; no production or full raffle-worker switch'};
  }finally{if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}await pool.end();provider.destroy();}
}
