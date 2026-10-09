import { keccak256,isAddress,Transaction,Interface } from 'ethers';
import { ABI,verifyConfig } from '../../src/worker/local-worker.mjs';
import { assertLocalFork } from '../../src/pons/local-execution.mjs';
import { advanceTransaction } from '../../src/worker/journal.mjs';
import { digest } from '../../src/tickets/digest.mjs';
import { inProject,verifyRole } from './store.mjs';

const check=(value,message)=>{if(!value)throw Error(message);};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const parse=(text,hash)=>{const value=JSON.parse(text);check(digest(value)===hash,'Financial journal checksum mismatch');return value;};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function verify(provider,config){
  check(['local-financial-journal-v1','local-short-financial-journal-v1'].includes(config.schema)&&config.chainId==='31337','Only local financial journal supported');
  const meta=await assertLocalFork(provider);check(meta.instanceId===config.localInstance,'Financial fork instance changed');
  check(isAddress(config.executor)&&isAddress(config.program),'Invalid financial addresses');
  check(Number.isSafeInteger(config.anchor?.number)&&config.anchor.number>=0,'Invalid financial anchor');
  check((await provider.getBlock(config.anchor.number))?.hash===config.anchor.hash,'Financial anchor changed');
  const code=await provider.getCode(config.program);check(code!=='0x'&&keccak256(code)===config.programCodeHash,'Financial runtime changed');
  if(config.schema==='local-short-financial-journal-v1'){
    const w=config.workerConfig;await verifyConfig(provider,w);
    check(same(config.program,w.addresses.program)&&same(config.executor,w.executor)&&config.localInstance===w.profile.localInstance
      &&digest(config.anchor)===digest(w.profile.anchor)&&digest(config.limits)===digest(w.limits),'Financial worker config mismatch');
  }else check(Array.isArray(config.selectors)&&config.selectors.length>0&&config.selectors.every(s=>/^0x[0-9a-f]{8}$/.test(s)),'Invalid financial allowlist');
  for(const key of ['maxGasPrice','maxGasLimit','nativeFloor'])check(typeof config.limits?.[key]==='string'&&/^[1-9]\d*$/.test(config.limits[key]),'Invalid financial limits');
}
async function binding(c,p,m,config){
  const {rows:[row]}=await c.query(`SELECT p.chain_id,m.program_address FROM launchpad.projects p JOIN launchpad.module_instances m ON m.project_id=p.id WHERE p.id=$1 AND m.id=$2`,[p,m]);
  check(row&&row.chain_id===config.chainId&&same(row.program_address,config.program),'Financial project/module mismatch');
}
function planned(config,request,action){
  check(request&&typeof action==='string'&&action.length>0&&action.length<=100,'Financial request/action required');
  check(typeof request.data==='string'&&/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(request.data)&&BigInt(request.value??0)===0n,'Financial call not allowed');
  if(config.schema==='local-short-financial-journal-v1'){
    const allowed={program:['freeze','settle','claim'],collector:['collect','forward','sweepCurve'],splitter:['deliver'],adapter:['prove','deliver']};
    const [kind,method,...extra]=action.split('.');
    check(!extra.length&&allowed[kind]?.includes(method)&&same(request.to,config.workerConfig.addresses[kind]),'Financial worker call not allowed');
    const abi=new Interface(ABI[kind]),decoded=abi.parseTransaction({data:request.data});
    check(decoded?.name===method&&same(abi.encodeFunctionData(method,decoded.args),request.data),'Noncanonical worker calldata');
  }else check(same(request.to,config.program)&&config.selectors.includes(request.data.slice(0,10).toLowerCase()),'Financial call not allowed');
  return {action,to:request.to.toLowerCase(),data:request.data.toLowerCase(),value:'0'};
}
export async function registerFinancialExecutor(pool,provider,p,m,config){
  await verifyRole(pool,'lp_executor');await verify(provider,config);
  return inProject(pool,p,async c=>{
    await binding(c,p,m,config);
    await c.query('INSERT INTO launchpad.financial_executors VALUES($1,$2,$3,$4,$5,$6)',[p,m,config.localInstance,config.executor.toLowerCase(),JSON.stringify(config),digest(config)]);
  },{readOnly:false});
}

// Trusted internal transport, not a public transaction endpoint or a financial planner.
// An operation ID identifies ONE business action forever; retries must keep its payload.
export async function advanceFinancialOperation({pool,provider,signer,projectId:p,moduleId:m,operationId,request,action,hook,additionalGuard}){
  check(uuid.test(p)&&uuid.test(m)&&/^[A-Za-z0-9_-]{1,100}$/.test(operationId),'Invalid financial identity');
  await verifyRole(pool,'lp_executor');
  const c=await pool.connect();let held=false,broken=false;
  const sessionError=()=>{broken=true;};c.on('error',sessionError);
  // The session lock spans several committed writes and the broadcast, unlike an
  // xact lock that would disappear when the signed intent is durably committed.
  const lockKey='financial:'+p.toLowerCase()+':'+m.toLowerCase();
  try{
    await c.query("SELECT set_config('launchpad.project_id',$1,false)",[p]);
    held=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,49174)) AS held',[lockKey])).rows[0].held;
    if(!held)return {status:'busy'};
    const {rows:[executor]}=await c.query('SELECT * FROM launchpad.financial_executors WHERE project_id=$1 AND module_id=$2',[p,m]);
    check(executor,'Financial executor missing');const config=parse(executor.config_text,executor.config_hash);
    check(same(await signer.getAddress(),config.executor)&&signer.provider===provider,'Wrong financial signer');
    check(executor.local_instance===config.localInstance&&same(executor.sender,config.executor),'Financial executor identity mismatch');
    await binding(c,p,m,config);
    const guard=async()=>{
      // A dead DB session must never continue to sign/broadcast a new operation.
      check(!broken,'Financial database session lost');
      await c.query('SELECT 1');await verify(provider,config);
      const {rows:[last]}=await c.query(`SELECT result_text,result_hash FROM launchpad.financial_operations
        WHERE project_id=$1 AND module_id=$2 AND status<>'prepared' ORDER BY nonce DESC LIMIT 1`,[p,m]);
      if(last){const r=parse(last.result_text,last.result_hash);check((await provider.getBlock(r.blockNumber))?.hash===r.blockHash,'Financial confirmed history reorg');}
      if(additionalGuard)await additionalGuard();
    };
    await guard();
    const {rows:[existing]}=await c.query('SELECT * FROM launchpad.financial_operations WHERE project_id=$1 AND module_id=$2 AND operation_id=$3',[p,m,operationId]);
    let plan=existing?parse(existing.request_text,existing.request_hash):planned(config,request,action);
    // Revalidate the persisted allowlist and compare any supplied retry payload.
    check(digest(planned(config,plan,plan.action))===digest(plan),'Stored financial plan invalid');
    if(request)check(digest(planned(config,request,action))===digest(plan),'Financial operation payload changed');
    if(action!==undefined)check(action===plan.action,'Financial operation action changed');
    if(existing&&existing.status!=='prepared'){
      const r=parse(existing.result_text,existing.result_hash);
      check((await provider.getBlock(r.blockNumber))?.hash===r.blockHash,'Financial operation reorg');
      return {...r,receiptStatus:r.status,status:r.status===1?'confirmed':'blocked'};
    }
    const {rows:[blocked]}=await c.query("SELECT operation_id,status FROM launchpad.financial_operations WHERE project_id=$1 AND module_id=$2 AND (status='reverted' OR (status='prepared' AND operation_id<>$3)) ORDER BY nonce LIMIT 1",[p,m,operationId]);
    if(blocked)return {status:'blocked',reason:blocked.status==='reverted'?'reverted-transaction':'unresolved-operation',operationId:blocked.operation_id};
    const state={history:[]};
    if(existing){
      state.pending=parse(existing.intent_text,existing.intent_hash);
      check(state.pending.hash===existing.tx_hash&&String(state.pending.nonce)===existing.nonce,'Financial intent row mismatch');
      check(same(state.pending.to,plan.to)&&same(state.pending.data,plan.data)&&state.pending.action===plan.action,'Financial intent plan mismatch');
    }
    const save=async()=>{
      if(state.pending){
        const pending=state.pending,signed=Transaction.from(pending.raw);
        check(signed.gasLimit<=BigInt(config.limits.maxGasLimit)&&signed.gasPrice<=BigInt(config.limits.maxGasPrice),'Financial signed gas limits');
        await c.query(`INSERT INTO launchpad.financial_operations VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'prepared',NULL,NULL)`,
          [p,m,operationId,JSON.stringify(plan),digest(plan),JSON.stringify(pending),digest(pending),pending.hash,pending.nonce]);
      }else{
        const result=state.history.at(-1);check(result,'Missing financial result');
        const {rowCount}=await c.query(`UPDATE launchpad.financial_operations SET status=$4,result_text=$5,result_hash=$6
          WHERE project_id=$1 AND module_id=$2 AND operation_id=$3 AND status='prepared' AND tx_hash=$7`,
          [p,m,operationId,result.status===1?'confirmed':'reverted',JSON.stringify(result),digest(result),result.hash]);
        check(rowCount===1,'Financial result transition lost');
      }
    };
    return await advanceTransaction({provider,signer,state,save,request:{to:plan.to,data:plan.data,value:0},action:plan.action,limits:config.limits,guard,hook});
  }finally{
    try{
      if(held)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,49174))',[lockKey]);
      await c.query("RESET launchpad.project_id");
    }catch{broken=true;}
    c.removeListener('error',sessionError);c.release(broken);
  }
}
