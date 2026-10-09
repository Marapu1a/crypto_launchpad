// Internal one-pass process. Never logs RPC errors or credentials.
const {indexOnce}=require('./persistent-buy-indexer.cjs');
const {httpRpc}=require('./public-rpc-qualification.cjs');
process.once('message',async({config})=>{
 let result;
 try{result={ok:true,status:await indexOnce({config,statePath:config.indexer.statePath,rpc:httpRpc(process.env.RH_RPC_URL),...(process.env.RH_INDEXER_BATCH_SIZE?{batchSize:Number(process.env.RH_INDEXER_BATCH_SIZE)}:{})})};
  if(process.env.SHARED_QIANQI_INDEXER_BINDING)await (await import('../../read-model.mjs')).publishConfiguredSnapshot(config);
 }
 catch(e){const storage=['SCHEDULER_STORAGE_ERROR','EACCES','EPERM','ENOSPC','EROFS','EIO'].includes(e.code)||!!e.cleanupErrors;result={ok:false,attention:!!e.lock||storage||e instanceof SyntaxError||/checksum\/config|Invalid scheduler state/.test(e.message),reason:e.lock?'indexerLock':storage?'storageError':e instanceof SyntaxError||/checksum\/config|Invalid scheduler state/.test(e.message)?'invalidState':'readOrValidationFailed'};}
 process.send(result,()=>process.disconnect());
});
