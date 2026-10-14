// First migration only. Read files and chain state; never initialize/reset journals.
import {readFile,lstat,realpath} from 'node:fs/promises';
import {isAbsolute,resolve,dirname,basename} from 'node:path';
import {createRequire} from 'node:module';
import {Contract,ZeroHash} from 'ethers';
import {digest} from '../../../src/tickets/digest.mjs';
import {validateMigration} from './pons-migration.mjs';
const require=createRequire(import.meta.url),{hash}=require('./runtime/scripts/direct-buy.cjs');
const check=(v)=>{if(!v)throw Error('QIANQI handoff requires reconciliation');};
export function legacyJournalIdentities({binding,publicConfig,profile,handoff}){
 check(binding.configHash===hash(publicConfig)&&binding.profileHash===hash(profile));
 const rpc=handoff.legacyRpcIdentity,url=new URL(rpc?.origin);
 check(url.protocol==='https:'&&url.origin===rpc.origin&&!url.username&&!url.password&&/^0x[0-9a-f]{64}$/i.test(rpc.endpointHash??''));
 const normalize=v=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):typeof v==='string'&&/^0x[0-9a-fA-F]+$/.test(v)?v.toLowerCase():v;
 return {'':hash({config:publicConfig,rpcUrl:rpc,sender:publicConfig.executor,publicProfile:profile,executionScope:'public'}),
  '.scheduler':hash(require('./runtime/scripts/pons-automation.cjs').schedulerConfigFor(publicConfig)),
  '.rng':hash(normalize({worker:'drand-delivery-v1',job:publicConfig.deliveryJob,sender:publicConfig.executor}))};
}
async function absent(file){try{await lstat(file);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
async function canonical(file){check(isAbsolute(file??''));return resolve(await realpath(dirname(file)),basename(file));}

export async function inspectFirstPonsHandoff({entry,binding,migration,handoff,provider,config,publicConfig,profile}){
 validateMigration(migration);
 check(handoff?.schema==='qianqi-pons-first-handoff-v1'&&handoff.mode==='first-migration');
 check(handoff.bindingHash===hash(binding)&&handoff.migrationChecksum===migration.checksum&&handoff.legacyHash===migration.legacyHash&&digest(handoff.boundary)===digest(migration.boundary));
 check(handoff.schedulerHash===digest(config));
 check(handoff.legacyEvidence&&digest(handoff.legacyEvidence)===migration.legacyHash);
 check(binding.sender.toLowerCase()===entry.executorAddress.toLowerCase());
 const identities=legacyJournalIdentities({binding,publicConfig,profile,handoff});
 const old=await canonical(binding.statePath),fresh=await canonical(entry.stateFile);
 const suffixes=['','.rng','.scheduler'];
 const paths=suffixes.flatMap(s=>[old+s,fresh+s]);check(new Set(paths.map(p=>process.platform==='win32'?p.toLowerCase():p)).size===paths.length);
 // Existing new state, even valid and idle, needs a different resume inspection.
 for(const suffix of suffixes)for(const extra of ['','.lock','.service.lock','.tmp'])check(await absent(fresh+suffix+extra));
 check(Array.isArray(handoff.legacyJournals)&&handoff.legacyJournals.length===3&&new Set(handoff.legacyJournals.map(x=>x.suffix)).size===3);
 const jobs=[],cutoffs=[];
 for(const suffix of suffixes){
  const pin=handoff.legacyJournals.find(x=>x.suffix===suffix);check(pin);
  const file=old+suffix;check(await absent(file+'.lock')&&await absent(file+'.service.lock')&&await absent(file+'.tmp'));
  if(await absent(file)){check(suffix!==''&&pin.checksum===null&&pin.configHash===null);continue;}
  check(!(await lstat(file)).isSymbolicLink());
  const {checksum,...state}=JSON.parse(await readFile(file,'utf8'));
  check(state.schema==='local-scheduler-state-v1'&&checksum===hash(state)&&checksum===pin.checksum&&state.configHash===pin.configHash&&typeof state.configHash==='string');
  check(state.configHash===identities[suffix]);
  check(!state.pending&&!state.operation);
  for(const [kind,candidate] of Object.entries(state.cutoffs??{})){
   check(suffix==='.scheduler'&&['SHORT','MONTHLY'].includes(kind));
   const ack=handoff.retainedCheckpoints?.find(x=>x.kind===kind);
   check(ack?.disposition==='preserve-history-only'&&digest(ack.candidate)===digest(candidate));
   cutoffs.push({kind,candidate});
  }
  check(Array.isArray(state.jobs?.SHORT)&&Array.isArray(state.jobs?.MONTHLY));
  for(const kind of ['SHORT','MONTHLY'])for(const job of state.jobs[kind]){
   // Parent and RNG journals must not contain planner jobs.
   check(suffix==='.scheduler'&&job.job&&job.terminalChecked&&!job.retired);
   jobs.push({kind,entry:job});
  }
 }
 const head=await provider.getBlock('finalized');check(head&&head.number>=migration.boundary.number);
 check((await provider.getBlock(migration.boundary.number))?.hash===migration.boundary.hash);
 check(await provider.getTransactionCount(binding.sender,'latest')===await provider.getTransactionCount(binding.sender,'pending'));
 check(!Object.values(migration.ledger.pending).some(Boolean));
 const at={blockTag:head.number};
 check((handoff.retainedCheckpoints??[]).length===cutoffs.length);
 for(const kind of ['SHORT','MONTHLY']){
  const short=kind==='SHORT',active=short?'activeProposal':'activeMonth',pending=short?'pendingDatasetDraw':'pendingMonth';
  const c=new Contract(migration.domain[short?'source':'monthlySource'],[`function ${active}() view returns(bytes32)`,`function ${pending}() view returns(bytes32)`],provider);
  check(await c[active](at)===ZeroHash&&await c[pending](at)===ZeroHash);
 }
 for(const {kind,entry:job} of jobs){
  const drawId=job.job.artifact?.request?.drawId;
  check(migration.ledger.draws.some(d=>d.kind===kind&&d.drawId===drawId&&d.status==='CONSUMED'));
  check(job.terminalChecked.number<=head.number&&(await provider.getBlock(job.terminalChecked.number))?.hash===job.terminalChecked.hash);
 }
 for(const {kind,candidate} of cutoffs){
  check(Number.isSafeInteger(candidate.number)&&candidate.number>=0&&candidate.number<=migration.boundary.number);
  check((await provider.getBlock(candidate.number))?.hash===candidate.hash);
  // This is a later, unsubmitted checkpoint, not a saved artifact or a frozen set.
  check(jobs.filter(j=>j.kind===kind).every(j=>j.entry.terminalChecked.number<candidate.number));
  const source=new Contract(migration.domain[kind==='SHORT'?'source':'monthlySource'],['function cutoffHashes(uint256) view returns(bytes32)'],provider);
  check(await source.cutoffHashes(candidate.number,at)===candidate.hash);
 }
 // Claims with remaining credit require an explicit obligation handoff, not a clean migration.
 const vault=new Contract(migration.domain.vault,['function reward(bytes32,address) view returns(uint256)','function draws(bytes32) view returns(address asset,uint64 campaignId,uint8 status,uint256 budget,uint256 awarded,uint256 paid)'],provider);
 for(const draw of migration.ledger.draws){const value=await vault.draws(draw.drawId,at);check(value.awarded===value.paid);}
 for(const reward of [...(migration.rewards?.rewards??[]),...(migration.controllerRewards??[])]){
  check(typeof reward.drawId==='string'&&typeof reward.winner==='string');
  check(await vault.reward(reward.drawId,reward.winner,at)===0n);
 }
 return {mode:'first-migration',boundary:migration.boundary,retainedCheckpoints:handoff.retainedCheckpoints??[],legacyJournals:handoff.legacyJournals.map(({suffix,checksum})=>({suffix,checksum}))};
}
