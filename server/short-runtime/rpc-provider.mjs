import {FetchRequest,JsonRpcProvider} from 'ethers';

// Share the gate across primary and trace endpoints: they may use one account.
export function requestGate({intervalMs=50,now=()=>Date.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 let tail=Promise.resolve(),last=-Infinity;
 return ()=>{
  const turn=tail.then(async()=>{const delay=last+intervalMs-now();if(delay>0)await sleep(delay);last=now();});
  tail=turn.catch(()=>{});return turn;
 };
}
export function runtimeProvider(url,{gate=requestGate(),timeout=15000}={}){
 const request=new FetchRequest(url);request.timeout=timeout;
 class PacedProvider extends JsonRpcProvider{
  async _send(payload){await gate();return super._send(payload);}
 }
 return new PacedProvider(request,undefined,{cacheTimeout:-1,batchMaxCount:1});
}
