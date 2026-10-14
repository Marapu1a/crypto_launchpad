// Read-only release qualification. No keystores, signers, broadcasts or state reset.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {runtimeProvider} from '../server/short-runtime/rpc-provider.mjs';
import {privateText,validateRuntimeConfig} from '../server/short-runtime/config.mjs';
import {createPool,inProject,verifyRole} from '../server/shared/store.mjs';
import {verifyDrawPolicy} from '../src/worker/draw-policy.mjs';
import {advancePonsAccounting} from '../src/tickets/pons-accounting.mjs';
import {creditedPurchases} from '../src/tickets/draw-ledger.mjs';
import {advanceMigration} from '../server/adapters/qianqi/pons-migration.mjs';
import {buildPonsPublicSnapshot} from '../server/adapters/qianqi/pons-projection.mjs';
import {withQianqiExecutor} from '../server/adapters/qianqi/executor.mjs';
import {inspectFirstPonsHandoff} from '../server/adapters/qianqi/pons-handoff.mjs';
import {digest} from '../src/tickets/digest.mjs';
import budget from '../server/shared/rpc-budget.cjs';
const require=createRequire(import.meta.url),read=async f=>JSON.parse(await readFile(f,'utf8'));
const [input,output,...extra]=process.argv.slice(2);
if(!input||!output||extra.length)throw Error('Usage: node scripts/inspect-pons-runtime.mjs CONFIG_JSON NEW_REPORT_JSON');
const config=await read(resolve(input));
if(config.schema!=='pons-runtime-config-v1'||config.mode!=='production'||!config.rpcBudget?.file||!Array.isArray(config.allowedRpcHosts))throw Error('Explicit production inspection configuration required');
const gate=budget.persistentRpcGate(config.rpcBudget),results=[];
for(const entry of config.projects){
 let provider,pool;const result={id:entry.id,adapter:entry.adapter,status:'blocked'};results.push(result);
 try{
  const c=entry.adapter==='draw-v2'?validateRuntimeConfig(await read(entry.runtimeConfigFile)):await read(entry.schedulerFile);
  const url=await privateText(entry.adapter==='draw-v2'?c.rpcFile:entry.rpcFile),u=new URL(url);
  if(u.protocol!=='https:'||u.username||u.password||!config.allowedRpcHosts.includes(u.hostname)||/quicknode|quiknode/i.test(u.hostname))throw Error('Unapproved RPC');
  provider=runtimeProvider(url,{gate});
  const transport=provider._send.bind(provider);provider._send=payload=>{
   for(const q of Array.isArray(payload)?payload:[payload])if(!['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_call','eth_getCode','eth_getStorageAt','eth_getBalance','eth_getTransactionCount','eth_getTransactionReceipt','eth_getTransactionByHash'].includes(q.method))throw Error('Inspection RPC method denied');
   return transport(payload);
  };
  if((await provider.getNetwork()).chainId!==4663n)throw Error('Wrong chain');
  const head=await provider.getBlock('finalized');if(!head)throw Error('Missing finality');
  const source=await read(entry.reportFile),now=Math.floor(Date.now()/1000);
  pool=createPool(await privateText(entry.adapter==='draw-v2'?c.databaseFile:entry.databaseFile));await verifyRole(pool,'lp_executor');
  if(entry.adapter==='draw-v2'){
   const selected=c.projects.find(p=>p.projectId===entry.id&&p.enabled);if(!selected)throw Error('Project not enabled');
   const row=await inProject(pool,entry.id,async db=>(await db.query('SELECT policy_text,policy_hash,state_text,state_hash FROM launchpad.production_senders WHERE project_id=$1 AND module_id=$2',[entry.id,selected.moduleId])).rows[0]);
   const policy=JSON.parse(row.policy_text),state=JSON.parse(row.state_text);
   if(digest(policy)!==row.policy_hash||digest(state)!==row.state_hash||selected.policyHash!==row.policy_hash||state.pending||state.runtime?.operation||state.runtime?.publisher?.pending)throw Error('State requires reconciliation');
   await verifyDrawPolicy(provider,policy);
   advancePonsAccounting({policy,report:source,prior:state.runtime?.ponsAccounting,legacyCredits:state.runtime?.ledger?creditedPurchases(policy,state.runtime.ledger):[],head:{number:head.number,hash:head.hash,timestamp:head.timestamp},now});
  }else if(entry.adapter==='qianqi'){
   const binding=await read(entry.bindingFile),publicConfig=await read(entry.publicConfigFile),profile=await read(entry.publicProfileFile);
   if(binding.projectId!==entry.id||binding.token.toLowerCase()!==c.scheduler.manifest.token.toLowerCase())throw Error('Binding mismatch');
   const inspect=require('../server/adapters/qianqi/runtime/scripts/pons-public-profile.cjs').inspect;
   const admission=await inspect(provider,profile,publicConfig);if(admission.status!=='matched'){result.admissionReasons=admission.reasons;throw Error('Public admission refused');}
   await withQianqiExecutor(pool,binding,async()=>{
    const initial=await read(entry.migrationFile);
    await inspectFirstPonsHandoff({entry,binding,migration:initial,handoff:await read(entry.handoffFile),provider,config:c,publicConfig,profile});
    const migration=advanceMigration({state:initial,report:source,head:{number:head.number,hash:head.hash,timestamp:head.timestamp},now});
    if(Object.values(migration.ledger.pending).some(Boolean))throw Error('Frozen legacy job requires explicit import');
    await buildPonsPublicSnapshot({provider,config:c.scheduler,migration,mode:'production'});
   });
  }else throw Error('Unknown adapter');
  result.status='qualified';result.finalizedBlock=head.number;
 }catch(error){result.reason=error.code==='RPC_BUDGET_EXHAUSTED'?'rpc-budget-exhausted':'configuration-source-state-or-rpc-check-failed';}
 finally{provider?.destroy();await pool?.end();}
}
const report={schema:'pons-release-inspection-v1',checkedAt:new Date().toISOString(),configurationHash:digest(config),authorizationToSend:false,status:results.length&&results.every(r=>r.status==='qualified')?'qualified':'blocked',projects:results,rpcBudget:gate.snapshot()};
await writeFile(resolve(output),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));if(report.status!=='qualified')process.exitCode=1;
