// Offline files + SELECT-only database + explicitly allowlisted RPC. No execution imports.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {id} from 'ethers';
import {inspectSavedState} from './adoption.mjs';
import {projectSnapshot} from './read-model.mjs';
const require=createRequire(import.meta.url);
const {hash}=require('./runtime/scripts/direct-buy.cjs');
const {validate,schedulerConfigFor}=require('./runtime/scripts/pons-automation.cjs');
const normalize=v=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):typeof v==='string'&&/^0x[0-9a-fA-F]+$/.test(v)?v.toLowerCase():v;
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function inside(root,relative){
 check(!path.isAbsolute(relative)&&!relative.split(/[\\/]/).includes('..'),'UNSAFE_RESTORE_PATH');
 const resolved=fs.realpathSync(path.join(root,relative));
 check(resolved.startsWith(root+path.sep)&&fs.statSync(resolved).isFile(),'UNSAFE_RESTORE_PATH');
 return resolved;
}
export function inspectNativeBackup({root,binding,rpcUrl}){
 root=fs.realpathSync(root);
 const manifest=read(inside(root,'manifest.json'));
 check(manifest.schema==='qianqi-offline-backup-v1'&&manifest.files&&Object.keys(manifest.files).length,'NATIVE_MANIFEST_INVALID');
 const files={};
 for(const [name,expected] of Object.entries(manifest.files)){
  const file=inside(root,'state/'+name);check(sha(fs.readFileSync(file))===expected,'NATIVE_ARCHIVE_CHECKSUM');files[name]=expected;
 }
 const actual=[];
 function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);check(!entry.isSymbolicLink(),'UNSAFE_RESTORE_PATH');
  if(entry.isDirectory())visit(file);else{check(entry.isFile(),'UNSAFE_RESTORE_PATH');actual.push(path.relative(path.join(root,'state'),file).split(path.sep).join('/'));}
 }}
 visit(path.join(root,'state'));check(JSON.stringify(actual.sort())===JSON.stringify(Object.keys(files).sort()),'NATIVE_EXTRA_OR_MISSING_FILES');
 // The original paths remain part of identities; remap reads only, never rewrite configHash.
 const c=read(inside(root,'config/'+path.basename(binding.configFile)));
 const profile=read(inside(root,'config/'+path.basename(binding.profileFile)));
 const indexConfig=read(inside(root,'config/'+path.basename(binding.indexConfigFile)));
 validate(c,{publicMode:true});require('./runtime/scripts/pons-public-profile.cjs').validate(profile,c);
 check(hash(c)===binding.configHash&&hash(profile)===binding.profileHash&&hash(indexConfig)===binding.indexConfigHash,'PINNED_CONFIG_MISMATCH');
 check(binding.chainId==='4663'&&c.executor.toLowerCase()===binding.sender.toLowerCase()&&c.manifest.token.toLowerCase()===binding.token.toLowerCase(),'NATIVE_BINDING_MISMATCH');
 const scheduler=schedulerConfigFor(c);
 require('./runtime/scripts/shared-index-config.cjs').validateIndexConfig(scheduler,indexConfig);
 const url=new URL(rpcUrl);check(url.protocol==='https:'&&!url.username&&!url.password,'RPC_IDENTITY_INVALID');
 const names=[path.basename(binding.statePath),path.basename(binding.statePath)+'.scheduler',path.basename(binding.statePath)+'.rng',path.basename(indexConfig.indexer.statePath)];
 const expected=[hash({config:c,rpcUrl:{origin:url.origin,endpointHash:id(rpcUrl)},sender:c.executor,publicProfile:profile,executionScope:'public'}),hash(scheduler),hash(normalize({worker:'drand-delivery-v1',job:c.deliveryJob,sender:c.executor})),hash({kind:'persistent-buy-indexer-v1',config:indexConfig})];
 const states=[],identities=[];
 for(let i=0;i<names.length;i++){
  check(files[names[i]],'STATE_NOT_IN_MANIFEST');
  check(!Object.keys(files).some(n=>n.endsWith('.lock')||n.endsWith('.tmp')),'NATIVE_LOCK_OR_TEMP');
  const file=inside(root,'state/'+names[i]);
  identities.push(inspectSavedState(file,expected[i],{indexer:i===3,sender:binding.sender}));states.push(read(file));
 }
 const projection=projectSnapshot(indexConfig,fs.readFileSync(inside(root,'state/'+names[3]),'utf8'));
 return {binding,config:c,profile,indexConfig,states,projection,identities,files,capturedAt:manifest.createdAt,
  evidence:{manifestSha256:sha(fs.readFileSync(inside(root,'manifest.json'))),configHash:binding.configHash,profileHash:binding.profileHash,indexConfigHash:binding.indexConfigHash,bindingHash:hash(binding)}};
}

export async function readRecoveryDatabase(pool,projectId){
 const c=await pool.connect();
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await c.query("SELECT set_config('launchpad.project_id',$1,true)",[projectId]);
  const one=async table=>(await c.query(`SELECT * FROM launchpad.${table} WHERE ${table==='projects'?'id':'project_id'}=$1`,[projectId])).rows[0];
  const result={project:await one('projects'),executor:await one('qianqi_executors'),view:await one('qianqi_api_views')};
  await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export function inspectPair(native,db){
 const {binding,projection}=native,issues=[];
 const add=(ok,code)=>{if(!ok)issues.push(code);};
 add(db.project?.id===binding.projectId&&String(db.project?.chain_id)==='4663'&&db.project?.token_address?.toLowerCase()===binding.token.toLowerCase(),'DB_PROJECT_MISMATCH');
 add(db.executor?.binding_hash===native.evidence.bindingHash&&db.executor?.sender?.toLowerCase()===binding.sender.toLowerCase()&&String(db.executor?.chain_id)==='4663','DB_EXECUTOR_MISMATCH');
 add(db.view?.config_hash===binding.indexConfigHash,'DB_CONFIG_MISMATCH');
 const valid=typeof db.view?.view_text==='string'&&sha(db.view.view_text)===db.view.view_hash;
 add(valid,'DB_VIEW_CHECKSUM');
 let head=null;
 if(valid){
  try{const body=JSON.parse(db.view.view_text);head=body.view.ledger.head;
   add(body.schema==='qianqi-public-view-v1'&&String(head.number)===String(db.view.head_number)&&head.hash===db.view.head_hash,'DB_VIEW_HEAD_MISMATCH');
  }catch{issues.push('DB_VIEW_INVALID');}
 }
 let generation='invalid';
 if(head){
  generation=Number(head.number)>Number(projection.head.number)?'pg-newer':Number(head.number)<Number(projection.head.number)?'native-newer':'equal';
  if(generation!=='equal')issues.push(generation==='pg-newer'?'PG_AHEAD_REINDEX_NATIVE':'PG_BEHIND_REPUBLISH_AFTER_RECONCILIATION');
  else{
   add(head.hash===projection.head.hash,'PAIR_BRANCH_CONFLICT');
   // Replay time and pass metrics can differ after reconstruction. Financial/public
   // content, identities and evidence mode must still match exactly.
   const content=text=>{const p=JSON.parse(text);delete p.view.index?.observedAt;
    p.view.state={evidenceMode:p.view.state?.status?.evidenceMode??null};return hash(p);};
   add(content(db.view.view_text)===content(projection.text),'PAIR_CONTENT_CONFLICT');
  }
 }
 return {issues:[...new Set(issues)],generation,nativeHead:projection.head,pgHead:head,pgViewHash:db.view?.view_hash??null,byteIdentical:db.view?.view_hash===projection.hash};
}

export function recoveryDecision(pair,chain){
 const issues=[...new Set([...pair.issues,...chain.issues])];
 return {schema:'qianqi-recovery-preflight-v1',status:issues.length?'BLOCKED':'READ_ONLY_RECONCILED',
  executionAllowed:false,issues,pair,chain,
  next:issues.length?'Reconcile isolated copies; never reset head, state, nonce, locks or intents to bypass a conflict.':'Read-only reconciliation passed. Sender still requires current on-chain recheck, stopped old writer and normal lease/adoption guards; this report is not a start permit.'};
}
