// Bound RPC starts for the public executor. Never retry a failed request or send.
function paceProvider(provider,{intervalMs=120,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!Number.isInteger(intervalMs)||intervalMs<1)throw Error('Invalid RPC interval');
 const send=provider.send.bind(provider);let queue=Promise.resolve();
 provider.send=(...args)=>{const result=queue.then(()=>wait(intervalMs)).then(()=>send(...args));queue=result.catch(()=>{});return result;};
 return provider;
}
module.exports={paceProvider};
