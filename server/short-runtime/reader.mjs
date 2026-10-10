// Share only raw historical scan data within one pass. Canonicality checks,
// latest/finalized observations, contract calls and financial receipts stay fresh.
export function sharedScanProvider(provider,{maxEntries=2048,maxBytes=16*1024*1024}={}){
 const cache=new Map();let bytes=0,hits=0,misses=0;
 const send=async(method,args)=>{
  const eligible=(method==='eth_getBlockByNumber'&&/^0x[0-9a-f]+$/i.test(args[0])&&args[1]===true)||
   (method==='eth_getTransactionReceipt'&&/^0x[0-9a-f]{64}$/i.test(args[0]));
  if(!eligible)return provider.send(method,args);
  const key=JSON.stringify([method,args]);let entry=cache.get(key);
  if(entry){hits++;return structuredClone(await entry.promise);}
  misses++;entry={size:0};
  entry.promise=Promise.resolve().then(()=>provider.send(method,args)).then(value=>{
   if(!value){cache.delete(key);return value;}
   if(cache.get(key)!==entry)return value;
   entry.size=Buffer.byteLength(JSON.stringify(value));bytes+=entry.size;
   while(cache.size>maxEntries||bytes>maxBytes){const [old,v]=cache.entries().next().value;cache.delete(old);bytes-=v.size;}
   return value;
  }).catch(error=>{if(cache.get(key)===entry)cache.delete(key);throw error;});
  cache.set(key,entry);return structuredClone(await entry.promise);
 };
 const view=new Proxy(provider,{get(target,key){if(key==='send')return send;const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
 return {provider:view,stats:()=>({hits,misses,entries:cache.size,bytes})};
}
