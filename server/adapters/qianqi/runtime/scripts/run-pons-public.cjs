// Explicit public entrypoint. Encrypted keystore only; no private key argument.
const fs=require('node:fs'),{ethers}=require('ethers');
function diagnostics(r){
 const failures=[];
 for(const lane of ['scheduler','settlement','rng'])for(const kind of ['SHORT','MONTHLY']){
  const row=r.results?.[lane]?.results?.[kind];if(row?.status!=='error')continue;
  failures.push({lane,kind,code:['PONS_PUBLIC_ADMISSION','MODULE_NOT_FOUND','CALL_EXCEPTION','SCHEDULER_STORAGE_ERROR'].includes(row.code)?row.code:'runtimeError',admission:row.admissionReasons,
   ...(['estimate','broadcast','confirm'].includes(row.stage)?{stage:row.stage}:{}),
   ...(Object.values(require('./pons-public-execution.cjs').ACTIONS).flat().includes(row.action)?{action:row.action}:{}),
   ...(/^0x[0-9a-f]{8}$/i.test(row.revertSelector||'')?{revertSelector:row.revertSelector}:{}),
   ...(['feeBelowBase','insufficientNative'].includes(row.rpcReason)?{rpcReason:row.rpcReason}:{})});
 }
 return {admission:r.admissionReasons||r.results?.fundingAdmission,failures};
}
async function main(){
 await require('../../fence.cjs').checkFence({required:true});
 const args=process.argv.slice(2),o={},flags=new Set(['--watch','--drain']);
 for(let i=0;i<args.length;i++){const k=args[i];if(!['--config','--profile','--state','--keystore',...flags].includes(k)||o[k]!==undefined)throw Error('Invalid arguments');o[k]=flags.has(k)?true:args[++i];if(o[k]===undefined)throw Error('Missing value');}
 for(const k of ['--config','--profile','--state','--keystore'])if(typeof o[k]!=='string')throw Error('Required config, profile, state and encrypted keystore');
 const credentials=require('./service-credentials.cjs');
 const url=new URL(process.env.CREDENTIALS_DIRECTORY?credentials.rpc():process.env.RH_RPC_URL);if(url.protocol!=='https:'||url.username||url.password)throw Error('Public HTTPS required');
 const c=JSON.parse(fs.readFileSync(o['--config'],'utf8')),p=JSON.parse(fs.readFileSync(o['--profile'],'utf8'));
 require('./pons-automation.cjs').validate(c,{publicMode:true});require('./pons-public-profile.cjs').validate(p,c);
 const password=process.env.CREDENTIALS_DIRECTORY?credentials.readCredential('executor-password'):process.env.QIANQI_KEYSTORE_PASSWORD;
 if(!password)throw Error('Keystore password required');
 delete process.env.QIANQI_KEYSTORE_PASSWORD;
 const wallet=await ethers.Wallet.fromEncryptedJson(fs.readFileSync(o['--keystore'],'utf8'),password);
 if(wallet.address.toLowerCase()!==c.executor.toLowerCase())throw Error('Wrong executor');
 const request=new ethers.FetchRequest(url.href);request.timeout=20000;
 const provider=require('./pace-public-rpc.cjs').paceProvider(new ethers.JsonRpcProvider(request,undefined,{cacheTimeout:-1})),executor=wallet.connect(provider),stop=new AbortController();
 const halt=()=>stop.abort();process.once('SIGINT',halt);process.once('SIGTERM',halt);
 try{await require('./ops-session.cjs').withOpsSession(o['--state'],async ops=>{
  do{
   ops.beforePass();const r=await require('./pons-automation.cjs').runPonsAutomation({provider,executor,config:c,publicProfile:p,rpcUrl:url.href,statePath:o['--state'],signal:stop.signal,drain:!!o['--drain']});
   ops.publish(r);
   // Child modules may carry provider errors. Emit only the sanitized operational projection.
   console.log(JSON.stringify({status:r.status,publicExecution:true,steps:r.steps.length,...diagnostics(r),operational:require('./pons-delay-status.cjs').explain(r)}));
   if(['blocked','error'].includes(r.status)){process.exitCode=1;break;}
   if(!o['--watch']||stop.signal.aborted)break;
   await require('./pons-cadence.cjs').pause(require('./pons-cadence.cjs').delayMs(r,c.pollSeconds),stop.signal);
  }while(!stop.signal.aborted);
 },{publicExecution:true});}finally{provider.destroy();process.removeListener('SIGINT',halt);process.removeListener('SIGTERM',halt);}
}
if(require.main===module)main().catch(()=>{console.error('Public Pons execution stopped. Check configuration, access and saved journals.');process.exitCode=1;});
module.exports={main,diagnostics};
