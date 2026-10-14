import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createMigration,advanceMigration,prepareMigrationJob,validateMigration} from '../../server/adapters/qianqi/pons-migration.mjs';
import {applyControllerReceipt} from '../../server/adapters/qianqi/pons-controller-events.mjs';
import {runPonsScheduler} from '../../server/adapters/qianqi/pons-scheduler.mjs';
const require=createRequire(import.meta.url),root='../../server/adapters/qianqi/runtime/';
const config=require(root+'test/fixtures/pons-public-config.json');
const {domainFor}=require(root+'scripts/attempt-lifecycle.cjs');
const {ABI}=require(root+'scripts/attempt-lifecycle.cjs');
const sd=require(root+'scripts/short-dataset.cjs'),mo=require(root+'scripts/monthly-outcome.cjs');
const {drawIdFor}=require(root+'scripts/draw-id.cjs');
const sw=require(root+'scripts/local-short-executor.cjs'),mw=require(root+'scripts/local-monthly-executor.cjs');
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),wallet='0x'+'12'.repeat(20);
const outcome={version:1,pNumerator:4,pDenominator:5,hNumerator:1,hDenominator:1};
function fixture(){
 const c=structuredClone(config),h={number:100000000,hash:hash(77),timestamp:1000};
 c.lifecycle.shortRules.rulesHash=sd.rulesHash(outcome,[1],'1');
 c.lifecycle.monthlyPolicy.rulesHash=mo.rulesHash(outcome);
 const rules=kind=>({currentEpoch:2,drainingEpoch:1,announced:null,epochs:[{epoch:1,firstBlock:1,rulesHash:hash(2)},{epoch:2,firstBlock:50,rulesHash:kind==='SHORT'?c.lifecycle.shortRules.rulesHash:c.lifecycle.monthlyPolicy.rulesHash}],lastTerminalAt:0});
 const lane=()=>({mintedTotal:'2',open:'1',consumedTotal:'1',frozenByDraw:{},byEpoch:[{epoch:'1',minted:'2',open:'1',consumed:'1',frozen:'0',firstOpenAttempt:'2',lastOpenAttempt:'2'}]});
 const lifecycle={head:h,pending:{SHORT:null,MONTHLY:null},draws:[],wallets:[{wallet,SHORT:lane(),MONTHLY:lane()}],shortRules:rules('SHORT'),monthlyRules:rules('MONTHLY')};
 const policy={contracts:{token:{address:c.manifest.token},quote:{address:c.manifest.quote}},template:{config:{ticketPurchase:'100'}}};
 const row=(n,raw)=>({id:hash(n)+':0',txHash:hash(n),trader:wallet,quoteRaw:raw,timestamp:900,side:'buy',venue:'curve',decision:'purchase'});
 const report={schema:'pons-purchase-accounting-v1',source:'Pons API',status:'current',error:null,reviewCount:0,checkedAt:1000,profile:{token:c.manifest.token,quote:c.manifest.quote,decimals:6,threshold:'100',venues:['curve'],excludedWallets:[]},tradeCount:1,activity:[row(1,'250000000')]};
 const args={policy,report,legacyCredits:[{status:'ELIGIBLE',transactionHash:hash(1),logIndex:0,recipient:wallet,netQuoteDebitRaw:'250000000'}],lifecycle,domain:domainFor(c.manifest,c.lifecycle),head:h,now:1000};
 return {c,args,row};
}
test('restart preserves old consumed, rewards and epoch ranges; new carry mints only in active epoch',()=>{
 const {args,row}=fixture();args.rewards=[{paid:true,amount:'9'}];let s=createMigration(args);
 assert.deepEqual(s.ledger.wallets,args.lifecycle.wallets);
 const report={...args.report,tradeCount:2,activity:[...args.report.activity,row(2,'60000000')]};
 s=advanceMigration({state:JSON.parse(JSON.stringify(s)),report,head:args.head,now:1000});
 for(const k of ['SHORT','MONTHLY']){
  const w=s.ledger.wallets[0][k];assert.equal(w.mintedTotal,'3');assert.equal(w.consumedTotal,'1');
  assert.deepEqual(w.byEpoch[0],args.lifecycle.wallets[0][k].byEpoch[0]);
  assert.equal(w.byEpoch[1].epoch,'2');assert.equal(w.byEpoch[1].firstOpenAttempt,'3');
 }
 const again=advanceMigration({state:s,report,head:args.head,now:1000});
 assert.deepEqual(again.ledger,s.ledger);assert.deepEqual(again.admissions,s.admissions);assert.deepEqual(s.rewards,args.rewards);
});
test('frozen participants survive import and new admissions',()=>{
 const {args,row}=fixture(),id=hash(333),p={wallet,count:'1',firstAttempt:'2',lastAttempt:'2'};
 args.lifecycle.pending.SHORT=id;args.lifecycle.draws=[{drawId:id,kind:'SHORT',status:'FROZEN',snapshot:{participants:[p]}}];
 const lane=args.lifecycle.wallets[0].SHORT;lane.open='0';lane.frozenByDraw={[id]:p};Object.assign(lane.byEpoch[0],{open:'0',frozen:'1',firstOpenAttempt:null,lastOpenAttempt:null});
 let s=createMigration(args);s=advanceMigration({state:s,report:{...args.report,tradeCount:2,activity:[...args.report.activity,row(2,'100000000')]},head:args.head,now:1000});
 assert.deepEqual(s.ledger.draws,args.lifecycle.draws);assert.deepEqual(s.ledger.wallets[0].SHORT.frozenByDraw,lane.frozenByDraw);assert.equal(s.ledger.wallets[0].SHORT.open,'1');
});
test('old source discrepancies preserve wallet and amount; missing credits cannot hide behind new buys',()=>{
 const {args,row}=fixture();args.report.activity[0].trader='0x'+'34'.repeat(20);args.report.activity[0].quoteRaw='198000000';
 const s=createMigration(args);assert.equal(s.ledger.wallets[0].SHORT.mintedTotal,'2');assert.equal(s.accounting.legacyDifferences.length,1);
 args.legacyCredits=[];args.report.activity=[row(2,'900000000')];assert.throws(()=>createMigration(args),/Legacy credits differ/);
});
test('both legacy job validators accept migrated artifacts; same-block late data cannot replace saved artifact',()=>{
 const {args,c,row}=fixture();for(const k of ['shortRules','monthlyRules']){args.lifecycle[k].drainingEpoch=0;args.lifecycle[k].currentEpoch=1;args.lifecycle[k].epochs=[{epoch:1,firstBlock:1,rulesHash:k==='shortRules'?c.lifecycle.shortRules.rulesHash:c.lifecycle.monthlyPolicy.rulesHash}];}
 let s=createMigration(args);
 for(const kind of ['SHORT','MONTHLY']){
  const drawId=drawIdFor(kind,hash(555));const request=kind==='SHORT'?{drawId,campaignId:'1',rulesEpoch:'1',cutoffBlockNumber:args.head.number,cutoffBlockHash:args.head.hash,budget:'1000000'}:{drawId,campaign:'1',rulesEpoch:'1',cutoff:args.head.number,cutoffHash:args.head.hash};
  const input={manifest:c.manifest,lifecycle:c.lifecycle,rules:outcome,weights:['1'],minimumUnit:'1',request};
  const prepared=prepareMigrationJob(s,kind,input);s=prepared.state;
  if(kind==='SHORT')sw.validateJob(sw.makeJob(prepared.artifact,hash(777)));else mw.validateMonthlyJob(mw.makeMonthlyJob(prepared.artifact));
  s=advanceMigration({state:s,report:{...args.report,tradeCount:2,activity:[...args.report.activity,row(2,'100000000')]},head:args.head,now:1000});
  assert.deepEqual(prepareMigrationJob(s,kind,input).artifact,prepared.artifact);
  const changed=structuredClone(input);changed.request.rulesEpoch='2';assert.throws(()=>prepareMigrationJob(s,kind,changed),/Stored request changed/);
  changed.lifecycle.instanceId=hash(888);assert.throws(()=>prepareMigrationJob(s,kind,changed),/domain changed/);
 }
});
test('stale, corrected, corrupt state and invalid epoch totals are rejected without mutation',()=>{
 const {args}=fixture(),s=createMigration(args),before=structuredClone(s);
 assert.throws(()=>advanceMigration({state:s,report:args.report,head:args.head,now:2000}),/Stale/);
 const report=structuredClone(args.report);report.activity[0].quoteRaw='999';assert.throws(()=>advanceMigration({state:s,report,head:args.head,now:1000}),/corrected/);
 assert.deepEqual(s,before);const bad=structuredClone(s);bad.ledger.wallets[0].SHORT.open='100';assert.throws(()=>validateMigration(bad),/checksum/);
 args.lifecycle.wallets[0].SHORT.byEpoch[0].minted='10';assert.throws(()=>createMigration(args),/Epoch conservation/);
});
function eventReceipt(f,name,args,{number=f.args.head.number+1,timestamp=30000}={}){
 const encoded=ABI.encodeEventLog(ABI.getEvent(name),args),block={number,hash:hash(number),timestamp},txHash=hash(number+100000000);
 return {manifest:f.c.manifest,lifecycle:f.c.lifecycle,block,receipt:{hash:txHash,status:1,blockNumber:number,blockHash:block.hash,index:0,logs:[{...encoded,index:0,address:f.c.lifecycle.source,transactionHash:txHash,blockNumber:number,blockHash:block.hash}]}};
}
test('freeze and terminal receipts are idempotent; late tickets survive NO_WINNER consumption',()=>{
 const f=fixture(),{args,c,row}=f;
 args.lifecycle.shortRules={...args.lifecycle.shortRules,currentEpoch:1,drainingEpoch:0,epochs:[{epoch:1,firstBlock:1,rulesHash:c.lifecycle.shortRules.rulesHash}]};
 let s=createMigration(args);const drawId=drawIdFor('SHORT',hash(42));
 const input={manifest:c.manifest,lifecycle:c.lifecycle,rules:outcome,weights:['1'],minimumUnit:'1',request:{drawId,campaignId:'1',rulesEpoch:'1',cutoffBlockNumber:args.head.number,cutoffBlockHash:args.head.hash,budget:'1000000'}};
 const prepared=prepareMigrationJob(s,'SHORT',input);s=prepared.state;const a=prepared.artifact;
 const freeze=eventReceipt(f,'AttemptsFrozen',[drawId,0,args.head.number,args.head.hash,a.snapshot.rulesHash,a.request.snapshotHash]);
 s=applyControllerReceipt(s,freeze);assert.deepEqual(applyControllerReceipt(s,freeze),s);
 assert.equal(s.ledger.wallets[0].SHORT.open,'0');assert.equal(s.ledger.wallets[0].SHORT.byEpoch[0].frozen,'1');
 s=advanceMigration({state:s,report:{...args.report,tradeCount:2,activity:[...args.report.activity,row(2,'100000000')]},head:{...args.head,number:freeze.block.number,hash:freeze.block.hash},now:1000});
 const terminal=eventReceipt(f,'AttemptsConsumed',[drawId,0,a.request.snapshotHash,0,hash(99)],{number:freeze.block.number+1,timestamp:31000});
 s=applyControllerReceipt(s,terminal);const lane=s.ledger.wallets[0].SHORT;
 assert.equal(lane.consumedTotal,'2');assert.equal(lane.open,'1');assert.equal(lane.byEpoch[0].firstOpenAttempt,'3');assert.equal(s.ledger.wallets[0].MONTHLY.consumedTotal,'1');
 assert.deepEqual(applyControllerReceipt(JSON.parse(JSON.stringify(s)),terminal),s);
 const changed=structuredClone(terminal);changed.block.hash=hash(999);changed.receipt.blockHash=hash(999);assert.throws(()=>applyControllerReceipt(s,changed),/receipt changed/);
 const bad=eventReceipt(f,'AttemptsConsumed',[drawId,0,a.request.snapshotHash,1,hash(98)],{number:terminal.block.number+1});assert.throws(()=>applyControllerReceipt(s,bad),/does not match/);
});
test('controller epoch receipts assign new admissions to new epoch and preserve draining range',()=>{
 const f=fixture(),{args,row}=f;
 args.lifecycle.shortRules={...args.lifecycle.shortRules,currentEpoch:1,drainingEpoch:0,epochs:[args.lifecycle.shortRules.epochs[0]]};
 let s=createMigration(args);const announce=eventReceipt(f,'ShortRulesAnnounced',[2,hash(12),33600]);s=applyControllerReceipt(s,announce);
 const activate=eventReceipt(f,'ShortRulesActivated',[1,2,announce.block.number+2],{number:announce.block.number+1,timestamp:33600});s=applyControllerReceipt(s,activate);
 const report={...args.report,checkedAt:33601,tradeCount:2,activity:[...args.report.activity,row(2,'100000000')]};
 s=advanceMigration({state:s,report,head:{number:activate.block.number+1,hash:hash(555),timestamp:33601},now:33601});
 const lane=s.ledger.wallets[0].SHORT;assert.equal(lane.byEpoch[0].minted,'2');assert.equal(lane.byEpoch[1].epoch,'2');assert.equal(lane.byEpoch[1].open,'1');assert.equal(s.ledger.shortRules.drainingEpoch,1);
 const bad=structuredClone(announce);bad.receipt.logs[0].transactionHash=hash(666);assert.throws(()=>applyControllerReceipt(createMigration(args),bad),/provenance/);
 const old=advanceMigration({state:createMigration(args),report,head:{number:activate.block.number+2,hash:hash(555),timestamp:33601},now:33601});
 assert.throws(()=>applyControllerReceipt(applyControllerReceipt(old,announce),activate),/Missed epoch boundary/);
});
test('scheduler rejects public provider before state file access or signer use',async()=>{
 await assert.rejects(runPonsScheduler({provider:{send:async()=>({clientVersion:'Public RPC',chainId:4663,instanceId:hash(1)})}}),/rehearsal-only/);
});
