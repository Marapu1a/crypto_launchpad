// Bound RPC starts for the public executor. Never retry a failed request or send.
function paceProvider(provider,{intervalMs=120,wait=ms=>new Promise(r=>setTimeout(r,ms)),gate}={}){
 if(!Number.isInteger(intervalMs)||intervalMs<1)throw Error('Invalid RPC interval');
 if(gate){
  const {boundedRequest}=require('../../../../shared/rpc-transport.cjs');
  if(typeof provider._getConnection==='function'){
   const connection=provider._getConnection.bind(provider);
   provider._getConnection=()=>boundedRequest(connection());
  }
  const send=provider._send.bind(provider);
  provider._send=async payload=>{await gate(payload);return send(payload);};
  return provider;
 }
 const send=provider.send.bind(provider);let queue=Promise.resolve();
 provider.send=(...args)=>{const result=queue.then(()=>wait(intervalMs)).then(()=>send(...args));queue=result.catch(()=>{});return result;};
 return provider;
}
module.exports={paceProvider};
