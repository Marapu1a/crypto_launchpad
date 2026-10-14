import {readFile,lstat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {inProject,verifyRole} from '../shared/store.mjs';
import {digest} from '../../src/tickets/digest.mjs';
import {validateDrawPolicy} from '../../src/worker/draw-policy.mjs';
import {validatePolicy} from '../../src/worker/production-policy.mjs';
import {loadExecutorKeystore} from '../../src/worker/executor-keystore.mjs';
import {UUID} from '../../src/launch/template.mjs';
import {validateAdapters} from '../../src/tickets/deferred-recognition.mjs';

const check=(v,m)=>{if(!v)throw Error(m);};
export async function privateText(file){
 check(typeof file==='string'&&isAbsolute(file),'Absolute credential path required');
 const s=await lstat(file);check(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=65536,'Invalid credential file');
 if(process.platform!=='win32')check((s.mode&0o077)===0,'Credential file must be private');
 return (await readFile(file,'utf8')).trim();
}
export function validateRuntimeConfig(c){
 check(['short-runtime-config-v1','draw-runtime-config-v2'].includes(c?.schema)&&['rehearsal','production'].includes(c.mode),'Invalid runtime config');
 check(Number.isInteger(c.intervalMs)&&c.intervalMs>=1000&&c.intervalMs<=300000,'Invalid interval');
 check(c.economy===undefined||typeof c.economy==='boolean','Invalid economy setting');
 if(c.rpcBudget!==undefined){
  check(c.rpcBudget&&(c.rpcBudget.file===undefined||typeof c.rpcBudget.file==='string'&&isAbsolute(c.rpcBudget.file)),'Absolute RPC budget path required');
  check(c.rpcBudget&&Number.isSafeInteger(c.rpcBudget.maxRequests)&&c.rpcBudget.maxRequests>0,'Invalid RPC request budget');
  check(Number.isSafeInteger(c.rpcBudget.windowMs)&&c.rpcBudget.windowMs>=1000,'Invalid RPC budget window');
 }
 check(Number.isInteger(c.concurrency)&&c.concurrency>=1&&c.concurrency<=2,'Invalid concurrency');
 check(Array.isArray(c.projects)&&c.projects.length<=8,'At most eight projects in this runtime');
 for(const key of ['rpcFile','databaseFile','healthFile'])check(typeof c[key]==='string'&&isAbsolute(c[key]),'Absolute runtime paths required');
 for(const [key,max] of [['readLogBlockRange',1000],['readScanBlockLimit',5000]])if(c[key]!==undefined)check(c.readRpcFile&&Number.isInteger(c[key])&&c[key]>=1&&c[key]<=max,'Invalid read scan limits');
 if(c.readRpcFile!==undefined)check(c.schema==='draw-runtime-config-v2'&&typeof c.readRpcFile==='string'&&isAbsolute(c.readRpcFile),'Absolute v2 read RPC path required');
 if(c.traceRpcFile!==undefined)check(c.schema==='draw-runtime-config-v2'&&typeof c.traceRpcFile==='string'&&isAbsolute(c.traceRpcFile),'Absolute v2 trace RPC path required');
 if(c.recognitionAdapters!==undefined){check(c.schema==='draw-runtime-config-v2','Adapter selection requires v2');validateAdapters(c.recognitionAdapters);}
 if(c.mode==='rehearsal')check(typeof c.instanceId==='string'&&c.instanceId.length>0,'Fork instance required');
 const ids=new Set();
 for(const p of c.projects){
  check(UUID.test(p.projectId)&&UUID.test(p.moduleId)&&!ids.has(p.projectId),'Invalid/duplicate project');ids.add(p.projectId);
  check(typeof p.enabled==='boolean'&&/^[0-9a-f]{64}$/.test(p.policyHash),'Explicit activation and policy hash required');
  for(const role of ['executor','publisher'])for(const k of ['keyFile','passwordFile'])check(typeof p[role]?.[k]==='string'&&isAbsolute(p[role][k]),'Per-role key paths required');
  if(c.mode==='production'&&p.enabled)check(c.allowPublicTransactions===true,'Public sends require explicit operator activation');
 }
 return c;
}
export async function runtimeEnvironment(provider,config){
 check((await provider.getNetwork()).chainId===4663n,'Wrong runtime chain');
 if(config.mode==='rehearsal'){
  const meta=await provider.send('hardhat_metadata',[]);
  check(meta.instanceId===config.instanceId&&Number(meta.chainId)===4663,'Wrong rehearsal instance');
 }
}
export async function loadRuntimeProject({pool,provider,signerProvider=provider,config,entry,loadKey=loadExecutorKeystore,readSecret=privateText}){
 await verifyRole(pool,'lp_executor');
 const policy=await inProject(pool,entry.projectId,async c=>{
  const {rows:[r]}=await c.query('SELECT s.policy_text,s.policy_hash,m.adapter_version,m.config_hash FROM launchpad.production_senders s JOIN launchpad.module_instances m ON m.project_id=s.project_id AND m.id=s.module_id WHERE s.project_id=$1 AND s.module_id=$2',[entry.projectId,entry.moduleId]);
  check(r&&r.adapter_version===(config.schema==='draw-runtime-config-v2'?'draw-candidate-v2':'production-candidate-v1')&&r.policy_hash===entry.policyHash&&r.config_hash===entry.policyHash,'Runtime registration mismatch');
  const p=JSON.parse(r.policy_text);check(digest(p)===entry.policyHash&&p.projectId===entry.projectId,'Runtime policy checksum');(config.schema==='draw-runtime-config-v2'?validateDrawPolicy:validatePolicy)(p);return p;
 });
 const keys={};
 for(const role of ['executor','publisher'])keys[role]=await loadKey({file:entry[role].keyFile,password:await readSecret(entry[role].passwordFile),expectedAddress:policy[role],provider:signerProvider});
 return {policySchema:policy.schema,recognitionAdapters:config.recognitionAdapters,projectId:entry.projectId,moduleId:entry.moduleId,enabled:entry.enabled,pool,provider,nativeFloor:policy.limits.nativeFloor,signer:keys.executor,publisher:keys.publisher,
  guard:async()=>{
   await runtimeEnvironment(provider,config);
   await inProject(pool,entry.projectId,async c=>{const {rows:[r]}=await c.query('SELECT policy_hash FROM launchpad.production_senders WHERE project_id=$1 AND module_id=$2',[entry.projectId,entry.moduleId]);check(r?.policy_hash===entry.policyHash,'Activated policy changed');});
  }};
}
