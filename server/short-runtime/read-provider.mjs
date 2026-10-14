// Optional read endpoint. Signing, nonce, fee estimation, receipt tracking and
// broadcasting stay on the original provider. No automatic retry of sends.
const RPC_READS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getLogs','eth_getCode','eth_getStorageAt','eth_getBalance','eth_call','eth_getTransactionByHash','eth_getTransactionReceipt']);
const METHODS=new Set(['getNetwork','getBlockNumber','getBlock','getLogs','getCode','getStorage','getBalance','call','getTransaction']);
export async function withReadProvider(primary,reader,{logBlockRange=1000,scanBlockLimit=5000}={}){
 if(!Number.isInteger(logBlockRange)||logBlockRange<1||logBlockRange>1000||!Number.isInteger(scanBlockLimit)||scanBlockLimit<1||scanBlockLimit>5000)throw Error('Invalid read scan limits');
 if((await reader.getNetwork()).chainId!==4663n)throw Error('Wrong read chain');
 return new Proxy(primary,{get(target,key){
  if(key==='discoveryLimits')return {logBlockRange,scanBlockLimit};
  if(key==='getReadTransactionReceipt')return reader.getTransactionReceipt.bind(reader);
  if(key==='send')return (method,args)=>RPC_READS.has(method)?reader.send(method,args):target.send(method,args);
  if(key==='destroy')return ()=>{target.destroy();reader.destroy();};
  const owner=METHODS.has(key)?reader:target,value=Reflect.get(owner,key);
  return typeof value==='function'?value.bind(owner):value;
 }});
}
