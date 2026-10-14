// Opt-in cache of successful read-only verification at an immutable block hash.
// Callers still fetch chain, current head and anchor, and recheck canonicality.
const enabled=new WeakMap();
export function enableVerificationCache(provider){enabled.set(provider,new Map());}
export function cachedVerification(provider,key,block){
 const entry=enabled.get(provider)?.get(key);
 return entry?.blockHash===block.hash&&entry.blockNumber===block.number?structuredClone(entry):null;
}
export function rememberVerification(provider,key,result){
 const cache=enabled.get(provider);if(!cache)return;
 if(!cache.has(key)&&cache.size>=8)cache.delete(cache.keys().next().value);
 cache.set(key,structuredClone(result));
}
