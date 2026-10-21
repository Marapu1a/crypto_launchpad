import {Transaction} from 'ethers';
import {inProject} from './store.mjs';
import {identity as digest} from '../../src/holders/values.mjs';
import {validateServiceGasBudget,gasIntent,gasPeriod} from '../../src/worker/service-gas-budget.mjs';
const check=(v,m)=>{if(!v)throw Error(m);};
export async function registerServiceGasBudget(pool,policy){
 validateServiceGasBudget(policy);
 return inProject(pool,policy.projectId,async c=>{
  await c.query('INSERT INTO launchpad.service_gas_budgets(project_id,body,body_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[policy.projectId,JSON.stringify(policy),digest(policy)]);
  const {rows:[r]}=await c.query('SELECT body,body_hash FROM launchpad.service_gas_budgets WHERE project_id=$1',[policy.projectId]);
  check(r?.body_hash===digest(policy)&&digest(r.body)===r.body_hash,'Gas budget already fixed');
 },{readOnly:false});
}

// The DB clock is authoritative. The optional clock exists only for isolated tests;
// runtime constructors never accept time from a command payload or a quote.
export function serviceGasBudget(pool,policy,{clock}={}){
 validateServiceGasBudget(policy);const id=policy.projectId;
 const work=fn=>inProject(pool,id,async c=>{
  const {rows:[r]}=await c.query('SELECT * FROM launchpad.service_gas_budgets WHERE project_id=$1 FOR UPDATE',[id]);
  check(r&&digest(r.body)===r.body_hash&&r.body_hash===digest(policy),'Missing or changed gas budget');
  const at=clock?clock():Number((await c.query('SELECT floor(extract(epoch FROM clock_timestamp()))::bigint AS at')).rows[0].at);
  check(Number.isSafeInteger(at)&&at>=Number(r.last_at),'Gas budget clock regressed');
  const period=gasPeriod(policy,at);
  await c.query('UPDATE launchpad.service_gas_budgets SET last_at=$2 WHERE project_id=$1',[id,at]);
  return fn(c,{at,period,notice:r.notice});
 },{readOnly:false});
 const totals=async(c,period)=>{
  const {rows:[r]}=await c.query('SELECT COALESCE(sum(maximum) FILTER(WHERE actual IS NULL),0)::text AS reserved,COALESCE(sum(actual) FILTER(WHERE settled_period=$2),0)::text AS spent FROM launchpad.service_gas_reservations WHERE project_id=$1 AND (actual IS NULL OR settled_period=$2)',[id,period]);
  const available=BigInt(policy.limitWei)-BigInt(r.reserved)-BigInt(r.spent);
  return {period,limitWei:policy.limitWei,reservedWei:r.reserved,spentWei:r.spent,availableWei:String(available>0n?available:0n),retryAt:(policy.launchAt+(period+1)*policy.periodSeconds)*1000};
 };
 const lookup=async(c,request,sender)=>{
  const item=gasIntent(request,sender);check(policy.senders.includes(item.intent.sender),'Unapproved gas budget sender');
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.service_gas_reservations WHERE project_id=$1 AND sender=$2 AND nonce=$3',[id,item.intent.sender,item.intent.nonce]);
  if(row)check(row.intent_hash===item.hash&&digest(row.intent)===row.intent_hash&&row.maximum===item.maximum,'Changed reserved gas intent');
  return {item,row};
 };
 return {
  prepared:(sender,nonce)=>work(async c=>{
   sender=sender.toLowerCase();check(policy.senders.includes(sender)&&Number.isSafeInteger(nonce)&&nonce>=0,'Invalid reservation lookup');
   const {rows:[row]}=await c.query('SELECT * FROM launchpad.service_gas_reservations WHERE project_id=$1 AND sender=$2 AND nonce=$3',[id,sender,nonce]);
   if(!row)return null;
   check(digest(row.intent)===row.intent_hash&&row.actual===null,'Gas reservation is corrupt or already settled');
   const i=row.intent;
   const request={from:sender,chainId:i.chainId,nonce:i.nonce,type:i.type,to:i.to,data:i.data,value:i.value,gasLimit:i.gasLimit,...(i.type===0?{gasPrice:i.maxFeePerGas}:{maxFeePerGas:i.maxFeePerGas,maxPriorityFeePerGas:i.maxPriorityFeePerGas})};
   check(gasIntent(request,sender).hash===row.intent_hash&&gasIntent(request,sender).maximum===row.maximum,'Corrupt reserved gas request');
   return request;
  }),
  snapshot:()=>work(async(c,{period,notice})=>{
   const summary=await totals(c,period);
   const {rows}=await c.query('SELECT intent FROM launchpad.service_gas_reservations WHERE project_id=$1 AND actual IS NULL ORDER BY sender,nonce LIMIT 20',[id]);
   return {...summary,blocked:!!notice&&BigInt(notice.requiredWei)>BigInt(summary.availableWei),...(notice?{requiredWei:notice.requiredWei}:{}),pending:rows.map(r=>r.intent)};
  }),
  reserve:(request,sender)=>work(async(c,{period,at})=>{
   const {item,row}=await lookup(c,request,sender);
   if(row)return {status:row.actual===null?'reserved':'settled',replayed:true,request:row.intent};
   const view=await totals(c,period);
   if(BigInt(item.maximum)>BigInt(view.availableWei)){
    const budget={...view,blocked:true,requiredWei:item.maximum,retryAt:BigInt(view.reservedWei)>0n?Math.min(view.retryAt,(at+300)*1000):view.retryAt};
    await c.query('UPDATE launchpad.service_gas_budgets SET notice=$2 WHERE project_id=$1',[id,JSON.stringify({requiredWei:item.maximum})]);
    return {denied:budget};
   }
   await c.query('INSERT INTO launchpad.service_gas_reservations(project_id,sender,nonce,intent,intent_hash,reserved_period,maximum) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,item.intent.sender,item.intent.nonce,JSON.stringify(item.intent),item.hash,period,item.maximum]);
   return {status:'reserved',replayed:false,request:item.intent};
  }).then(result=>{if(result.denied)throw Object.assign(Error('Service gas budget exhausted'),{code:'SERVICE_GAS_BUDGET_EXHAUSTED',budget:result.denied});return result;}),
  assertReserved:(request,sender)=>work(async c=>{
   const {row}=await lookup(c,request,sender);check(row,'Gas must be reserved before signing');return {status:row.actual===null?'reserved':'settled'};
  }),
  // Only callers that have verified canonical finalized receipt/block may settle.
  // Lost commits replay the same evidence; unresolved reservations never expire.
  settle:(raw,receipt,block)=>work(async(c,{at})=>{
   const tx=Transaction.from(raw);check(tx.isSigned(),'Signed gas intent required');
   const {row}=await lookup(c,tx,tx.from);check(row,'Missing signed gas reservation');
   check(receipt.hash===tx.hash&&[0,1].includes(receipt.status)&&receipt.blockHash===block.hash&&receipt.blockNumber===block.number&&Number.isSafeInteger(block.timestamp)&&block.timestamp<=at,'Invalid finalized gas receipt');
   const used=BigInt(receipt.gasUsed),price=BigInt(receipt.gasPrice),actual=used*price;
   check(used>=0n&&used<=tx.gasLimit&&price>=0n&&price<=BigInt(row.intent.maxFeePerGas)&&actual<=BigInt(row.maximum),'Gas receipt exceeds reserved intent');
   const period=Math.max(Number(row.reserved_period),gasPeriod(policy,block.timestamp));
   const observation={hash:tx.hash,blockNumber:block.number,blockHash:block.hash,timestamp:block.timestamp,status:receipt.status,gasUsed:String(used),gasPrice:String(price),actual:String(actual),period};
   if(row.actual!==null){check(row.observation_hash===digest(observation)&&digest(row.observation)===row.observation_hash,'Finalized gas receipt changed');return {replayed:true};}
   await c.query('UPDATE launchpad.service_gas_reservations SET settled_period=$4,actual=$5,observation=$6,observation_hash=$7 WHERE project_id=$1 AND sender=$2 AND nonce=$3',[id,tx.from.toLowerCase(),tx.nonce,period,String(actual),JSON.stringify(observation),digest(observation)]);
   return {replayed:false,actualWei:String(actual),period};
  })
 };
}
