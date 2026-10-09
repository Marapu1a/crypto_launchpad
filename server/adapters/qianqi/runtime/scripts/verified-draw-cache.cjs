// Process-local proofs only. No writer-supplied/durable "verified" flag is accepted.
const {createHash}=require('node:crypto'),{ethers}=require('ethers');
const slots=new WeakMap(),coder=ethers.AbiCoder.defaultAbiCoder();
function canonical(x){
 if(typeof x==='bigint')return 'bigint:'+x;
 if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';
 if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
 return JSON.stringify(x);
}
const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
function freeze(x){if(x&&typeof x==='object'){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;}
async function block(provider,tag){
 const b=await provider.send('eth_getBlockByNumber',[typeof tag==='number'?ethers.toQuantity(tag):tag,false]);
 if(!b?.hash)throw Error('Verified draw anchor unavailable');
 return {number:Number(BigInt(b.number)),hash:b.hash};
}
function clear(provider,kind){slots.get(provider)?.delete(kind);}
function validate(provider,kind,input,check){
 // Scheduler walks old terminal jobs too: checking them must not evict the active proof.
 try{const entry=slots.get(provider)?.get(kind);return entry?.fingerprint===digest(input)?entry.handle.job.artifact:check(input);}
 catch(e){clear(provider,kind);throw e;}
}
function get(provider,kind,input,validate){
 if(!['SHORT','MONTHLY'].includes(kind))throw Error('Invalid draw cache kind');
 let map=slots.get(provider);if(!map){map=new Map();slots.set(provider,map);}
 let fingerprint;
 try{fingerprint=digest(input);}catch(e){clear(provider,kind);throw e;}
 if(map.get(kind)?.fingerprint===fingerprint)return map.get(kind).handle;
 clear(provider,kind);
 const job=structuredClone(input);validate(job);freeze(job);
 let proof,result,prefix={count:0,root:ethers.id(kind+'_DATASET_V1'),attempts:0n};
 const handle=Object.freeze({
  job,
  prefix(count){
   const ps=job.artifact.snapshot.participants;
   if(!Number.isSafeInteger(count)||count<0||count>ps.length)throw Error('Invalid publication count');
   if(count<prefix.count)prefix={count:0,root:ethers.id(kind+'_DATASET_V1'),attempts:0n};
   while(prefix.count<count){const p=ps[prefix.count++];prefix.root=ethers.keccak256(coder.encode(['bytes32','address','uint128','uint128'],[prefix.root,p.wallet,p.firstAttempt,p.lastAttempt]));prefix.attempts+=BigInt(p.count);}
   return {...prefix};
  },
  async publication(binding,readBinding,load){
   const key=digest(binding);
   try{
    if(proof){
     if((await block(provider,proof.anchor.number)).hash!==proof.anchor.hash)throw Error('Verified draw anchor changed; full verification required');
     if(proof.key===key)return proof.value;
    }
    proof=undefined;result=undefined;
    const anchor=await block(provider,'latest');
    if(digest(await readBinding(anchor.number))!==key)throw Error('Draw changed during verification');
    const value=structuredClone(await load(anchor.number));let offset=0;
    for(const p of value.publications){p.offset=offset;offset+=p.count;}
    if(offset!==job.artifact.snapshot.participants.length)throw Error('Incomplete verified publication');
    if((await block(provider,anchor.number)).hash!==anchor.hash)throw Error('Verified draw anchor changed during verification');
    proof={key,anchor,value:freeze(structuredClone(value))};return proof.value;
   }catch(e){clear(provider,kind);proof=undefined;result=undefined;throw e;}
  },
  expected(identity,compute){const key=digest(identity);if(result?.key!==key)result={key,value:freeze(structuredClone(compute()))};return result.value;},
 });
 map.set(kind,{fingerprint,handle});return handle;
}
async function guarded(provider,kind,run){
 try{return await run();}catch(e){
  // An ordinary coordinator yield before broadcast is not a failed evidence check.
  // Retain the proof, but the next invocation must still recheck its canonical anchor.
  if(!(e.code==='LOCAL_BUDGET_WAIT'&&e.stage==='estimate'))clear(provider,kind);
  throw e;
 }
}
module.exports={get,validate,clear,guarded};
