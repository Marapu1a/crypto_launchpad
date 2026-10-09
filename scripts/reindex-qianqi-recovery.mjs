// Rebuild only a new offline copy to the canonical PG checkpoint. Never rewinds PG.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {toQuantity} from 'ethers';
import {inspectNativeBackup,sha} from '../server/adapters/qianqi/recovery.mjs';
import {rpcTransport,readOnlyRpc} from '../server/adapters/qianqi/recovery-chain.mjs';
const require=createRequire(import.meta.url),{indexOnce}=require('../server/adapters/qianqi/runtime/scripts/persistent-buy-indexer.cjs');
const {backup}=require('../ops/qianqi/native-backup.cjs');
const {withState}=require('../server/adapters/qianqi/runtime/scripts/local-scheduler-state.cjs');
const {inspectSavedState}=await import('../server/adapters/qianqi/adoption.mjs');
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
let phase='input';
try{
 const [inputFile,pairReport,resume]=process.argv.slice(2);if(process.argv.length!==4&&!(process.argv.length===5&&resume==='--resume'))throw Error();
 const input=JSON.parse(fs.readFileSync(inputFile)),prior=JSON.parse(fs.readFileSync(pairReport));
 const stage=fs.realpathSync(input.stagingRoot);
 if(!/^\/var\/lib\/postgresql\/qianqi-recovery-[a-z0-9-]+$/.test(stage)||!fs.realpathSync(input.nativeRoot).startsWith(stage+'/'))throw Error();
 const target=prior.pair?.pgHead;if(!target||prior.pair.generation!=='pg-newer')throw Error();
 const source=input.artifacts.find(a=>a.kind==='native-archive');
 if(sha(fs.readFileSync(source.file))!==source.sha256)throw Error();
 const binding=JSON.parse(fs.readFileSync(input.bindingFile));
 if(sha(fs.readFileSync(input.bindingFile))!==input.bindingSha256)throw Error();
 const rpcUrl=fs.readFileSync(path.join(process.env.CREDENTIALS_DIRECTORY,'rpc-url'),'utf8').trim();
 phase='native';const native=inspectNativeBackup({root:input.nativeRoot,binding,rpcUrl});
 phase='target';
 const rpc=rpcTransport(rpcUrl),finalized=await rpc('eth_getBlockByNumber',['finalized',false]);
 const block=await rpc('eth_getBlockByNumber',[toQuantity(target.number),false]);
 if(block?.hash!==target.hash||BigInt(target.number)>BigInt(finalized.number)||BigInt(target.number)<=BigInt(native.projection.head.number)||BigInt(target.number)-BigInt(native.projection.head.number)>16000n)throw Error();
 phase='work-copy';const work=path.join(stage,'reindex-work');
 if(!resume){if(fs.existsSync(work))throw Error();fs.cpSync(path.join(input.nativeRoot,'state'),work,{recursive:true,errorOnExist:true,force:false});}
 const statePath=path.join(work,path.basename(native.indexConfig.indexer.statePath));
 if(fs.realpathSync(work)!==work||fs.realpathSync(statePath)!==statePath)throw Error();
 phase='work-integrity';inspectSavedState(statePath,native.identities[3].configHash,{indexer:true,sender:binding.sender});
 // The supplied finalized view is a verified canonical ancestor of the real
 // finalized head. No block/hash is invented and the original config is unchanged.
 const bounded=readOnlyRpc((method,params)=>method==='eth_getBlockByNumber'&&params[0]==='finalized'?Promise.resolve(block):rpc(method,params));
 phase='index';let status={processedBlock:JSON.parse(fs.readFileSync(statePath)).index.head};
 for(let pass=0;pass<16&&status.processedBlock!==Number(target.number);pass++){
  status=await indexOnce({config:native.indexConfig,statePath,rpc:bounded,batchSize:1000,reorgLimit:0});
  console.log(JSON.stringify({pass:pass+1,processedBlock:status.processedBlock,targetBlock:target.number}));
  if(status.processedBlock===Number(target.number))break;
 }
 if(status.processedBlock!==Number(target.number)||(await rpc('eth_getBlockByNumber',[toQuantity(target.number),false])).hash!==target.hash)throw Error();
 // A historical target is not "caught up" to today's chain. Keep the copied API
 // explicitly stale until a real current index pass replaces this status.
 phase='mark-stale';await withState(statePath,{kind:'persistent-buy-indexer-v1',config:native.indexConfig},async(state,save)=>{state.status.state='recoverySnapshot';save(state);},{indexerFormat:true});
 phase='financial-integrity';const unchangedFinancialStates=[];
 for(const suffix of ['', '.scheduler','.rng']){
  const name=path.basename(binding.statePath)+suffix;
  if(fs.realpathSync(path.join(work,name))!==path.join(work,name))throw Error();
  if(sha(fs.readFileSync(path.join(work,name)))!==native.files[name])throw Error();
  unchangedFinancialStates.push({name,sha256:native.files[name]});
 }
 phase='archive';const stamp=new Date().toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d+Z$/,'Z');
 const output=path.join(stage,stamp),manifest=backup(work,output);
 fs.cpSync(path.join(input.nativeRoot,'config'),path.join(output,'config'),{recursive:true,errorOnExist:true,force:false});
 const archive=output+'.tar.gz';execFileSync('tar',['-czf',archive,'-C',stage,stamp]);
 const derivation={schema:'qianqi-native-reconstruction-v1',parentArchiveSha256:source.sha256,targetHead:target,unchangedFinancialStates,configRewritten:false,pgRewritten:false};
 const suffix=resume?'-'+stamp:'';
 write(path.join(stage,'reindex-report'+suffix+'.json'),derivation);
 write(path.join(stage,'reindexed-inputs'+suffix+'.json'),{...input,nativeRoot:output,derivation,artifacts:input.artifacts.map(a=>a.kind==='native-archive'?{kind:a.kind,file:archive,sha256:sha(fs.readFileSync(archive)),capturedAt:manifest.createdAt}:a)});
 console.log('RECONSTRUCTED_OFFLINE_COPY; sender not started');
}catch(e){console.error(JSON.stringify({status:'RECONSTRUCTION_BLOCKED',phase,code:typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'READ_OR_VALIDATION_FAILED',rpc:e.rpc}));process.exitCode=2;}
