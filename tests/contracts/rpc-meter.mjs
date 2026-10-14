import {AsyncLocalStorage} from 'node:async_hooks';
// Count calls crossing the local node boundary, including secondary HTTP readers.
// Never retain parameters, URLs, keys or transaction data. Exclude fixture setup by scope.
export function rpcMeter(node){
 const nested=new AsyncLocalStorage(),original={};let counts=null;
 for(const name of ['send','request']){
  original[name]=node[name];
  node[name]=async function(...args){
   const method=name==='send'?args[0]:args[0].method;
   if(counts&&!nested.getStore())counts[method]=(counts[method]??0)+1;
   return nested.run(true,()=>original[name].apply(this,args));
  };
 }
 return {async measure(action){if(counts)throw Error('Overlapping RPC measurements');const methods={};counts=methods;try{const result=await action();return {result,methods,total:Object.values(methods).reduce((a,b)=>a+b,0)};}finally{counts=null;}},restore(){Object.assign(node,original);}};
}
