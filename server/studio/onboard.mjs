import fs from 'node:fs';
import path from 'node:path';
import {Contract,ContractFactory,Wallet,id,getCreateAddress} from 'ethers';
import {validateLaunch,USDG,ESCROW} from './template.mjs';
import {compileTemplate} from './compile.mjs';
import {transact} from './journal.mjs';
import {assertLocalFork,verifyLaunch} from '../../src/pons/local-execution.mjs';
import {preparePlan,simulatePlan} from '../../src/pons/plan.mjs';
import {NETWORK,stringify} from '../../src/pons/client.mjs';
import {amount} from '../../src/draws/config.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {createProfile} from '../../src/tickets/scanner.mjs';
import {createWorkerConfig,verifyConfig} from '../../src/worker/local-worker.mjs';
import {saveState} from '../../src/worker/storage.mjs';
import {registerPostgresWorker} from '../shared/postgres-worker.mjs';
import {ingestNext} from '../shared/chain-read.mjs';

export function readLaunch(file){
 const {checksum,...s}=JSON.parse(fs.readFileSync(file));if(checksum!==digest(s))throw Error('Повреждено состояние запуска');return s;
}
export function publicLaunch(s){return {id:s.input.id,slug:s.input.slug,name:s.input.draft.name,stage:s.stage,token:s.launch?.token,program:s.addresses.program,hostname:s.input.slug+'.localhost',rehearsalStarted:!!s.testClockAdvanced,steps:Object.entries(s.transactions).map(([name,t])=>({name,hash:t.hash,confirmed:!!t.blockHash})),lastPass:s.lastPass};}

// Caller holds an exclusive PostgreSQL session lock for this deployment signer.
export async function onboard({input,root,provider,signer,pools,hook,guard}){
 input=validateLaunch(input);
 const fork=await assertLocalFork(provider),file=path.join(root,input.id,'launch.json');
 const artifacts=compileTemplate(),build=digest(Object.fromEntries(Object.entries(artifacts).map(([k,v])=>[k,v.evm.bytecode.object])));
 let s;
 if(fs.existsSync(file))s=readLaunch(file);
 else{
  // Reject invalid live economics/balances before creating any module contract.
  await preparePlan(provider,input.draft,signer.address);
  s={schema:'local-launch-v1',input,identity:digest(input),instance:fork.instanceId,build,stage:'deploying',executorKey:Wallet.createRandom().privateKey,addresses:{},transactions:{}};
  await saveState(file,s);
 }
 if(s.identity!==digest(input)||s.instance!==fork.instanceId||s.build!==build)throw Error('Настройки, шаблон или экземпляр стенда изменились');
 if(s.stage==='ready'){await verifyConfig(provider,s.config);return s;}
 const save=async()=>{await guard();await saveState(file,s);},send=(key,request)=>transact({provider,signer,state:s,save,key,request,hook,guard});
 const executor=new Wallet(s.executorKey,provider),fees=input.draws.fees,short=input.draws.short;
 const deploy=async(key,name,args)=>{
  const artifact=artifacts[name],factory=new ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer);
  const receipt=await send(key,await factory.getDeployTransaction(...args));
  const address=getCreateAddress({from:signer.address,nonce:s.transactions[key].nonce});
  if(receipt.contractAddress?.toLowerCase()!==address.toLowerCase()||await provider.getCode(address)==='0x')throw Error('Контракт не создан');
  s.addresses[key]=address;await save();return new Contract(address,artifact.abi,signer);
 };
 const program=await deploy('program','LocalDrandShortProgram',[USDG,executor.address,short.intervalSeconds,amount(short.minimumFund),amount(short.basket.minimumUnit),short.basket.weights,{lead:60,clockLag:5,clockAhead:5,finalizedLag:5,beaconLag:10}]);
 const splitter=await deploy('splitter','LocalFeeSplitter',[USDG,program.target,input.team,input.operations,[fees.prizesBps,fees.teamBps,fees.operationsBps]]);
 const collector=await deploy('collector','LocalPonsFeeCollector',[USDG,ESCROW,splitter.target,NETWORK.factory]);
 const source=await deploy('recognition','LocalPurchaseRecognition',[id(input.id),signer.address]);
 // Funding is an explicit, journaled transfer of fork ETH only.
 await send('executor-funding',{to:executor.address,value:1000000000000000000n,data:'0x'});
 if(!s.plan){
  const draft={...input.draft,feeWallet:collector.target};
  let plan=await preparePlan(provider,draft,signer.address);
  for(const step of plan.steps)await send('approve-'+step.kind,step.tx??step);
  plan=await simulatePlan(provider,await preparePlan(provider,draft,signer.address));
  s.plan=JSON.parse(stringify(plan));await save();
 }
 const receipt=await send('launch',{...s.plan.tx,value:BigInt(s.plan.tx.value)});
 s.launch=await verifyLaunch(provider,receipt,s.plan);await save();
 await send('bind',await collector.bind.populateTransaction(s.launch.token));
 if(!s.config){
  const profile=await createProfile(provider,{token:s.launch.token,program:program.target,launchBlock:s.launch.block,thresholdRaw:String(amount(input.draws.ticketPurchase)),instance:input.id,recognition:{adapter:'local-verified-curve-v1',source:source.target,publisher:signer.address,instanceId:await source.instanceId(),deferDirectBuys:true}});
  s.config=await createWorkerConfig(provider,{profile,collector:collector.target,executor:executor.address,limits:{maxGasPrice:'100000000000',maxGasLimit:'8000000',nativeFloor:'1000000000000000'}});
  s.stage='registering';await save();
 }
 const p=input.id,m=p,sourceId=p,profile=s.config.profile;
 const client=await pools.admin.connect();
 try{
  await client.query('BEGIN');
  await client.query("INSERT INTO launchpad.projects VALUES($1,$2,$3,31337,$4,'test') ON CONFLICT(id) DO NOTHING",[p,input.slug,input.draft.name,s.launch.token.toLowerCase()]);
  const row=(await client.query('SELECT * FROM launchpad.projects WHERE id=$1',[p])).rows[0];
  if(row.token_address!==s.launch.token.toLowerCase()||row.slug!==input.slug)throw Error('Project binding mismatch');
  await client.query("SELECT set_config('launchpad.project_id',$1,true)",[p]);
  await client.query("INSERT INTO launchpad.module_instances VALUES($1,$2,'short','local-ticket-shadow-v1',$3,$4) ON CONFLICT DO NOTHING",[p,m,program.target.toLowerCase(),digest(s.config)]);
  const genesis=await provider.send('eth_getBlockByNumber',['0x0',false]);
  await client.query('INSERT INTO launchpad.chain_sources VALUES($1,31337,$2,$3,$4,$3,$4,false) ON CONFLICT DO NOTHING',[sourceId,genesis.hash,profile.anchor.number,profile.anchor.hash]);
  await client.query('INSERT INTO launchpad.project_domains VALUES($1,$2) ON CONFLICT DO NOTHING',[input.slug+'.localhost',p]);
  if((await client.query('SELECT project_id FROM launchpad.project_domains WHERE hostname=$1',[input.slug+'.localhost'])).rows[0].project_id!==p)throw Error('Hostname occupied');
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 const tip=Number(BigInt(await provider.send('eth_blockNumber',[])));
 for(let n=0;n<100;n++){const r=await ingestNext(pools.ingest,provider,sourceId,tip);if(r.status==='CAUGHT_UP')break;}
 await registerPostgresWorker({executorPool:pools.executor,jobsPool:pools.jobs,provider,projectId:p,moduleId:m,sourceId,config:s.config});
 fs.mkdirSync(path.join(root,p,'bundles'),{recursive:true});s.stage='ready';await save();return s;
}
