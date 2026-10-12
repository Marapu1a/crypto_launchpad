// Only execution tracing may use a second read-only endpoint. Chain reads and
// all broadcasts remain on the configured primary provider.
export async function withTraceProvider(primary,trace){
 if((await primary.getNetwork()).chainId!==4663n)throw Error('Wrong primary chain');
 return new Proxy(primary,{get(target,key){
  if(key==='send')return async(method,args)=>{
   if(method!=='debug_traceTransaction')return target.send(method,args);
   // An optional trace outage must not prevent startup or canonical discovery.
   // Validate before each use, including recovery from an unavailable endpoint.
   if((await trace.getNetwork()).chainId!==4663n)throw Error('Wrong trace chain');
   return trace.send(method,args);
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
}
