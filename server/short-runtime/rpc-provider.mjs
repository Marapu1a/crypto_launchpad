import {FetchRequest,JsonRpcProvider} from 'ethers';
import rpcGate from '../shared/rpc-gate.cjs';
import {boundedRequest} from '../shared/rpc-transport.cjs';
import {AsyncLocalStorage} from 'node:async_hooks';

// Share the gate across primary and trace endpoints: they may use one account.
export const requestGate=rpcGate.createRpcGate;
export function runtimeProvider(url,{gate=requestGate(),timeout=15000,meter,networkCheckMs=1000,now=Date.now}={}){
 if(!Number.isSafeInteger(networkCheckMs)||networkCheckMs<0||networkCheckMs>1000)throw Error('Invalid network check interval');
 const request=boundedRequest(new FetchRequest(url));request.timeout=timeout;
 const reservations=new AsyncLocalStorage();let network,pendingNetwork,checkedAt=0;
 class PacedProvider extends JsonRpcProvider{
  async _detectNetwork(){
   if(network&&now()>=checkedAt&&now()-checkedAt<networkCheckMs)return network.clone();
   if(!pendingNetwork)pendingNetwork=super._detectNetwork().then(n=>{network=n;checkedAt=now();return n;}).finally(()=>{pendingNetwork=null;});
   return (await pendingNetwork).clone();
  }
  async withRpcReservation(count,run){
   if(reservations.getStore())throw Error('Nested RPC reservation');
   if(!gate.reserve)return run(this);
   const reserved=await gate.reserve(count);
   return reservations.run(reserved,()=>run(this));
  }
  async _send(payload){await (reservations.getStore()??gate)(payload);const requests=Array.isArray(payload)?payload:[payload];try{const results=await super._send(payload);for(const req of requests)meter?.record(req.method,results.some(r=>r.id===req.id&&!r.error));return results;}catch(error){for(const req of requests)meter?.record(req.method,false);throw error;}}
 }
 return new PacedProvider(request,undefined,{cacheTimeout:-1,batchMaxCount:1});
}
