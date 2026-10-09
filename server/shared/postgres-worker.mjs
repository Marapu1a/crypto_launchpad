import { Contract } from 'ethers';
import { ABI,runLocalWorker,verifyConfig } from '../../src/worker/local-worker.mjs';
import { digest } from '../../src/tickets/digest.mjs';
import { inProject,verifyRole } from './store.mjs';
import { sourceFor,canonical } from './ticket-shadow.mjs';
import { ingestNext } from './chain-read.mjs';
import { registerTicketLedger,applyTicketLedger,readTicketLedger,freezeLedgerSnapshot } from './ticket-ledger.mjs';
import { registerFinancialExecutor,advanceFinancialOperation } from './financial-journal.mjs';

const check=(ok,message)=>{if(!ok)throw Error(message);};
export function workerFinancialConfig(config){
  return {schema:'local-short-financial-journal-v1',chainId:'31337',localInstance:config.profile.localInstance,
    executor:config.executor,program:config.addresses.program,programCodeHash:config.codeHashes.program,
    anchor:config.profile.anchor,limits:config.limits,workerConfig:config};
}
// Explicit setup for a NEW local instance; never infer adoption of a running program.
export async function registerPostgresWorker({executorPool,jobsPool,provider,projectId,moduleId,sourceId,config}){
  await verifyRole(executorPool,'lp_executor');await verifyRole(jobsPool,'lp_jobs');
  await verifyConfig(provider,config);
  const program=new Contract(config.addresses.program,ABI.program,provider);
  check(await program.cycle()===0n&&!await program.pending(),'Cannot adopt active worker');
  const financial=await inProject(executorPool,projectId,async c=>(await c.query('SELECT config_hash FROM launchpad.financial_executors WHERE project_id=$1 AND module_id=$2',[projectId,moduleId])).rows[0]);
  if(financial)check(financial.config_hash===digest(workerFinancialConfig(config)),'Existing executor config mismatch');
  else await registerFinancialExecutor(executorPool,provider,projectId,moduleId,workerFinancialConfig(config));
  const ledger=await inProject(jobsPool,projectId,async c=>(await c.query('SELECT source_id,profile_hash FROM launchpad.ticket_ledgers WHERE project_id=$1 AND module_id=$2',[projectId,moduleId])).rows[0]);
  if(ledger)check(ledger.source_id===sourceId&&ledger.profile_hash===digest(config.profile),'Existing ledger config mismatch');
  else await registerTicketLedger(jobsPool,provider,projectId,moduleId,sourceId,config.profile);
}

export async function readPostgresWorker(pool,p,m){
  return inProject(pool,p,async c=>{
    const {rows:[r]}=await c.query('SELECT * FROM launchpad.worker_states WHERE project_id=$1 AND module_id=$2',[p,m]);
    if(!r)return null;const state=JSON.parse(r.state_text);check(digest(state)===r.state_hash,'Worker DB checksum mismatch');return state;
  });
}

export async function runPostgresWorker({executorPool,jobsPool,ingestPool,provider,signer,projectId:p,moduleId:m,sourceId,config,bundleDirectory,getBeacon,hook=async()=>{}}){
  await verifyRole(executorPool,'lp_executor');await verifyRole(jobsPool,'lp_jobs');await verifyRole(ingestPool,'lp_ingest');
  const program=new Contract(config.addresses.program,ABI.program,provider);
  let session,broken=false;
  const guard=async()=>{
    check(session&&!broken,'Worker DB session lost');await session.query('SELECT 1');
    await inProject(jobsPool,p,async c=>{
      const {rows:[ledger]}=await c.query('SELECT source_id,profile_hash FROM launchpad.ticket_ledgers WHERE project_id=$1 AND module_id=$2',[p,m]);
      check(ledger?.source_id===sourceId&&ledger.profile_hash===digest(config.profile),'Worker ledger binding mismatch');
      const source=await sourceFor(c,sourceId);await canonical(provider,Number(source.head_number),source.head_hash);
    });
  };
  const backend={
    async exclusive(work){
      session=await executorPool.connect();const onError=()=>{broken=true;};session.on('error',onError);
      const key='worker:'+p.toLowerCase()+':'+m.toLowerCase();let held=false;
      try{
        await session.query("SELECT set_config('launchpad.project_id',$1,false)",[p]);
        held=(await session.query('SELECT pg_try_advisory_lock(hashtextextended($1,49175)) AS held',[key])).rows[0].held;
        if(!held)return {status:'busy'};
        return await work();
      }finally{
        try{if(held)await session.query('SELECT pg_advisory_unlock(hashtextextended($1,49175))',[key]);await session.query('RESET launchpad.project_id');}catch{broken=true;}
        session.removeListener('error',onError);session.release(broken);session=null;
      }
    },
    async load(){
      const {rows:[financial]}=await session.query('SELECT config_hash FROM launchpad.financial_executors WHERE project_id=$1 AND module_id=$2',[p,m]);
      check(financial?.config_hash===digest(workerFinancialConfig(config)),'Worker financial config mismatch');
      const {rows:[row]}=await session.query('SELECT * FROM launchpad.worker_states WHERE project_id=$1 AND module_id=$2',[p,m]);
      if(!row){
        check(!(await session.query('SELECT 1 FROM launchpad.financial_operations WHERE project_id=$1 AND module_id=$2 LIMIT 1',[p,m])).rowCount,'Missing worker state with financial history');
        return null;
      }
      const state=JSON.parse(row.state_text);
      check(row.config_hash===digest(config)&&state.identity===row.config_hash&&digest(state)===row.state_hash,'Worker DB checksum/config mismatch');return state;
    },
    async save(state){
      check(!broken&&state.identity===digest(config),'Worker DB session/config lost');
      const {rowCount}=await session.query(`INSERT INTO launchpad.worker_states VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(project_id,module_id) DO UPDATE SET state_text=EXCLUDED.state_text,state_hash=EXCLUDED.state_hash
        WHERE launchpad.worker_states.config_hash=EXCLUDED.config_hash`,[p,m,digest(config),JSON.stringify(state),digest(state)]);
      check(rowCount===1,'Worker state save lost');
    },
    guard,
    async index(tip){
      // Bounded catch-up of the shared reader; other projects reuse these receipts.
      const source=(await ingestPool.query('SELECT head_number FROM launchpad.chain_sources WHERE id=$1',[sourceId])).rows[0];
      check(source,'Worker source missing');
      const end=Math.min(tip,Number(source.head_number)+500);
      for(let n=Number(source.head_number);n<end;n++)check((await ingestNext(ingestPool,provider,sourceId,end)).status!=='HALTED_REORG','Worker source reorg');
      const ledger=await readTicketLedger(jobsPool,p,m);check(ledger,'Worker ledger missing');
      const cutoff=Math.min(end,ledger.head.number+500);
      await applyTicketLedger(jobsPool,provider,p,m,cutoff,{bundleDirectory});
      return {...await readTicketLedger(jobsPool,p,m),snapshots:{}};
    },
    async freeze(state,label,cycle,cutoff){
      if(!state.snapshotIntent){
        const block=await provider.getBlock('latest'),tag={blockTag:block.number};
        check(!await program.pending(tag)&&String(await program.cycle(tag)+1n)===cycle,'Snapshot cycle changed');
        const ledger=await readTicketLedger(jobsPool,p,m),consumed={};
        for(const wallet of Object.keys(ledger.wallets))consumed[wallet]=String(await program.consumedThrough(wallet,tag));
        await canonical(provider,block.number,block.hash);
        state.snapshotIntent={label,cycle,cutoff,consumed,anchor:{number:block.number,hash:block.hash}};
        await backend.save(state);await hook('snapshot-planned',state.snapshotIntent);
      }
      const intent=state.snapshotIntent;
      check(intent.label===label&&intent.cycle===cycle,'Snapshot intent changed');
      await canonical(provider,intent.anchor.number,intent.anchor.hash);
      check(!await program.pending()&&String(await program.cycle()+1n)===cycle,'Snapshot cycle changed');
      for(const [wallet,used] of Object.entries(intent.consumed))check(String(await program.consumedThrough(wallet))===used,'Snapshot consumption changed');
      const base=await freezeLedgerSnapshot(jobsPool,provider,p,m,label,intent.cutoff,intent.consumed);
      const {snapshotHash:ignored,...body}=base,payload={...body,program:config.addresses.program,cycle};
      const snapshot={...payload,snapshotHash:digest(payload)};
      await hook('snapshot-saved',snapshot);
      delete state.snapshotIntent;return snapshot;
    },
    async recoverSnapshot(state,label,cycle){return state.snapshotIntent?backend.freeze(state,label,cycle,state.snapshotIntent.cutoff):null;},
    async rememberRng(state,cycle,request,save){
      state.rng??={};
      if(state.rng[cycle])check(digest(state.rng[cycle])===digest(request),'Persisted RNG request changed');
      else{state.rng[cycle]=request;await save();await hook('rng-saved',request);}
    },
    async transact({state,save,request,action,guard:workerGuard}){
      if(!state.operation){
        check(request&&action,'Missing worker action');
        state.operation={id:'step-'+String(state.nextOperation??1),request:{to:request.to,data:request.data,value:'0'},action};
        await save();await hook('operation-planned',state.operation);
      }
      const operation=state.operation;
      const result=await advanceFinancialOperation({pool:executorPool,provider,signer,projectId:p,moduleId:m,operationId:operation.id,
        request:operation.request,action:operation.action,hook,additionalGuard:workerGuard});
      if(result.status==='confirmed'||(result.status==='blocked'&&result.receiptStatus===0)){
        const receipt={action:result.action,hash:result.hash,nonce:result.nonce,blockNumber:result.blockNumber,blockHash:result.blockHash,status:result.receiptStatus};
        check(!state.history.some(r=>r.hash===receipt.hash),'Worker operation already linked');
        state.history.push(receipt);if(receipt.status===0)state.failure=receipt;
        delete state.operation;state.nextOperation=(state.nextOperation??1)+1;await save();await hook('worker-confirmed',receipt);
      }
      return result;
    },
  };
  return runLocalWorker({provider,signer,config,bundleDirectory,getBeacon,hook,backend});
}
