import {Transaction} from 'ethers';
import {registerServiceGasBudget,serviceGasBudget} from './service-gas-budget.mjs';
import {checkFundingCounters} from '../../src/holders/funding-counters.mjs';
import {inProject} from './store.mjs';
import {address,check,hash,identity,scope,uint} from '../../src/holders/values.mjs';
import {replayHolderProgram} from '../../src/holders/program.mjs';
import {planHolderAllocation} from '../../src/holders/allocation.mjs';
import {checkpointExecution,recheckExecutionBlock,validateExecutionPolicy,validateSignedExecution,observeExecution,observeExternalPayments,executionCall,payoutAbi} from '../../src/holders/execution.mjs';

function decode(row){check(row&&identity(row.body)===row.body_hash,'Missing or corrupt execution record');return row.body;}
async function preparation(c,s){
 const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_preparations WHERE project_id=$1 AND scope_id=$2',[s.projectId,identity(s)]);
 const program=decode(row);check(identity(program.scope)===identity(s),'Execution preparation scope mismatch');
 return {program,state:replayHolderProgram(program)};
}
async function config(c,s,lock=true){
 // Transaction-scoped lock without granting UPDATE on immutable configuration.
 if(lock)await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['holder-execution:'+identity(s)]);
 const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_executions WHERE project_id=$1 AND scope_id=$2',[s.projectId,identity(s)]);
 return validateExecutionPolicy(decode(row),s);
}
async function planRow(c,s,period){
 const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_plans WHERE project_id=$1 AND scope_id=$2 AND period=$3',[s.projectId,identity(s),period]);
 const plan=decode(row);check(plan.scopeId===identity(s)&&plan.period===period,'Execution plan scope mismatch');return plan;
}
function bindPreparation(program,policy){
 check(program.snapshotPolicy&&program.fundingPolicy,'Observed funding and snapshot profiles required');
 check(program.minimumPayment===policy.minimumPayment,'Minimum payment not approved or different');
 check(address(program.fundingPolicy.vault.address)===address(policy.vault)&&program.fundingPolicy.vault.codeHash===policy.codeHash
  &&address(program.fundingPolicy.splitter.address)===address(policy.source),'Execution funding binding mismatch');
}
export async function registerHolderExecution(pool,input,policy,{provider}){
 const s=scope(input);validateExecutionPolicy(policy,s);
 if(policy.gasBudget)await registerServiceGasBudget(pool,policy.gasBudget);
 return inProject(pool,s.projectId,async c=>{
  const {program}=await preparation(c,s);bindPreparation(program,policy);
  const {block}=await checkpointExecution(provider,policy,s);
  await c.query('INSERT INTO launchpad.holder_executions VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[s.projectId,identity(s),JSON.stringify(policy),identity(policy)]);
  check(identity(await config(c,s))===identity(policy),'Execution configuration already fixed');
  await recheckExecutionBlock(provider,block);return {executionEnabled:false,scopeId:identity(s)};
 },{readOnly:false});
}
export async function prepareHolderAllocation(pool,input,{provider,period,budget,now}){
 const s=scope(input);
 return inProject(pool,s.projectId,async c=>{
  const policy=await config(c,s),{program,state}=await preparation(c,s);bindPreparation(program,policy);
  const proof=state.admissions[period];check(proof,'Persist trusted admission before allocation');
  const candidate=state.candidates.find(h=>h.id===proof.candidateId);
  const plan=planHolderAllocation({scope:s,candidate,proof,snapshotPolicy:program.snapshotPolicy,exclusions:program.exclusions,budget,vault:policy.vault,instance:policy.instance});
  const {rows:[old]}=await c.query('SELECT * FROM launchpad.holder_plans WHERE project_id=$1 AND scope_id=$2 AND period=$3',[s.projectId,identity(s),period]);
  if(old){check(identity(decode(old))===identity(plan),'Allocation period already fixed');return {plan,replayed:true};}
  check(Number.isSafeInteger(now)&&now>=proof.checkedAt&&(program.schedulePolicy==='first-accepted-carry-v1'||now<proof.until),'Allocation period expired');
  const {rows:pending}=await c.query("SELECT 1 FROM launchpad.holder_transactions WHERE project_id=$1 AND scope_id=$2 AND status='unknown'",[s.projectId,identity(s)]);
  check(pending.length===0,'Resolve unknown execution before allocation');
  const {vault,block}=await checkpointExecution(provider,policy,s),opts={blockTag:block.number};
  check(await vault.totalReceived(opts)===uint(state.fees.holderDelivered),'Unreconciled holder funding');
  await checkFundingCounters(program,provider,block);
  check(await vault.lastPeriod(opts)===BigInt(period-1)&&await vault.pendingBudget(opts)===0n,'Unexpected allocation period');
  check(uint(budget)<=await vault.available(opts),'Insufficient allocation budget');
  check(await provider.getBalance(policy.vault,block.number)>=await vault.totalReceived(opts)-await vault.totalPaid(opts),'Insolvent execution vault');
  await recheckExecutionBlock(provider,proof.block);await recheckExecutionBlock(provider,block);
  await c.query('INSERT INTO launchpad.holder_plans VALUES($1,$2,$3,$4,$5)',[s.projectId,identity(s),period,JSON.stringify(plan),identity(plan)]);
  return {plan,replayed:false};
 },{readOnly:false});
}

// Persist signed bytes BEFORE any caller broadcasts. There is no signer/sender here.
export async function recordHolderTransaction(pool,input,{provider,period,operation,raw}){
 const s=scope(input);
 return inProject(pool,s.projectId,async c=>{
  const policy=await config(c,s),plan=await planRow(c,s,period);
  const {vault,block,authority}=await checkpointExecution(provider,policy,s),opts={blockTag:block.number};
  // Decode historical sender for idempotent replay; authorize NEW records below.
  const body=validateSignedExecution(raw,policy,s,plan,operation,Transaction.from(raw).from);
  if(policy.gasBudget)await serviceGasBudget(pool,policy.gasBudget).assertReserved(Transaction.from(raw),body.sender);
  const {rows:external}=await c.query('SELECT 1 FROM launchpad.holder_external_payments WHERE project_id=$1 AND scope_id=$2 AND tx_hash=$3',[s.projectId,identity(s),body.txHash]);
  check(external.length===0,'Transaction already imported as external');
  const {rows:[old]}=await c.query('SELECT * FROM launchpad.holder_transactions WHERE project_id=$1 AND scope_id=$2 AND tx_hash=$3',[s.projectId,identity(s),body.txHash]);
  if(old){check(identity(decode(old))===identity(body),'Conflicting transaction');return {txHash:body.txHash,status:old.status,replayed:true};}
  const {rows:pending}=await c.query("SELECT 1 FROM launchpad.holder_transactions WHERE project_id=$1 AND scope_id=$2 AND status='unknown'",[s.projectId,identity(s)]);
  check(pending.length===0,'Resolve unknown transaction before signing another');
  check(body.sender===authority.publisher,'Signed transaction scope/sender mismatch');
  check(body.nonce===await provider.getTransactionCount(body.sender,block.number),'Signed nonce is not next finalized nonce');
  if(['open','append','seal'].includes(operation.kind)){
   const round=await vault.rounds(period,opts);
   if(operation.kind==='open'){
    check(round.commitment==='0x'+'0'.repeat(64)&&await vault.lastPeriod(opts)===BigInt(period-1),'Round already opened/out of order');
    const {program,state}=await preparation(c,s);bindPreparation(program,policy);
    const proof=state.admissions[period];check(proof&&'0x'+identity(proof)===plan.snapshot&&(program.schedulePolicy==='first-accepted-carry-v1'||block.timestamp<proof.until),'Allocation admission expired or changed');
    await recheckExecutionBlock(provider,proof.block);
   }
   else{
    check(round.commitment===plan.commitment&&!round.complete&&round.rolling===plan.checkpoints[Number(round.written)],'Publication prefix mismatch');
    check(operation.kind==='append'?round.written===BigInt(operation.offset):round.written===BigInt(plan.count),'Publication position mismatch');
   }
  }else{
   for(const n of operation.periods){await planRow(c,s,n);check((await vault.rounds(n,opts)).complete,'Claim period incomplete');}
   check((await vault.rounds(period,opts)).complete,'Reference period incomplete');
  }
  // Refusal/insufficient debt is detected before reserving a transaction when possible.
  // State may still change after this simulation; a mined failure remains a receipt.
  await provider.send('eth_call',[{from:body.sender,to:policy.vault,data:executionCall(plan,operation),value:'0x0'},'0x'+block.number.toString(16)]);
  await recheckExecutionBlock(provider,block);
  await c.query('INSERT INTO launchpad.holder_transactions(project_id,scope_id,tx_hash,chain_id,sender,nonce,body,body_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [s.projectId,identity(s),body.txHash,s.chainId,body.sender,body.nonce,JSON.stringify(body),identity(body)]);
  return {txHash:body.txHash,status:'unknown',replayed:false};
 },{readOnly:false});
}
export async function readHolderExecution(pool,input){
 const s=scope(input);
 return inProject(pool,s.projectId,async c=>{
  const policy=await config(c,s,false);
  const {rows:plans}=await c.query('SELECT * FROM launchpad.holder_plans WHERE project_id=$1 AND scope_id=$2 ORDER BY period',[s.projectId,identity(s)]);
  const {rows:transactions}=await c.query('SELECT * FROM launchpad.holder_transactions WHERE project_id=$1 AND scope_id=$2 ORDER BY nonce',[s.projectId,identity(s)]);
  return {policy,plans:plans.map(decode),transactions:transactions.map(r=>({body:decode(r),status:r.status,observation:r.observation})),executionEnabled:false};
 });
}
export async function resolveHolderTransaction(pool,input,{provider,txHash}){
 const s=scope(input);hash(txHash);
 return inProject(pool,s.projectId,async c=>{
  const policy=await config(c,s);
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_transactions WHERE project_id=$1 AND scope_id=$2 AND tx_hash=$3 FOR UPDATE',[s.projectId,identity(s),txHash]);
  const body=decode(row),plan=await planRow(c,s,body.period);
  check(identity(validateSignedExecution(body.raw,policy,s,plan,body.operation,body.sender))===identity(body),'Stored signature mismatch');
  const observation=await observeExecution(provider,policy,s,body);
  if(row.status!=='unknown'){
   check(identity(observation)===identity(row.observation),'Previously finalized execution changed');return {observation,replayed:true};
  }
  if(observation.status==='unknown')return {observation,replayed:false};
  if(body.operation.kind==='seal'&&observation.status==='succeeded')check(observation.allocated===plan.allocated,'Allocated sum differs from plan');
  await recheckExecutionBlock(provider,observation.block);
  if(policy.gasBudget)await serviceGasBudget(pool,policy.gasBudget).settle(body.raw,{hash:body.txHash,status:observation.status==='succeeded'?1:0,blockNumber:observation.block.number,blockHash:observation.block.hash,gasUsed:observation.gas.gasUsed,gasPrice:observation.gas.gasPrice},{...observation.block,timestamp:observation.gas.blockTimestamp});
  await c.query('UPDATE launchpad.holder_transactions SET status=$4,observation=$5 WHERE project_id=$1 AND scope_id=$2 AND tx_hash=$3',[s.projectId,identity(s),txHash,observation.status,JSON.stringify(observation)]);
  return {observation,replayed:false};
 },{readOnly:false});
}

export async function importExternalHolderPayments(pool,input,{provider,txHash}){
 const s=scope(input);hash(txHash);
 return inProject(pool,s.projectId,async c=>{
  const policy=await config(c,s);
  const {rows:owned}=await c.query('SELECT 1 FROM launchpad.holder_transactions WHERE project_id=$1 AND scope_id=$2 AND tx_hash=$3',[s.projectId,identity(s),txHash]);
  check(owned.length===0,'Use tracked transaction resolver');
  const observed=await observeExternalPayments(provider,policy,s,txHash);
  const {rows:[old]}=await c.query('SELECT * FROM launchpad.holder_external_payments WHERE project_id=$1 AND scope_id=$2 AND tx_hash=$3',[s.projectId,identity(s),txHash]);
  if(old){check(identity(decode(old))===identity(observed),'External payment evidence changed');return {observation:observed,replayed:true};}
  await recheckExecutionBlock(provider,observed.block);
  await c.query('INSERT INTO launchpad.holder_external_payments VALUES($1,$2,$3,$4,$5)',[s.projectId,identity(s),txHash,JSON.stringify(observed),identity(observed)]);
  return {observation:observed,replayed:false};
 },{readOnly:false});
}

// Read-only incident view. Does not imply possession of the publisher key and
// deliberately offers no address substitution, rescue or hidden signing path.
export async function inspectHolderRecovery(pool,input,{provider,maxPlans=100}){
 const s=scope(input);check(Number.isSafeInteger(maxPlans)&&maxPlans>0&&maxPlans<=2000,'Invalid recovery budget');
 return inProject(pool,s.projectId,async c=>{
  const policy=await config(c,s,false),{vault,block,authority}=await checkpointExecution(provider,policy,s),opts={blockTag:block.number};
  const {rows:plans}=await c.query('SELECT * FROM launchpad.holder_plans WHERE project_id=$1 AND scope_id=$2 ORDER BY period LIMIT $3',[s.projectId,identity(s),maxPlans+1]);
  check(plans.length<=maxPlans,'Recovery plan budget exceeded');
  const publications=[];
  for(const row of plans){
   const plan=decode(row),round=await vault.rounds(plan.period,opts);
   if(round.commitment==='0x'+'0'.repeat(64)){publications.push({period:plan.period,status:'not-opened',offset:0});continue;}
   check(round.commitment===plan.commitment&&round.rolling===plan.checkpoints[Number(round.written)],'Recovery publication mismatch');
   publications.push({period:plan.period,status:round.complete?'complete':'resume-same-plan',offset:Number(round.written)});
  }
  const {rows:pending}=await c.query("SELECT * FROM launchpad.holder_transactions WHERE project_id=$1 AND scope_id=$2 AND status='unknown'",[s.projectId,identity(s)]);
  await recheckExecutionBlock(provider,block);
  return {checkpoint:{number:block.number,hash:block.hash},...authority,
   lostPublisherKey:authority.rotationSupported?'owner-can-pause-and-replace':'new-publications-blocked',completedClaims:'permissionless-to-original-beneficiary',
   pendingTransactions:pending.map(r=>({txHash:decode(r).txHash,recovery:'resolve-or-rebroadcast-identical-bytes'})),publications,executionEnabled:false};
 });
}

// Bounded on-demand scan of THIS vault's Paid logs, never purchase/block polling.
// Imports may commit before the cursor: retry then deduplicates them safely.
export async function scanHolderPayments(pool,input,{provider,maxBlocks=500,maxReceipts=50}={}){
 const s=scope(input),sid=identity(s);
 check(Number.isSafeInteger(maxBlocks)&&maxBlocks>0&&maxBlocks<=2000&&Number.isSafeInteger(maxReceipts)&&maxReceipts>0&&maxReceipts<=100,'Invalid payment scan budget');
 const saved=await inProject(pool,s.projectId,async c=>{
  const policy=await config(c,s),{program}=await preparation(c,s);bindPreparation(program,policy);
  const initial={fromBlock:program.fundingPolicy.fromBlock,nextBlock:program.fundingPolicy.fromBlock,checkpoint:null};
  await c.query('INSERT INTO launchpad.holder_payment_scans VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[s.projectId,sid,JSON.stringify(initial),identity(initial)]);
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_payment_scans WHERE project_id=$1 AND scope_id=$2',[s.projectId,sid]);
  return {policy,cursor:decode(row)};
 },{readOnly:false});
 if(saved.cursor.checkpoint)await recheckExecutionBlock(provider,saved.cursor.checkpoint);
 const {block:head}=await checkpointExecution(provider,saved.policy,s);
 if(saved.cursor.nextBlock>head.number)return {status:'caught-up',cursor:saved.cursor,receipts:0};
 const fromBlock=saved.cursor.nextBlock,toBlock=Math.min(head.number,fromBlock+maxBlocks-1),end=await provider.getBlock(toBlock);
 check(end,'Payment scan end unavailable');
 const logs=await provider.getLogs({address:saved.policy.vault,topics:[payoutAbi.getEvent('Paid').topicHash],fromBlock,toBlock});
 check(logs.length<=1000,'Payment scan log budget exceeded');
 for(const log of logs)check(!log.removed&&address(log.address)===address(saved.policy.vault)&&log.blockNumber>=fromBlock&&log.blockNumber<=toBlock&&log.topics[0]===payoutAbi.getEvent('Paid').topicHash,'Payment scan returned unrelated log');
 const hashes=[...new Set(logs.map(l=>hash(l.transactionHash)))];check(hashes.length<=maxReceipts,'Payment scan receipt budget exceeded');
 for(const txHash of hashes){
  const owned=await inProject(pool,s.projectId,async c=>(await c.query('SELECT 1 FROM launchpad.holder_transactions WHERE project_id=$1 AND scope_id=$2 AND tx_hash=$3',[s.projectId,sid,txHash])).rowCount>0);
  if(owned)await resolveHolderTransaction(pool,s,{provider,txHash});else await importExternalHolderPayments(pool,s,{provider,txHash});
 }
 const next={...saved.cursor,nextBlock:toBlock+1,checkpoint:{number:end.number,hash:end.hash}};
 await inProject(pool,s.projectId,async c=>{
  await config(c,s);
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_payment_scans WHERE project_id=$1 AND scope_id=$2',[s.projectId,sid]);
  check(identity(decode(row))===identity(saved.cursor),'Payment scan cursor changed; retry');
  if(saved.cursor.checkpoint)await recheckExecutionBlock(provider,saved.cursor.checkpoint);
  await recheckExecutionBlock(provider,end);
  await c.query('UPDATE launchpad.holder_payment_scans SET body=$3,body_hash=$4 WHERE project_id=$1 AND scope_id=$2',[s.projectId,sid,JSON.stringify(next),identity(next)]);
 },{readOnly:false});
 return {status:toBlock===head.number?'caught-up':'more',cursor:next,receipts:hashes.length,range:{fromBlock,toBlock}};
}

// Compatibility entry point starts a fresh bounded pass. Use resumeHolderReconciliation
// to continue a progress result across requests/processes.
export async function reconcileHolderExecution(pool,input,{provider,maxTransactions=200}){
 return resumeHolderReconciliation(pool,input,{provider,maxItems:maxTransactions,restart:true});
}

// A page budget bounds RPC work, not the lifetime of the journal. A stable DB
// fingerprint and finalized checkpoint bind every page; changed input requires
// an explicit restart. Failed pages roll back without advancing the cursor.
export async function resumeHolderReconciliation(pool,input,{provider,maxItems=50,restart=false,reuseCompleted=false}={}){
 const s=scope(input),key=[s.projectId,identity(s)];
 check(Number.isSafeInteger(maxItems)&&maxItems>0&&maxItems<=2000,'Invalid reconciliation page budget');
 check(typeof restart==='boolean'&&typeof reuseCompleted==='boolean','Invalid reconciliation restart/reuse');
 return inProject(pool,s.projectId,async c=>{
  const policy=await config(c,s),{state}=await preparation(c,s);
  const fingerprint=async()=>{
   const parts=[];
   for(const table of ['holder_transactions','holder_external_payments','holder_plans','holder_preparations']){
    const {rows:[r]}=await c.query(`SELECT count(*)::text AS count, md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS hash FROM launchpad.${table} t WHERE project_id=$1 AND scope_id=$2`,key);parts.push(r);
   }
   return identity({policy,parts});
  };
  const stamp=await fingerprint();
  const {rows:[saved]}=await c.query('SELECT * FROM launchpad.holder_reconciliation WHERE project_id=$1 AND scope_id=$2',key);
  let run=saved?decode(saved):null;
  if(!run||restart||run.status==='reconciled'&&(!reuseCompleted||run.fingerprint!==stamp)){
   const {block}=await checkpointExecution(provider,policy,s);
   run={schema:'holder-reconciliation-v1',status:'progress',fingerprint:stamp,checkpoint:{number:block.number,hash:block.hash},phase:0,offset:0,processed:0,paid:'0',allocated:'0',pending:'0',lastPeriod:0,publications:{}};
  }else if(run.status==='reconciled'&&reuseCompleted){
   // Recheck the old canonical boundary before reusing verified history; compare
   // totals again at today's finalized checkpoint so unimported activity fails.
   await recheckExecutionBlock(provider,run.checkpoint);
   const {block}=await checkpointExecution(provider,policy,s);run.checkpoint={number:block.number,hash:block.hash};
  }
  check(run.fingerprint===stamp,'Reconciliation input changed; restart required');
  const {vault,block}=await checkpointExecution(provider,policy,s,run.checkpoint.number),opts={blockTag:block.number};
  check(block.hash===run.checkpoint.hash,'Reconciliation checkpoint reorg');
  let remaining=maxItems;
  const tables=['holder_transactions','holder_external_payments','holder_plans'];
  const order=["(observation->'block'->>'number')::bigint, (observation->>'transactionIndex')::integer, nonce, tx_hash",'tx_hash','period'];
  while(remaining>0&&run.phase<3){
   const {rows}=await c.query(`SELECT * FROM launchpad.${tables[run.phase]} WHERE project_id=$1 AND scope_id=$2 ORDER BY ${order[run.phase]} LIMIT $3 OFFSET $4`,[...key,remaining,run.offset]);
   for(const row of rows){
    if(run.phase===0){
     check(row.status!=='unknown','Unresolved execution transaction');
     const body=decode(row),plan=await planRow(c,s,body.period);
     check(identity(validateSignedExecution(body.raw,policy,s,plan,body.operation,body.sender))===identity(body),'Stored signature mismatch');
     const observed=await observeExecution(provider,policy,s,body);
     check(identity(observed)===identity(row.observation)&&observed.block.number<=block.number,'Execution evidence changed');
     run.paid=String(uint(run.paid)+uint(observed.paid));run.allocated=String(uint(run.allocated)+uint(observed.allocated));
     if(observed.status==='succeeded'&&['open','append','seal'].includes(body.operation.kind)){
      const p=run.publications[body.period]??{opened:false,written:0,complete:false};
      if(body.operation.kind==='open'){check(!p.opened,'Duplicate publication evidence');p.opened=true;}
      else if(body.operation.kind==='append'){check(p.opened&&!p.complete&&p.written===body.operation.offset,'Missing publication prefix evidence');p.written+=body.operation.count;}
      else{check(p.opened&&!p.complete&&p.written===plan.count,'Missing publication seal evidence');p.complete=true;}
      run.publications[body.period]=p;
     }
    }else if(run.phase===1){
     const known=await c.query('SELECT 1 FROM launchpad.holder_transactions WHERE project_id=$1 AND scope_id=$2 AND tx_hash=$3',[...key,row.tx_hash]);
     check(!known.rowCount,'Payment evidence counted twice');
     const observed=await observeExternalPayments(provider,policy,s,row.tx_hash);
     check(identity(decode(row))===identity(observed)&&observed.block.number<=block.number,'External payment evidence changed');run.paid=String(uint(run.paid)+uint(observed.paid));
    }else{
     const plan=decode(row),p=run.publications[plan.period],round=await vault.rounds(plan.period,opts);
     check(plan.scopeId===key[1]&&plan.period===row.period,'Execution plan scope mismatch');
     if(!p)check(round.commitment==='0x'+'0'.repeat(64),'Unjournaled publication');
     else{
      check(round.commitment===plan.commitment&&round.written===BigInt(p.written)&&round.complete===p.complete&&round.rolling===plan.checkpoints[p.written],'Publication state differs from journal');
      if(p.complete)run.lastPeriod=Math.max(run.lastPeriod,plan.period);else run.pending=String(uint(run.pending)+uint(plan.budget));
     }
    }
   }
   const exhausted=rows.length<remaining;remaining-=rows.length;run.processed+=rows.length;run.offset+=rows.length;
   if(exhausted){run.phase++;run.offset=0;}
  }
  if(run.phase===3){
   const received=await vault.totalReceived(opts),pending=await vault.pendingBudget(opts),available=await vault.available(opts),allocated=uint(run.allocated),paid=uint(run.paid);
   check(pending===uint(run.pending)&&await vault.lastPeriod(opts)===BigInt(run.lastPeriod),'Unjournaled period state');
   check(received===uint(state.fees.holderDelivered),'Missing funding evidence');
   check(await vault.totalAllocated(opts)===allocated&&await vault.totalPaid(opts)===paid,'Missing allocation or payout evidence');
   check(received===available+pending+allocated&&paid<=allocated&&await provider.getBalance(policy.vault,block.number)>=received-paid,'Execution conservation/solvency mismatch');
   run.status='reconciled';run.result={status:'reconciled',checkpoint:run.checkpoint,received:String(received),allocated:run.allocated,paid:run.paid,owed:String(allocated-paid),available:String(available),pending:String(pending),executionEnabled:false};
  }
  await recheckExecutionBlock(provider,block);check(await fingerprint()===stamp,'Reconciliation input changed during page');
  await c.query('INSERT INTO launchpad.holder_reconciliation VALUES($1,$2,$3,$4) ON CONFLICT(project_id,scope_id) DO UPDATE SET body=EXCLUDED.body,body_hash=EXCLUDED.body_hash',[...key,JSON.stringify(run),identity(run)]);
  return run.result??{status:'progress',checkpoint:run.checkpoint,processed:run.processed,phase:tables[run.phase]??'final-check',executionEnabled:false};
 },{readOnly:false});
}
