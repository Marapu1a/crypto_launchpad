import {id} from 'ethers';
import {inProject} from './store.mjs';
import {check,identity,scope} from '../../src/holders/values.mjs';
import {replayHolderProgram} from '../../src/holders/program.mjs';
import {validateFundingPolicy} from '../../src/holders/funding-receipt.mjs';
import {checkFundingCounters} from '../../src/holders/funding-counters.mjs';
import {importHolderFunding} from './holder-preparation.mjs';

const revenue=id('Revenue(bytes32,address,uint256,uint256)'),deposit=id('Deposited(bytes32,address,uint256,uint256)');
function decode(row){check(row&&identity(row.body)===row.body_hash,'Missing or corrupt funding recovery record');return row.body;}
async function program(c,s){
 const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_preparations WHERE project_id=$1 AND scope_id=$2',[s.projectId,identity(s)]);
 const p=decode(row);check(identity(p.scope)===identity(s),'Funding recovery scope mismatch');replayHolderProgram(p);return p;
}

// One explicit, bounded page. Imports commit individually through the trusted
// importer; the cursor commits last. A lost response/crash only replays evidence.
// The jobs pool needs >=2 connections (scan lease + independent import commits).
export async function recoverHolderFunding(pool,input,{provider,maxBlocks=500,maxReceipts=50}={}){
 const s=scope(input),key=identity(s);
 check(Number.isSafeInteger(maxBlocks)&&maxBlocks>0&&maxBlocks<=2000,'Invalid funding block budget');
 check(Number.isSafeInteger(maxReceipts)&&maxReceipts>0&&maxReceipts<=100,'Invalid funding receipt budget');
 return inProject(pool,s.projectId,async c=>{
  const {rows:[lock]}=await c.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS held',['holder-funding-scan:'+key]);
  if(!lock.held)return {status:'busy'};
  const p=await program(c,s),policy=validateFundingPolicy(p.fundingPolicy,s);
  const initial={schema:'holder-funding-scan-v1',scopeId:key,policyHash:identity(policy),nextBlock:policy.fromBlock,checkpoint:null};
  const {rows:[row]}=await c.query('SELECT * FROM launchpad.holder_funding_scans WHERE project_id=$1 AND scope_id=$2',[s.projectId,key]);
  const saved=row?decode(row):initial;
  check(saved.schema===initial.schema&&saved.scopeId===key&&saved.policyHash===initial.policyHash&&Number.isSafeInteger(saved.nextBlock)&&saved.nextBlock>=policy.fromBlock,'Funding scan identity mismatch');
  const head=await provider.getBlock('finalized');
  check(head&&head.number>=policy.fromBlock,'No finalized funding head');
  if(saved.checkpoint){
   check(saved.nextBlock===saved.checkpoint.number+1&&head.number>=saved.checkpoint.number,'Funding scan finality regressed');
   check((await provider.getBlock(saved.checkpoint.number))?.hash===saved.checkpoint.hash,'Funding scan checkpoint changed');
  }
  const end=Math.min(head.number,saved.nextBlock+maxBlocks-1),block=await provider.getBlock(end);
  check(block?.number===end,'Missing funding scan end block');
  let logs=[];
  if(saved.nextBlock<=end)logs=await provider.getLogs({address:[policy.splitter.address,policy.vault.address],topics:[[revenue,deposit]],fromBlock:saved.nextBlock,toBlock:end});
  check(logs.length<=1000&&new Set(logs.map(l=>l.transactionHash)).size<=maxReceipts,'Funding page exceeds receipt/log budget; reduce maxBlocks or import explicit receipts');
  const seen=new Set();
  for(const l of logs){
   check(!l.removed&&Number.isSafeInteger(l.blockNumber)&&l.blockNumber>=saved.nextBlock&&l.blockNumber<=end&&Number.isSafeInteger(l.index)&&l.index>=0,'Invalid funding scan log');
   check((l.topics[0]===revenue&&l.address.toLowerCase()===policy.splitter.address.toLowerCase())||(l.topics[0]===deposit&&l.address.toLowerCase()===policy.vault.address.toLowerCase()),'Unexpected funding scan emitter');
   const k=l.transactionHash+':'+l.index;check(!seen.has(k),'Duplicate funding scan log');seen.add(k);
  }
  logs.sort((a,b)=>a.blockNumber-b.blockNumber||a.index-b.index);
  let imported=0;
  for(const l of logs){
   const result=await importHolderFunding(pool,s,{provider,txHash:l.transactionHash,logIndex:l.index});
   const fresh=await program(c,s),event=fresh.events.find(e=>e.evidence?.txHash===l.transactionHash.toLowerCase()&&e.evidence?.logIndex===l.index);
   check(event?.evidence.blockNumber===l.blockNumber&&event.evidence.blockHash===l.blockHash,'Funding log/receipt mismatch');
   if(!result.replayed)imported++;
  }
  const counters=await checkFundingCounters(await program(c,s),provider,block,{deploymentHead:head});
  check((await provider.getBlock('finalized'))?.number>=end,'Funding scan finality regressed before commit');
  if(saved.checkpoint)check((await provider.getBlock(saved.checkpoint.number))?.hash===saved.checkpoint.hash,'Funding scan checkpoint changed before commit');
  const next={...saved,nextBlock:end+1,checkpoint:{number:end,hash:block.hash}};
  await c.query('INSERT INTO launchpad.holder_funding_scans VALUES($1,$2,$3,$4) ON CONFLICT(project_id,scope_id) DO UPDATE SET body=EXCLUDED.body,body_hash=EXCLUDED.body_hash',[s.projectId,key,JSON.stringify(next),identity(next)]);
  return {status:end===head.number?'reconciled':'progress',checkpoint:next.checkpoint,nextBlock:next.nextBlock,head:head.number,logs:logs.length,imported,...counters};
 },{readOnly:false});
}
