import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { id,keccak256,Transaction } from 'ethers';
const require=createRequire(import.meta.url);
const {hash}=require('./runtime/scripts/direct-buy.cjs');
const {validate,schedulerConfigFor}=require('./runtime/scripts/pons-automation.cjs');
const {validIndexerChecksum}=require('./runtime/scripts/indexer-checksum.cjs');
const normalize=v=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):typeof v==='string'&&/^0x[0-9a-fA-F]+$/.test(v)?v.toLowerCase():v;
const check=(ok,message)=>{if(!ok)throw Error(message);};

export function inspectSavedState(file,expectedHash,{indexer=false,sender}={}){
 const bytes=fs.readFileSync(file),{checksum,...state}=JSON.parse(bytes);
 check(state.schema==='local-scheduler-state-v1'&&state.configHash===expectedHash&&(indexer?validIndexerChecksum(state,checksum):hash(state)===checksum),'Saved state identity/checksum mismatch');
 check(Array.isArray(state.jobs?.SHORT)&&Array.isArray(state.jobs?.MONTHLY),'Saved lane state missing');
 if(state.pending){
  const p=state.pending;
  check(/^0x[0-9a-fA-F]{64}$/.test(p.transactionHash??'')&&Number.isSafeInteger(p.nonce)&&p.nonce>=0,'Unresolved unsigned intent requires reconciliation');
  if(p.signedTransaction){
   const tx=Transaction.from(p.signedTransaction);
   check(keccak256(p.signedTransaction)===p.transactionHash&&tx.nonce===p.nonce&&tx.chainId===4663n&&tx.from?.toLowerCase()===sender?.toLowerCase()&&tx.to?.toLowerCase()===p.target?.toLowerCase()&&tx.data.toLowerCase()===p.data?.toLowerCase()&&tx.value===BigInt(p.value??0),'Saved signed intent mismatch');
  }
 }
 return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),configHash:state.configHash,pending:!!state.pending,shortJobs:state.jobs.SHORT.length,monthlyJobs:state.jobs.MONTHLY.length};
}

// Read-only adoption. Keep filenames/config hashes exactly as the old executor used them.
// Never create empty state, rewrite identities, clear locks or discard pending operations.
export function inspectAdoption(binding,rpcUrl,{requireStopped=true}={}){
 check(binding?.schema==='existing-qianqi-v1'&&/^[0-9a-f-]{36}$/.test(binding.projectId??'')&&binding.chainId==='4663','Invalid QIANQI binding');
 for(const key of ['configFile','profileFile','indexConfigFile','statePath','keystoreFile'])check(path.isAbsolute(binding[key]??''),'Absolute existing paths required');
 const c=JSON.parse(fs.readFileSync(binding.configFile)),p=JSON.parse(fs.readFileSync(binding.profileFile)),index=JSON.parse(fs.readFileSync(binding.indexConfigFile));
 validate(c,{publicMode:true});require('./runtime/scripts/pons-public-profile.cjs').validate(p,c);
 check(hash(c)===binding.configHash&&hash(p)===binding.profileHash&&hash(index)===binding.indexConfigHash,'Pinned configuration changed');
 check(c.executor.toLowerCase()===binding.sender.toLowerCase()&&c.manifest.token.toLowerCase()===binding.token.toLowerCase()&&String(c.manifest.chainId)==='4663','QIANQI deployment binding mismatch');
 const scheduler=schedulerConfigFor(c);
 require('./runtime/scripts/shared-index-config.cjs').validateIndexConfig(scheduler,index);
 const url=new URL(rpcUrl);check(url.protocol==='https:'&&!url.username&&!url.password,'Public HTTPS RPC required');
 const identity={config:c,rpcUrl:{origin:url.origin,endpointHash:id(rpcUrl)},sender:c.executor,publicProfile:p,executionScope:'public'};
 const files=[
  [binding.statePath,hash(identity),false],
  [binding.statePath+'.scheduler',hash(scheduler),false],
  [binding.statePath+'.rng',hash(normalize({worker:'drand-delivery-v1',job:c.deliveryJob,sender:c.executor})),false],
  [index.indexer.statePath,hash({kind:'persistent-buy-indexer-v1',config:index}),true],
 ];
 if(requireStopped)for(const [file,,indexer]of files)if(!indexer)for(const suffix of ['.lock','.service.lock'])check(!fs.existsSync(file+suffix),'Existing owner or unresolved lock; do not adopt');
 const states=files.map(([file,expected,indexer])=>inspectSavedState(file,expected,{indexer,sender:c.executor}));
 return {schema:'qianqi-adoption-check-v1',bindingHash:hash(binding),states,pendingStates:states.filter(s=>s.pending).length};
}
