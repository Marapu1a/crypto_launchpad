import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {ZeroHash,id} from 'ethers';
import {digest} from '../../src/tickets/digest.mjs';
import {sealMigration} from '../../server/adapters/qianqi/pons-migration.mjs';
import {inspectFirstPonsHandoff,legacyJournalIdentities} from '../../server/adapters/qianqi/pons-handoff.mjs';
const {hash}=createRequire(import.meta.url)('../../server/adapters/qianqi/runtime/scripts/direct-buy.cjs');
test('first handoff qualifies clean state and blocks occupied paths, stale pins, child jobs, RNG and boundary/nonce conflicts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pons-handoff-')),addr='0x'+'12'.repeat(20),block={number:50,hash:'0x'+'34'.repeat(32)};
 try{
  const binding={statePath:join(dir,'legacy'),sender:addr},entry={stateFile:join(dir,'new'),executorAddress:addr};
  const publicConfig={executor:addr,manifest:{},lifecycle:{},deliveryJob:{}},profile={};binding.configHash=hash(publicConfig);binding.profileHash=hash(profile);
  const rules={currentEpoch:1,epochs:[{epoch:1}]},ledger={wallets:[],draws:[],pending:{SHORT:null,MONTHLY:null},shortRules:rules,monthlyRules:rules};
  const evidence={lifecycle:ledger,legacyCredits:[],rewards:[]};
  const migration=sealMigration({schema:'qianqi-pons-migration-v1',ledger,boundary:block,legacyHash:digest(evidence),domain:{source:addr,monthlySource:addr,vault:addr}});
  const config={scheduler:'fixture'},state={schema:'local-scheduler-state-v1',configHash:'pinned-config',jobs:{SHORT:[],MONTHLY:[]}};
  const handoff={schema:'qianqi-pons-first-handoff-v1',mode:'first-migration',bindingHash:hash(binding),migrationChecksum:migration.checksum,legacyHash:migration.legacyHash,boundary:block,schedulerHash:digest(config),legacyEvidence:evidence,legacyJournals:[]};
  handoff.legacyRpcIdentity={origin:'https://old.invalid',endpointHash:ZeroHash};
  const identities=legacyJournalIdentities({binding,publicConfig,profile,handoff});
  const save=async(suffix,data,pin=true)=>{data={...data,configHash:identities[suffix]};const checksum=hash(data);await writeFile(binding.statePath+suffix,JSON.stringify({...data,checksum}));if(pin){handoff.legacyJournals=handoff.legacyJournals.filter(x=>x.suffix!==suffix);handoff.legacyJournals.push({suffix,checksum,configHash:data.configHash});}};
  for(const suffix of ['','.rng','.scheduler'])await save(suffix,state);
  let pendingNonce=0,boundaryHash=block.hash,active=ZeroHash;
  let checkpoint=block.hash;
  const provider={getBlock:async n=>({...block,hash:n==='finalized'?block.hash:boundaryHash}),getTransactionCount:async(a,tag)=>tag==='pending'?pendingNonce:0,call:async tx=>tx.data.slice(0,10)===id('cutoffHashes(uint256)').slice(0,10)?checkpoint:active};
  const run=()=>inspectFirstPonsHandoff({entry,binding,migration,handoff,provider,config,publicConfig,profile});
  assert.equal((await run()).mode,'first-migration');
  // The offline preparation command creates exactly these pins, without a signer/RPC.
  const files={bindingFile:binding,schedulerFile:config,migrationFile:migration,publicConfigFile:publicConfig,publicProfileFile:profile};
  const project={id:'qianqi',adapter:'qianqi'};
  for(const [key,value] of Object.entries(files)){project[key]=join(dir,key+'.json');await writeFile(project[key],JSON.stringify(value));}
  const host=join(dir,'host.json'),source=join(dir,'evidence.json'),output=join(dir,'handoff.json');
  await writeFile(host,JSON.stringify({projects:[project]}));await writeFile(source,JSON.stringify({...evidence,legacyRpcIdentity:handoff.legacyRpcIdentity}));
  const args=[resolve('scripts/prepare-pons-handoff.mjs'),host,'qianqi',source,output];
  const prepared=spawnSync(process.execPath,args,{encoding:'utf8',timeout:15000,windowsHide:true});assert.equal(prepared.status,0,prepared.stderr);
  assert.deepEqual(JSON.parse(await readFile(output,'utf8')),handoff);
  assert.equal(spawnSync(process.execPath,args,{encoding:'utf8',timeout:15000,windowsHide:true}).status,1);
  for(const suffix of ['','.rng','.scheduler','.lock','.rng.lock','.tmp']){
   const path=entry.stateFile+suffix;await writeFile(path,'{"checksum":"stale"}');await assert.rejects(run(),/reconciliation/);await rm(path);
  }
  await save('.scheduler',{...state,jobs:{SHORT:[{started:true}],MONTHLY:[]}});await assert.rejects(run(),/reconciliation/);await save('.scheduler',state);
  await save('.rng',{...state,pending:{transactionHash:ZeroHash}});await assert.rejects(run(),/reconciliation/);await save('.rng',state);
  await save('',{...state,extra:'changed'},false);await assert.rejects(run(),/reconciliation/);await save('',state);
  pendingNonce=1;await assert.rejects(run(),/reconciliation/);pendingNonce=0;
  boundaryHash=ZeroHash;await assert.rejects(run(),/reconciliation/);boundaryHash=block.hash;
  active=block.hash;await assert.rejects(run(),/reconciliation/);active=ZeroHash;
  handoff.boundary={...block,number:49};await assert.rejects(run(),/reconciliation/);handoff.boundary=block;
  assert.equal((await run()).mode,'first-migration');
  const candidate={number:40,hash:block.hash};await save('.scheduler',{...state,cutoffs:{SHORT:candidate}});
  await assert.rejects(run(),/reconciliation/);
  handoff.retainedCheckpoints=[{kind:'SHORT',candidate,disposition:'preserve-history-only'}];
  const before=await readFile(binding.statePath+'.scheduler','utf8');
  assert.deepEqual((await run()).retainedCheckpoints,handoff.retainedCheckpoints);
  assert.equal(await readFile(binding.statePath+'.scheduler','utf8'),before);
  checkpoint=ZeroHash;await assert.rejects(run(),/reconciliation/);checkpoint=block.hash;
  active=block.hash;await assert.rejects(run(),/reconciliation/);active=ZeroHash;
  handoff.retainedCheckpoints[0].candidate={...candidate,number:41};await assert.rejects(run(),/reconciliation/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
