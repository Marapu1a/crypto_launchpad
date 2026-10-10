import fs from 'node:fs';
import path from 'node:path';
import {Wallet,Contract,Transaction} from 'ethers';
import {onboard,readLaunch,publicLaunch} from './onboard.mjs';
import {UUID,validateLaunch} from './template.mjs';
import {transact} from './journal.mjs';
import {saveState} from '../../src/worker/storage.mjs';
import {runPostgresWorker,readPostgresWorker} from '../shared/postgres-worker.mjs';
import {inProject} from '../shared/store.mjs';
import {readTicketLedger} from '../shared/ticket-ledger.mjs';
import {recognize} from '../../src/tickets/recognition.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {bundleHash} from '../../src/tickets/late-recognition.mjs';
import {assertLocalFork} from '../../src/pons/local-execution.mjs';
import {USDG} from './template.mjs';
import {ABI} from '../../src/worker/local-worker.mjs';
export function createStudio({root,provider,signer,pools,hook}){
 fs.mkdirSync(root,{recursive:true});
 const file=p=>{if(!UUID.test(p))throw Error('Invalid project ID');return path.join(root,p,'launch.json');};
 async function exclusive(work){
  const session=await pools.admin.connect();let held=false,lost=false;
  const onError=()=>{lost=true;};session.on('error',onError);
  const guard=async()=>{if(!held||lost)throw Error('Launch lease lost');try{await session.query('SELECT 1');}catch{lost=true;throw Error('Launch lease lost');}};
  try{
   held=(await session.query('SELECT pg_try_advisory_lock(hashtextextended($1,49176)) AS held',['studio:'+signer.address])).rows[0].held;
   if(!held)throw Error('Стенд занят, повторите после текущего шага');
   return await work(guard);
  }finally{held=false;session.removeListener('error',onError);session.release(true);}
 }
 const states=()=>fs.readdirSync(root).filter(n=>UUID.test(n)&&fs.existsSync(file(n))).map(n=>readLaunch(file(n)));
 async function launch(input){
  input=validateLaunch(input);
  return exclusive(async guard=>{
   if(states().some(s=>s.input.slug===input.slug&&s.input.id!==input.id))throw Error('Поддомен уже занят другим запуском');
   const registered=await pools.admin.query('SELECT id FROM launchpad.projects WHERE id=$1 OR slug=$2',[input.id,input.slug]);
   if(registered.rows.some(r=>r.id!==input.id)||registered.rowCount&&!fs.existsSync(file(input.id)))throw Error('Проект уже зарегистрирован; отсутствующий журнал нельзя пересоздавать');
   return publicLaunch(await onboard({input,root,provider,signer,pools,hook,guard}));
  });
 }
 async function pass(p){return exclusive(async guard=>{
  const s=readLaunch(file(p));if(s.stage!=='ready')throw Error('Сначала завершите создание проекта');
  try{
  for(const [key,intent] of Object.entries(s.transactions))if(!intent.blockHash){
   const tx=Transaction.from(intent.raw);
   await transact({provider,signer,state:s,guard,save:async()=>{await guard();await saveState(file(p),s);},key,request:{to:tx.to,data:tx.data,value:tx.value}});
  }
  const result=await runPostgresWorker({executorPool:pools.executor,jobsPool:pools.jobs,ingestPool:pools.ingest,provider,signer:new Wallet(s.executorKey,provider),projectId:p,moduleId:p,sourceId:p,config:s.config,bundleDirectory:path.join(root,p,'bundles')});
  // Publish only independently rechecked known routes. Late credits enter their
  // confirmation block, never the immutable snapshot of an earlier draw.
  const rows=await inProject(pools.jobs,p,async c=>(await c.query("SELECT e.* FROM launchpad.ticket_events e LEFT JOIN launchpad.ticket_credits c USING(project_id,module_id,candidate_id) WHERE e.module_id=$1 AND c.candidate_id IS NULL AND e.payload_text::jsonb->'event'->>'reason'='SUPPORTED_BUY' AND e.payload_text::jsonb->'event'->>'status'='WAITING_RECOGNITION' ORDER BY e.block_number,e.candidate_id LIMIT 50",[p])).rows);
  const candidates=[];
  for(const row of rows){
   const payload=JSON.parse(row.payload_text);if(digest(payload)!==row.payload_hash)throw Error('Recognition evidence checksum');
   const hash=payload.evidence.transaction.hash,tx=await provider.send('eth_getTransactionByHash',[hash]),receipt=await provider.send('eth_getTransactionReceipt',[hash]);
   if(!receipt||(await provider.getBlock(Number(BigInt(receipt.blockNumber))))?.hash!==receipt.blockHash)throw Error('Recognition branch changed');
   if(recognize(s.config.profile,tx,receipt).some(e=>e.candidateId===row.candidate_id&&e.status==='ELIGIBLE'))candidates.push(row.candidate_id);
  }
  if(candidates.length){
   const bundle={schema:'launchpad-local-recognition-v1',profileHash:digest(s.config.profile),candidates},hash=bundleHash(bundle);
   const source=new Contract(s.addresses.recognition,['function confirmed(bytes32) view returns(bool)','function confirm(bytes32,uint256)'],signer);
   if(!await source.confirmed(hash)){
    fs.writeFileSync(path.join(root,p,'bundles',hash+'.json'),JSON.stringify(bundle),{mode:0o600});
    await transact({provider,signer,state:s,save:async()=>{await guard();await saveState(file(p),s);},guard,key:'recognition-'+hash,request:await source.confirm.populateTransaction(hash,candidates.length)});
   }
  }
  s.lastPass=result;await guard();await saveState(file(p),s);return result;
  }catch(error){await guard();s.lastPass={status:'blocked',reason:'Требуется проверка состояния проекта'};await saveState(file(p),s);throw error;}
 });}
 async function detail(p){
  const s=readLaunch(file(p));
  if(s.stage!=='ready')return {...publicLaunch(s),input:s.input};
  const program=new Contract(s.addresses.program,[...ABI.program,'event Award(uint256 indexed cycle,address indexed winner,uint256 amount)','event Paid(uint256 indexed cycle,address indexed winner,uint256 amount)'],provider);
  const block=await provider.getBlock('latest'),options={blockTag:block.number},cycle=await program.cycle(options),draw=await program.draws(cycle,options);
  const awards=cycle>0n?await program.queryFilter(program.filters.Award(cycle),s.launch.block,block.number):[];
  const paid=cycle>0n?await program.queryFilter(program.filters.Paid(cycle),s.launch.block,block.number):[];
  return {...publicLaunch(s),input:s.input,ledger:await readTicketLedger(pools.jobs,p,p),worker:await readPostgresWorker(pools.executor,p,p),draw:{cycle:String(cycle),settled:draw.settled,awardedRaw:String(draw.awarded),budgetRaw:String(draw.budget),freeFundRaw:String(await program.freeFund(options)),nextAt:Number(await program.lastTerminal(options)+await program.interval(options)),block:block.number,prizes:awards.map(a=>({wallet:a.args.winner,amountRaw:String(a.args.amount),paid:paid.some(event=>event.args.winner===a.args.winner&&event.args.amount===a.args.amount)}))}};
 }
 async function exercise(p){return exclusive(async guard=>{
  await assertLocalFork(provider);const s=readLaunch(file(p));if(s.stage!=='ready')throw Error('Project not ready');
  const save=async()=>{await guard();await saveState(file(p),s);};
  const send=(key,request)=>transact({provider,signer,state:s,guard,save,key,request});
  const quote=new Contract(USDG,['function approve(address,uint256) returns(bool)'],signer);
  const curve=new Contract(s.launch.curve,['function buy(uint256,uint256,address) returns(uint256)'],signer);
  await send('test-approve',await quote.approve.populateTransaction(s.launch.curve,3119000000n));
  await send('test-buy',await curve.buy.populateTransaction(3119000000n,1,signer.address));
  if(!s.testClockAdvanced){
   const tip=await provider.getBlock('latest');
   if(tip.timestamp<Math.floor(Date.now()/1000)){await provider.send('evm_setNextBlockTimestamp',[Math.floor(Date.now()/1000)]);await provider.send('evm_mine',[]);}
   s.testClockAdvanced=true;await save();
  }
  return publicLaunch(s);
 });}
 return {launch,pass,detail,exercise,list:()=>states().map(publicLaunch)};
}
