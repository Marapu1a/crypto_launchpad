import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {randomUUID,createHash} from 'node:crypto';
import {BrowserProvider,Contract,keccak256} from 'ethers';
import {chromium} from 'playwright';
import {createOwnerCoordinator} from '../../server/owner-launch/coordinator.mjs';
import {withOwnerLaunch} from '../../server/owner-launch/store.mjs';
import {ownerLaunchHttp} from '../../server/owner-launch/http.mjs';
import {createTestPostgres} from '../contracts/production-postgres.mjs';
import {createPool,inProject} from '../../server/shared/store.mjs';
import {compileProduction} from '../../src/worker/production-build.mjs';
import {NETWORK,FACTORY} from '../../src/pons/client.mjs';
import {initialDraft} from '../../src/pons/plan.mjs';
import {USDG,ESCROW} from '../../server/studio/template.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import pins from '../../src/qianqi/routes/genesis-fields.json' with {type:'json'};

process.env.HARDHAT_CONFIG=path.resolve('tests/fork/production-hardhat.config.cjs');
const {default:hre}=await import('hardhat');
const base=new BrowserProvider(hre.network.provider,undefined,{cacheTimeout:-1});base.pollingInterval=20;
let finalized;
const provider=new Proxy(base,{get(target,key){if(key==='getBlock')return n=>target.getBlock(n==='finalized'?(finalized??'latest'):n);const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
const root='.local/test-results/owner-launch-'+new Date().toISOString().replace(/[:.]/g,'-');await fs.mkdir(root,{recursive:true});
const report={at:new Date().toISOString(),scenarios:[],limits:['Private in-process historical fork4663; no public transactions','Browser uses EIP-1193 fixture, not an installed wallet extension','Finality is modeled, explicit rehearsal timing/gas/funding only','Registers candidate worker, does not start production services']};
const persist=()=>fs.writeFile(root+'/report.json',JSON.stringify(report,null,2));
const scenario=async(name,fn)=>{await fn();report.scenarios.push({name,status:'PASS'});console.log('PASS '+name);await persist();};
let db,adminPool,server,browser;
try{
 const metadata=await provider.send('hardhat_metadata',[]);assert.equal(metadata.chainId,4663);assert.equal(metadata.forkedNetwork.chainId,4663);
 await provider.send('evm_mine',[]);report.fork=metadata.forkedNetwork;
 const signers=await Promise.all(Array.from({length:8},(_,i)=>provider.getSigner(i))),addresses=await Promise.all(signers.map(s=>s.getAddress()));const owner=addresses[0];
 const quote=new Contract(USDG,['function transfer(address,uint256) returns(bool)'],provider);
 await provider.send('hardhat_setBalance',[ESCROW,'0x56bc75e2d63100000']);await provider.send('hardhat_impersonateAccount',[ESCROW]);
 try{await provider.send('eth_sendTransaction',[{from:ESCROW,to:USDG,data:quote.interface.encodeFunctionData('transfer',[owner,10000000n])}]);}finally{await provider.send('hardhat_stopImpersonatingAccount',[ESCROW]);}
 const build=compileProduction(),anchor=await provider.getBlock('latest');report.buildHash=build.manifest.buildHash;
 const profile={mode:'rehearsal',instanceId:metadata.instanceId,owner,executor:addresses[3],publisher:addresses[4],anchor:{number:anchor.number,hash:anchor.hash},
  timing:{lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30},limits:{maxGasPrice:'100000000000',maxGasLimit:'15000000',nativeFloor:'100000'},funding:{executor:'1000000000000000',publisher:'1000000000000000'},totalNativeLimit:'2000000000000000000',externals:{}};
 const factory=new Contract(NETWORK.factory,FACTORY,provider);
 for(const [role,address] of Object.entries({factory:NETWORK.factory,router:NETWORK.router,quote:USDG,escrow:ESCROW,hook:await factory.memeHook(),batchExecutor:pins.pins.batchExecutor[0]}))profile.externals[role]={address,codeHash:keccak256(await provider.getCode(address))};
 db=await createTestPostgres(root+'/postgres');adminPool=createPool(db.url('postgres'));
 let coordinator=createOwnerCoordinator({pool:db.pools.executor,adminPool,provider,profile,build});
 const cfg=JSON.parse(await fs.readFile('config/rehearsals/first-token.json','utf8'));
 const defaults={draft:{...initialDraft(),name:'Owner rehearsal',symbol:'OWN',logo:'ipfs://bafkreigh2akiscaildcobgdzvv2a6sjkgmsnj4qpxqshgjp4l5te2qv3ee',pair:USDG,creatorFee:'2',openingBuy:'5'},draws:cfg.draws,team:addresses[5],operations:addresses[6]};
 const middleware=ownerLaunchHttp({coordinator:{info:()=>coordinator.info(),run:(...args)=>coordinator.run(...args)},defaults});
 server=createServer((req,res)=>middleware(req,res,async()=>{
  try{const name=req.url==='/'?'owner.html':req.url.split('?')[0].slice(1),file=path.resolve('dist',name);assert.ok(file.startsWith(path.resolve('dist')+path.sep)&&!name.split('/').some(x=>x.startsWith('.')));const data=await fs.readFile(file);res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});res.end(data);}catch{res.writeHead(404);res.end();}
 }));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch();const page=await browser.newPage();
 let sent=[],drop=false;
 await page.exposeFunction('ownerRpc',async args=>{
  if(args.method==='eth_requestAccounts'||args.method==='eth_accounts')return [owner];
  const value=await hre.network.provider.request(args);
  if(args.method==='eth_sendTransaction'){sent.push(value);if(drop){drop=false;throw Error('Test lost wallet response');}}
  return value;
 });
 await page.addInitScript(()=>{window.ethereum={request:args=>window.ownerRpc(args)};});
 let project,state;
 const readState=async()=>JSON.parse((await db.admin.query('SELECT state_text FROM launchpad.owner_launches WHERE project_id=$1',[project])).rows[0].state_text);
 const click=async name=>{await page.locator(name).click();await page.waitForFunction(()=>![...document.querySelectorAll('button')].some(b=>b.id==='refresh'&&b.disabled),{},{timeout:45000});};
 await scenario('Browser creates immutable server plan; validation, cross-origin and concurrent owner reservation reject',async()=>{
  await page.goto(origin);
  await page.locator('[name=creatorFee]').fill('1000');await page.locator('#owner-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.length>0);
  assert.equal((await db.admin.query('SELECT count(*) FROM launchpad.owner_launches')).rows[0].count,'0');assert.equal(sent.length,0);
  await page.locator('[name=creatorFee]').fill('2');await page.locator('#owner-form button[type=submit]').click();await page.locator('#sign').waitFor({timeout:45000});
  project=await page.evaluate(()=>JSON.parse(localStorage.getItem('launchpad:owner-launch:v1')).id);state=await coordinator.run(project,'next');
  assert.equal(state.candidate.kind,'program');assert.equal(sent.length,0);
  const input=state.input;await assert.rejects(coordinator.run(project,'create',{input:{...input,slug:'different'}}),/immutable/);
  await assert.rejects(coordinator.run(randomUUID(),'create',{input:{...input,id:randomUUID()}}),/ID mismatch/);
  const second={...input,id:randomUUID(),slug:'second-token'};await assert.rejects(coordinator.run(second.id,'create',{input:second}),e=>e.code==='23505');
  const collision=createOwnerCoordinator({pool:db.pools.executor,adminPool,provider,build,profile:{...profile,owner:addresses[1],executor:profile.publisher,publisher:addresses[7]}});
  await assert.rejects(collision.run(second.id,'create',{input:{...second,draft:{...second.draft,openingBuy:'0'}}}),e=>e.code==='23505');
  assert.equal((await db.admin.query('SELECT count(*) FROM launchpad.owner_launches')).rows[0].count,'1');
  const res=await fetch(origin+'/api/owner-launch/'+project+'/arm',{method:'POST',headers:{'content-type':'application/json',origin:'https://foreign.example'},body:'{}'});assert.equal(res.status,403);
  const badImage=await fetch(origin+'/api/pons/image-publish',{method:'POST',headers:{'content-type':'image/png',origin},body:'invalid image'});assert.equal(badImage.status,422);
  // Refresh after inspecting via API: review revisions deliberately change.
  await click('#refresh');
 });
 await scenario('Lost wallet response and page/server restart recover exact nonce/hash; no second arm',async()=>{
  drop=true;await click('#sign');assert.equal(sent.length,1);assert.ok((await readState()).pending&&!((await readState()).pending.hash));
  state=await coordinator.run(project,'next');await assert.rejects(coordinator.run(project,'arm',{requestId:state.pending.id,revision:state.revision}),/reserved|review changed/i);
  await assert.rejects(coordinator.run(project,'retry',{requestId:state.pending.id}),/Nonce already used/);
  coordinator=createOwnerCoordinator({pool:db.pools.executor,adminPool,provider,profile,build});
  await page.evaluate(()=>localStorage.clear());await page.reload();await page.locator('summary').filter({hasText:'Продолжить запуск по ID'}).click();
  await page.locator('#resume-id').fill(project);await page.locator('#resume').click();await page.locator('#recover-hash').waitFor({timeout:45000});
  await page.locator('#recover-hash').fill(sent[0]);await click('#attach');
  assert.equal((await readState()).history.length,1);assert.equal((await readState()).history[0].hash,sent[0]);assert.equal(sent.length,1);
 });
 await scenario('Mined transaction waits for finalized checkpoint before next signature',async()=>{
  finalized=(await provider.getBlock('latest')).number;
  await click('#sign');assert.equal(sent.length,2);assert.equal((await readState()).history.length,1);assert.ok((await readState()).pending.hash);
  await page.reload();await page.locator('#refresh').waitFor({timeout:45000});assert.equal(await page.locator('#sign').count(),0);
  finalized=undefined;await click('#refresh');assert.equal((await readState()).history.length,2);
 });
 await scenario('Exact production contracts, funding, USDG approval, Pons launch/bind and worker registration',async()=>{
  for(let i=0;i<12;i++){
   const s=await readState();if(s.stage==='registered')break;
   await page.locator('#sign').waitFor({timeout:45000});await click('#sign');
  }
  const s=await readState();assert.equal(s.stage,'registered');
  assert.deepEqual(s.history.map(x=>x.kind),['program','splitter','collector','recognition','executorFunding','publisherFunding','approve','launch','bind']);
  assert.equal(sent.length,9);assert.equal(new Set(sent).size,9);
  assert.equal((await db.admin.query('SELECT count(*) FROM launchpad.production_senders WHERE project_id=$1',[project])).rows[0].count,'1');
  assert.equal((await db.admin.query('SELECT count(*) FROM launchpad.production_wallets WHERE project_id=$1',[project])).rows[0].count,'2');
  assert.equal((await db.admin.query('SELECT count(*) FROM launchpad.schema_migrations')).rows[0].count,'13');
  report.deployment={project,token:s.launch.token,program:s.contracts.program.address,transactions:s.history,policyHash:digest(s.policy)};
  const nonce=await provider.getTransactionCount(owner);await click('#refresh');await page.reload();await page.locator('#refresh').waitFor();await click('#refresh');assert.equal(await provider.getTransactionCount(owner),nonce);
 });
 await scenario('RLS isolates launch journal; lost DB lease cannot save; missing journal cannot recreate registered token',async()=>{
  const other=randomUUID();assert.equal((await inProject(db.pools.executor,other,c=>c.query('SELECT * FROM launchpad.owner_launches'))).rowCount,0);
  await assert.rejects(db.pools.api.query('SELECT * FROM launchpad.owner_launches'),/permission denied/);
  const before=await readState();
  const another={...before.input,id:randomUUID(),slug:'another-token'};await assert.rejects(coordinator.run(another.id,'create',{input:another}),/already belongs/);
  await assert.rejects(withOwnerLaunch({pool:db.pools.executor,projectId:project,owner},async({state,save})=>{
   const locks=await db.admin.query("SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted AND pid<>pg_backend_pid()");assert.equal(locks.rowCount,1);await db.admin.query('SELECT pg_terminate_backend($1)',[locks.rows[0].pid]);state.spent='999';await save(state);
  }));assert.deepEqual(await readState(),before);
  await db.admin.query('DELETE FROM launchpad.owner_launch_wallets WHERE project_id=$1',[project]);
  await db.admin.query('DELETE FROM launchpad.owner_launches WHERE project_id=$1',[project]);
  await assert.rejects(coordinator.run(project,'create',{input:before.input}),/already exists/);
  // Retain the original verified journal in the test database after the negative case.
  await db.admin.query('INSERT INTO launchpad.owner_launches(project_id,chain_id,owner_address,slug,identity,state_text,state_hash,completed) VALUES($1,4663,$2,$3,$4,$5,$6,true)',[project,owner.toLowerCase(),before.input.slug,before.identity,JSON.stringify(before),digest(before)]);
  for(const role of ['executor','publisher'])await db.admin.query('INSERT INTO launchpad.owner_launch_wallets VALUES($1,$2,$3)',[profile[role].toLowerCase(),project,role]);
 });
 report.status='PASS';report.sources={};for(const file of ['server/owner-launch/coordinator.mjs','server/owner-launch/store.mjs','server/owner-launch/http.mjs','src/owner-launch.mjs','src/pons/owner-signing.mjs','db/migrations/013_owner_launches.sql'])report.sources[file]=createHash('sha256').update((await fs.readFile(file,'utf8')).replace(/\r\n/g,'\n')).digest('hex');
}catch(e){report.status='FAIL';report.error=String(e.shortMessage??e.message).replace(/https?:\/\/[^\s"')]+/g,'[URL redacted]');report.stack=String(e.stack).replace(/https?:\/\/[^\s"')]+/g,'[URL redacted]');console.error(report.error);process.exitCode=1;}
finally{await persist();console.log(root+'/report.json');await browser?.close();if(server)await new Promise(r=>server.close(r));await adminPool?.end();await db?.close();base.destroy();}
