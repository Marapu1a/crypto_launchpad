// Offline pinning only; this document never grants permission to send.
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createRequire} from 'node:module';
import {digest} from '../src/tickets/digest.mjs';
import {validateMigration} from '../server/adapters/qianqi/pons-migration.mjs';
import {legacyJournalIdentities} from '../server/adapters/qianqi/pons-handoff.mjs';
const {hash}=createRequire(import.meta.url)('../server/adapters/qianqi/runtime/scripts/direct-buy.cjs');
const [configuration,projectId,evidenceFile,output,...extra]=process.argv.slice(2);
if(extra.length||![configuration,evidenceFile,output].every(p=>isAbsolute(p??''))||!projectId)throw Error('Usage: node scripts/prepare-pons-handoff.mjs ABS_CONFIG PROJECT_ID ABS_EVIDENCE ABS_NEW_OUTPUT');
const read=async f=>JSON.parse(await readFile(f,'utf8'));
const config=await read(configuration),entry=config.projects?.find(p=>p.id===projectId&&p.adapter==='qianqi');
if(!entry)throw Error('QIANQI project required');
const binding=await read(entry.bindingFile),migration=validateMigration(await read(entry.migrationFile)),evidence=await read(evidenceFile);
// Evidence: {lifecycle,legacyCredits,rewards,legacyRpcIdentity}; omit endpoint URLs/credentials.
const {legacyRpcIdentity,...legacyEvidence}=evidence;
if(digest(legacyEvidence)!==migration.legacyHash)throw Error('Migration evidence mismatch');
const handoff={schema:'qianqi-pons-first-handoff-v1',mode:'first-migration',bindingHash:hash(binding),migrationChecksum:migration.checksum,legacyHash:migration.legacyHash,boundary:migration.boundary,schedulerHash:digest(await read(entry.schedulerFile)),legacyEvidence,legacyRpcIdentity,legacyJournals:[]};
const identities=legacyJournalIdentities({binding,publicConfig:await read(entry.publicConfigFile),profile:await read(entry.publicProfileFile),handoff});
for(const suffix of ['','.rng','.scheduler']){
 const file=binding.statePath+suffix;let stat;
 try{stat=await lstat(file);}catch(e){if(e.code!=='ENOENT'||suffix==='')throw e;handoff.legacyJournals.push({suffix,checksum:null,configHash:null});continue;}
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('Regular legacy journal required');
 const {checksum,...state}=await read(file);
 if(checksum!==hash(state)||state.configHash!==identities[suffix])throw Error('Legacy journal identity mismatch');
 handoff.legacyJournals.push({suffix,checksum,configHash:state.configHash});
}
await writeFile(output,JSON.stringify(handoff,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Offline handoff pins saved. Read-only inspection still required; no activation authorized.');
