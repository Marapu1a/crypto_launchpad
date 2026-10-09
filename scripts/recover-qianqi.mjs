// Usage: node scripts/recover-qianqi.mjs /absolute/staging/inputs.json /absolute/new-report.json
// Run against a restored DB only. This entrypoint can neither sign nor start a service.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {execFileSync} from 'node:child_process';
import {inspectNativeBackup,readRecoveryDatabase,inspectPair,recoveryDecision,sha} from '../server/adapters/qianqi/recovery.mjs';
import {inspectRecoveryChain,rpcTransport} from '../server/adapters/qianqi/recovery-chain.mjs';
const [inputFile,output]=process.argv.slice(2);
let pool,report,validatedOutput=false;
try{
 if(process.argv.length!==4||!path.isAbsolute(inputFile)||!path.isAbsolute(output)||fs.existsSync(output))throw Error('RECOVERY_ARGUMENTS');
 const input=JSON.parse(fs.readFileSync(inputFile));
 if(input.schema!=='qianqi-recovery-input-v1'||!/^launchpad_recovery_[a-z0-9_]+$/.test(input.database)||!Array.isArray(input.artifacts)||input.artifacts.length!==2)throw Error('RECOVERY_INPUT_INVALID');
 if(input.artifacts.map(x=>x.kind).sort().join(',')!=='database-dump,native-archive')throw Error('RECOVERY_ARTIFACTS_INVALID');
 const staging=fs.realpathSync(input.stagingRoot);
 if(!/^\/var\/lib\/postgresql\/qianqi-recovery-[a-z0-9-]+$/.test(staging))throw Error('RECOVERY_STAGING_REQUIRED');
 const inStage=file=>fs.realpathSync(file).startsWith(staging+path.sep);
 if(!inStage(input.nativeRoot)||!inStage(input.bindingFile)||!input.artifacts.every(a=>inStage(a.file))||!fs.realpathSync(path.dirname(output)).startsWith(staging+path.sep)&&fs.realpathSync(path.dirname(output))!==staging)throw Error('RECOVERY_STAGING_REQUIRED');
 validatedOutput=true;
 const artifacts=input.artifacts.map(a=>{
  if(!path.isAbsolute(a.file)||!/^[0-9a-f]{64}$/.test(a.sha256)||sha(fs.readFileSync(a.file))!==a.sha256)throw Error('RECOVERY_ARCHIVE_CHECKSUM');
  return {kind:a.kind,file:path.basename(a.file),sha256:a.sha256,capturedAt:a.capturedAt};
 });
 const binding=JSON.parse(fs.readFileSync(input.bindingFile));
 if(sha(fs.readFileSync(input.bindingFile))!==input.bindingSha256)throw Error('RECOVERY_BINDING_CHECKSUM');
 const archive=input.artifacts.find(a=>a.kind==='native-archive');
 if(!/^\d{8}T\d{6}Z\.tar\.gz$/.test(path.basename(archive.file)))throw Error('RECOVERY_ARCHIVE_NAME');
 const prefix=path.basename(archive.file).replace(/\.tar\.gz$/,'');
 for(const relative of ['manifest.json',...['configFile','profileFile','indexConfigFile'].map(k=>'config/'+path.basename(binding[k]))]){
  const bytes=execFileSync('tar',['-xOf',archive.file,prefix+'/'+relative],{maxBuffer:8*1024*1024,stdio:['ignore','pipe','ignore']});
  if(sha(bytes)!==sha(fs.readFileSync(path.join(input.nativeRoot,relative))))throw Error('RECOVERY_EXTRACTED_ARCHIVE_MISMATCH');
 }
 const artifactBytes=fs.readFileSync(input.compiledFile);
 if(sha(artifactBytes)!==input.compiledSha256)throw Error('RECOVERY_RUNTIME_CHECKSUM');
 const rpcUrl=fs.readFileSync(path.join(process.env.CREDENTIALS_DIRECTORY,'rpc-url'),'utf8').trim();
 const native=inspectNativeBackup({root:input.nativeRoot,binding,rpcUrl});
 pool=new pg.Pool({host:'/var/run/postgresql',user:'postgres',database:input.database,max:1,connectionTimeoutMillis:5000,
  options:'-c default_transaction_read_only=on -c statement_timeout=15000'});
 const db=await readRecoveryDatabase(pool,binding.projectId),pair=inspectPair(native,db);
 report={pair,manifest:{schema:'qianqi-backup-set-v1',atomic:false,
  sampledAt:new Date().toISOString(),artifacts,nativeCapturedAt:native.capturedAt,
  runtime:{commit:input.runtimeCommit,compiledSha256:input.compiledSha256},binding:native.evidence,derivation:input.derivation??null,
  nativeFiles:native.files,stateIdentities:native.identities,pgViewHash:db.view.view_hash,
  instances:{short:native.config.lifecycle.instanceId,monthly:native.config.lifecycle.monthlyInstanceId},
  chainAnchor:native.config.manifest.anchor,note:'Archive times differ. Chain observations are fresh recovery samples, not historical backup-time nonce assertions.'}};
 const chain=await inspectRecoveryChain(native,pair,rpcTransport(rpcUrl),JSON.parse(artifactBytes));
 report={...report,...recoveryDecision(pair,chain)};
}catch(e){
 // Never expose RPC URLs, credentials, signed payloads, SQL or exception messages.
 const code=/^[A-Z][A-Z0-9_]+$/.test(e.code??'')?e.code:/^RECOVERY_[A-Z_]+$/.test(e.message??'')?e.message:'RECOVERY_VALIDATION_FAILED';
 report={...report,schema:'qianqi-recovery-preflight-v1',status:'BLOCKED',executionAllowed:false,issues:[...(report?.pair?.issues??[]),code],...(e.rpc?{rpc:e.rpc}:{})};
}finally{await pool?.end();}
if(!validatedOutput||!output||!path.isAbsolute(output)||fs.existsSync(output)){console.error(JSON.stringify({status:'BLOCKED',executionAllowed:false,issues:report.issues,note:'Validated staging output required; no report file written'}));process.exitCode=1;}
else{
 const fd=fs.openSync(output,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(report,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 console.log(JSON.stringify({status:report.status,executionAllowed:false,issues:report.issues,generation:report.pair?.generation,nonce:report.chain?.nonce,rpc:report.rpc}));
 process.exitCode=report.status==='BLOCKED'?2:0;
}
