import config from '../../scripts/rpc-config.cjs';
import {check} from './ticket-shadow.mjs';
// Per-cycle limits; no URL/credentials in captures or error output.
export function liveReads(save=()=>{}){
 const {url}=config.resolveRpc();let calls=0,next=0;const deadline=Date.now()+300000;
 return {
  rpc:async(method,params)=>{
   check(++calls<=2000&&Date.now()<deadline,'Live read budget exceeded');
   check(['eth_chainId','eth_call','eth_getCode','eth_getLogs','eth_getBlockByNumber','eth_getTransactionReceipt','eth_getTransactionByHash'].includes(method),'Read-only method rejected');
   const delay=Math.max(0,next-Date.now());next=Math.max(next,Date.now())+160;await new Promise(r=>setTimeout(r,delay));
   const response=await fetch(method==='eth_getLogs'?config.PUBLIC_RPC:url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:calls,method,params}),signal:AbortSignal.timeout(20000)});
   check(response.ok,`RPC HTTP ${response.status}`);const body=await response.json();check(!body.error&&body.result!=null,'Live RPC read failed');save('rpc',{method,params,result:body.result});return body.result;
  },
  getJson:async path=>{
   check(/^\/(v1\/|evidence\/purchases\/)/.test(path)&&Date.now()<deadline,'Invalid public path or deadline');
   const response=await fetch('https://qianqi.site'+path,{cache:'no-store',signal:AbortSignal.timeout(20000)});check(response.ok,'Live API read failed');const data=await response.json();save('api',{path,data});return data;
  }
 };
}
