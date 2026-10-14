import {FetchRequest,JsonRpcProvider} from 'ethers';
import rpcGate from '../shared/rpc-gate.cjs';
import {boundedRequest} from '../shared/rpc-transport.cjs';

// Share the gate across primary and trace endpoints: they may use one account.
export const requestGate=rpcGate.createRpcGate;
export function runtimeProvider(url,{gate=requestGate(),timeout=15000,meter}={}){
 const request=boundedRequest(new FetchRequest(url));request.timeout=timeout;
 class PacedProvider extends JsonRpcProvider{
  async _send(payload){await gate(payload);const requests=Array.isArray(payload)?payload:[payload];try{const results=await super._send(payload);for(const req of requests)meter?.record(req.method,results.some(r=>r.id===req.id&&!r.error));return results;}catch(error){for(const req of requests)meter?.record(req.method,false);throw error;}}
 }
 return new PacedProvider(request,undefined,{cacheTimeout:-1,batchMaxCount:1});
}
