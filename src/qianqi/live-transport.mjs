import config from '../../scripts/rpc-config.cjs';
import {check} from './ticket-shadow.mjs';
// Per-cycle limits; endpoint credentials never enter captures or error output.
export function liveReads(save=()=>{},{env=process.env,fetchImpl=fetch}={}){
 const {url}=config.resolveRpc({env});
 const logsUrl=env.PONS_LOGS_RPC?.trim()||config.PUBLIC_RPC;
 const logRange=Number(env.PONS_LOGS_MAX_BLOCKS??90000);
 check(Number.isSafeInteger(logRange)&&logRange>=1&&logRange<=90000,'Invalid log RPC block limit');
 try{const parsed=new URL(logsUrl);if(!['https:','http:'].includes(parsed.protocol)||/\s/.test(logsUrl))throw Error();}
 catch{throw Error('Invalid PONS_LOGS_RPC configuration');}
 let calls=0,next=0,logsChecked=false;const deadline=Date.now()+300000;
 async function read(method,params,endpoint){
  check(++calls<=2000&&Date.now()<deadline,'Live read budget exceeded');
  const delay=Math.max(0,next-Date.now());next=Math.max(next,Date.now())+160;await new Promise(r=>setTimeout(r,delay));
  const response=await fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:calls,method,params}),signal:AbortSignal.timeout(20000)});
  check(response.ok,`RPC HTTP ${response.status}`);const body=await response.json();check(!body.error&&body.result!=null,'Live RPC read failed');save('rpc',{method,params,result:body.result});return body.result;
 }
 return {
  rpc:async(method,params)=>{
   check(['eth_chainId','eth_call','eth_getCode','eth_getLogs','eth_getBlockByNumber','eth_getTransactionReceipt','eth_getTransactionByHash'].includes(method),'Read-only method rejected');
   if(method==='eth_getLogs'&&!logsChecked){check(BigInt(await read('eth_chainId',[],logsUrl))===4663n,'Wrong log RPC chain');logsChecked=true;}
   if(method==='eth_getLogs'){
    const filter=params[0];
    check(params.length===1&&/^0x[0-9a-f]+$/i.test(filter?.fromBlock)&&/^0x[0-9a-f]+$/i.test(filter?.toBlock),'Explicit log block range required');
    const from=BigInt(filter.fromBlock),to=BigInt(filter.toBlock),step=BigInt(logRange);
    check(to>=from&&to-from<1000000n,'Invalid log block range');
    if(to-from+1n>step){
     const result=[];
     for(let start=from;start<=to;start+=step){
      const end=start+step-1n<to?start+step-1n:to;
      const rows=await read(method,[{...filter,fromBlock:'0x'+start.toString(16),toBlock:'0x'+end.toString(16)}],logsUrl);
      check(Array.isArray(rows),'Invalid log RPC response');result.push(...rows);
      check(result.length<=500,'Live event budget exceeded');
     }
     // Preserve the logical request too, so existing offline replay can reproduce it.
     save('rpc',{method,params,result});return result;
    }
   }
   return read(method,params,method==='eth_getLogs'?logsUrl:url);
  },
  getJson:async path=>{
   check(/^\/(v1\/|evidence\/purchases\/)/.test(path)&&Date.now()<deadline,'Invalid public path or deadline');
   const response=await fetchImpl('https://qianqi.site'+path,{cache:'no-store',signal:AbortSignal.timeout(20000)});check(response.ok,'Live API read failed');const data=await response.json();save('api',{path,data});return data;
  }
 };
}
