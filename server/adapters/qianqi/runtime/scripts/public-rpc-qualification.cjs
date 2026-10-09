// Bounded read-only qualification. No signer, retry, deployment or execution permission.
const fs=require('node:fs'),{ethers}=require('ethers');
const {inspectHistoricalRpc}=require('./public-rpc-check.cjs');
const {hash,replay}=require('./direct-buy.cjs');
const {scanWithRpc}=require('./replay-direct-buy.cjs');
const METHODS=new Set(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call','eth_getStorageAt','eth_getTransactionReceipt','eth_getLogs']);
const check=(v,m)=>{if(!v)throw Error(m);};
function measuredRpc(send,{maxRequests=1000}={}){
 check(Number.isSafeInteger(maxRequests)&&maxRequests>0&&maxRequests<=10000,'Invalid request budget');
 const stats={requests:0,failures:0,responseBytes:0,elapsedMs:0,methods:{}};
 return {stats,rpc:async(method,params=[])=>{
  check(METHODS.has(method),'Read-only method required');check(stats.requests<maxRequests,'Request budget exhausted');
  stats.requests++;stats.methods[method]=(stats.methods[method]||0)+1;const start=performance.now();
  try{const result=await send(method,params);check(result!=null,'Missing RPC result');stats.responseBytes+=Buffer.byteLength(JSON.stringify(result));return result;}
  catch(e){stats.failures++;throw e;}finally{stats.elapsedMs+=Math.round(performance.now()-start);}
 }};
}
function httpRpc(url,{timeoutMs=15000}={}){
 const parsed=new URL(url);check(['http:','https:'].includes(parsed.protocol),'HTTP RPC required');let id=0;
 return async(method,params)=>{
  const requestId=++id;let response;try{response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:AbortSignal.timeout(timeoutMs)});}catch{throw Object.assign(Error('RPC transport failure or timeout'),{code:'RPC_READ_UNAVAILABLE'});}
  if([408,429,502,503,504].includes(response.status))throw Object.assign(Error('RPC HTTP '+response.status),{code:'RPC_READ_UNAVAILABLE'});
  check(response.ok,'RPC HTTP '+response.status);let data;try{data=await response.json();}catch{throw Error('Invalid RPC JSON');}
  // Do not echo provider messages: they may include credential-bearing URLs.
  check(data.id===requestId,'RPC response id mismatch');if(data.error)throw Error('RPC error code '+data.error.code);return data.result;
 };
}
async function readBlockEvidence(rpc,number){
 const tag=ethers.toQuantity(number),block=await rpc('eth_getBlockByNumber',[tag,true]);
 check(BigInt(block.number)===BigInt(number)&&ethers.isHexString(block.hash,32)&&Array.isArray(block.transactions),'Invalid full block');
 const receipts=[];
 for(let i=0;i<block.transactions.length;i++){
  const tx=block.transactions[i];check(tx&&typeof tx==='object'&&BigInt(tx.transactionIndex)===BigInt(i)&&tx.blockHash===block.hash&&BigInt(tx.blockNumber)===BigInt(number),'Invalid transaction provenance');
  const r=await rpc('eth_getTransactionReceipt',[tx.hash]);
  check(r.transactionHash===tx.hash&&r.blockHash===block.hash&&BigInt(r.blockNumber)===BigInt(number)&&BigInt(r.transactionIndex)===BigInt(i)&&Array.isArray(r.logs),'Invalid receipt provenance');
  receipts.push(r);
 }
 const logs=receipts.flatMap(r=>r.logs);
 for(let i=0;i<logs.length;i++)check(!logs[i].removed&&logs[i].blockHash===block.hash&&BigInt(logs[i].blockNumber)===BigInt(number)&&BigInt(logs[i].logIndex)===BigInt(i)&&receipts.some(r=>r.transactionHash===logs[i].transactionHash&&BigInt(r.transactionIndex)===BigInt(logs[i].transactionIndex)),'Invalid log provenance');
 const queried=await rpc('eth_getLogs',[{fromBlock:tag,toBlock:tag}]);
 const normalized=items=>items.map(l=>({address:l.address.toLowerCase(),topics:l.topics.map(t=>t.toLowerCase()),data:l.data.toLowerCase(),blockHash:l.blockHash.toLowerCase(),transactionHash:l.transactionHash.toLowerCase(),logIndex:String(BigInt(l.logIndex))})).sort((a,b)=>Number(BigInt(a.logIndex)-BigInt(b.logIndex)));
 check(hash(normalized(queried))===hash(normalized(logs)),'Logs differ from full receipts');
 check((await rpc('eth_getBlockByNumber',[tag,false])).hash===block.hash,'Canonical block changed');
 return {number:tag,blockHash:block.hash,transactions:receipts.length,logs:logs.length,evidenceHash:hash({block,receipts})};
}
async function qualify({rpc,depths=[0,10000,864000],previous=null,manifest=null,toBlock=null}){
 const out={schema:'public-rpc-qualification-v1',observedAt:new Date().toISOString(),publicLaunchReady:false,repeatable:false,samples:[],replay:{status:'not-run',reason:'No admitted project deployment or suitable reference manifest supplied'}};
 out.history=await inspectHistoricalRpc({rpc,depths});
 if(out.history.error){out.error=out.history.error;return out;}
 const numbers=previous?previous.samples.map(s=>s.number):out.history.observations.map(s=>s.number);
 check(numbers.length>0&&numbers.length<=4,'Invalid prior sample count');
 for(const n of numbers){const row={number:n};out.samples.push(row);try{
  check(BigInt(n)<=BigInt(out.history.finalized.number),'Sample not finalized');Object.assign(row,await readBlockEvidence(rpc,n));row.ok=true;
 }catch(e){row.ok=false;row.error=e.message;}}
 if(previous){
  check(previous.schema===out.schema,'Wrong previous evidence schema');
  out.repeatable=out.samples.every((s,i)=>s.ok&&previous.samples[i]?.ok&&s.evidenceHash===previous.samples[i].evidenceHash);
 }
 out.sampledDataAvailable=out.history.historicalReadsAvailable&&out.samples.every(s=>s.ok);
 if(manifest){try{
  check(manifest.schema==='direct-buy-infinity-v1'&&String(manifest.chainId)==='4663','Public Infinity reference required');
  const end=BigInt(toBlock),start=BigInt(manifest.anchor.number);
  check(end>start&&end-start<=32n&&end<=BigInt(out.history.finalized.number),'Replay range must be finalized and 1..32 blocks');
  const input=await scanWithRpc(manifest,rpc,end),ledger=replay(input.manifest,input.blocks),digest=hash(ledger);
  check(hash(replay(input.manifest,[...input.blocks,...input.blocks]))===digest,'Duplicate delivery changes ledger');
  out.replay={status:'sample-complete',manifestHash:hash(manifest),toBlock:String(end),ledgerHash:digest,decisions:ledger.decisions.length,eligible:ledger.decisions.filter(d=>d.status==='ELIGIBLE').length,wallets:ledger.wallets};
  if(previous?.replay?.status==='sample-complete')out.replay.repeatable=previous.replay.manifestHash===out.replay.manifestHash&&previous.replay.toBlock===out.replay.toBlock&&previous.replay.ledgerHash===digest;
 }catch(e){out.replay={status:'failed',error:e.message};}}
 out.limits='Bounded samples, not archive SLA, proof of honest RPC, production policy admission, full project history, or live checkpoint storage. Repeating CLI verifies fresh reads after process restart; it does not qualify worker crash recovery. Empty/no-eligible replay is not BUY coverage.';
 return out;
}
async function main(){
 const [configFile,output]=process.argv.slice(2);check(configFile&&output&&!fs.existsSync(output),'Config and new output path required');
 const config=JSON.parse(fs.readFileSync(configFile,'utf8')),url=process.env.RH_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
 const transport=measuredRpc(httpRpc(url),{maxRequests:config.maxRequests??1000});
 const previous=config.previous?JSON.parse(fs.readFileSync(config.previous,'utf8')):null;
 const manifest=config.manifest?JSON.parse(fs.readFileSync(config.manifest,'utf8')):null;
 const out=await qualify({rpc:transport.rpc,depths:config.depths,previous,manifest,toBlock:config.toBlock});
 out.stats=transport.stats;out.endpointOrigin=new URL(url).origin;
 fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({sampledDataAvailable:out.sampledDataAvailable,repeatable:out.repeatable,replay:out.replay.status,stats:out.stats,error:out.error}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={measuredRpc,httpRpc,readBlockEvidence,qualify};
