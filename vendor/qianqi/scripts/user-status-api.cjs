// Local read-only HTTP boundary. No signer, RPC credentials or transaction methods.
const fs=require('node:fs'),http=require('node:http');
const {isAddress}=require('ethers');
const {hash}=require('./direct-buy.cjs');
const {validIndexerChecksum}=require('./indexer-checksum.cjs');
const {replayAttempts,createReplayAttempts}=require('./attempt-lifecycle.cjs');
function prepare(config,raw,replay=replayAttempts){
  const {checksum,...state}=JSON.parse(raw);
  if(!validIndexerChecksum(state,checksum)||state.configHash!==hash({kind:'persistent-buy-indexer-v1',config})||state.index?.policyStatus?.mode!=='admitted'||!config.lifecycle)throw Error('Invalid snapshot');
  const index=state.index;
  const expectedRecognition=config.recognition?require('./purchase-recognition.cjs').attach(config.manifest,config.recognition).recognition:null;
  if(hash(index.manifest.recognition??null)!==hash(expectedRecognition))throw Error('Recognition trust mismatch');
  const ledger=replay(index.manifest,config.lifecycle,index.blocks);
  state.status={...state.status,...(index.evidenceMode?{evidenceMode:index.evidenceMode}: {})};
  if(ledger.head.number!==index.head||hash(ledger.buyLedger)!==index.ledgerHash)throw Error('Invalid snapshot');
 let projected=null;
 if(index.rewards){
  projected=require('./reward-observation.cjs').projectRewards(index.blocks,config.lifecycle.vault);
  if(BigInt(index.rewards.blockTag)!==BigInt(index.head)||hash(projected)!==hash({draws:index.rewards.draws,rewards:index.rewards.rewards}))throw Error('Invalid rewards');
 }
 const publicView=require("./public-status.cjs").preparePublic(config,index,ledger,projected);
 const group=(rows,key)=>{const m=new Map();for(const row of rows){const k=key(row)?.toLowerCase();if(k){if(!m.has(k))m.set(k,[]);m.get(k).push(row);}}return m;};
 return {publicView,state:{status:state.status},index:{observedAt:index.observedAt,ledgerHash:index.ledgerHash,rewards:!!index.rewards},ledger:{head:ledger.head},manifestHash:hash(index.manifest),balances:new Map(ledger.wallets.map(w=>[w.wallet,w])),buys:new Map(ledger.buyLedger.wallets.map(w=>[w.wallet,w])),decisions:group(ledger.buyLedger.decisions,d=>d.payer??d.observedSender??d.observedAccount),rewards:projected?group(projected.rewards,r=>r.winner):null};
}
function render(config,view,{wallet,offset=0,limit=25,now=Date.now()}){
 if(wallet===undefined)return require("./public-status.cjs").renderPublic(config,view,{offset,limit,now});
 const {state,index,ledger}=view;
  const age=now-Date.parse(index.observedAt),fresh=['caughtUp','catchingUp'].includes(state.status?.state)&&Number.isFinite(age)&&age>=0&&age<=config.indexer.maxAgeSeconds*1000;
  const address=wallet.toLowerCase(),balance=view.balances.get(address),buy=view.buys.get(address);
  const empty=()=>({mintedTotal:'0',open:'0',frozenByDraw:{},consumedTotal:'0'});
  const decisions=(view.decisions.get(address)??[]);
  const purchases=decisions.slice(offset,offset+limit).map(d=>Object.fromEntries(['transactionHash','blockNumber','blockHash','logIndex','status','reason','grossQuoteRaw','netQuoteDebitRaw','entriesMinted','poolQuoteRaw','routeFeeQuoteRaw','positiveSlippageTokenRaw','observedSender','observedAccount','attribution','userOpHash','entryPoint','recognition','creditedAt'].filter(k=>d[k]!==undefined).map(k=>[k,d[k]])));
  let rewards=null;
  if(index.rewards){
   const rows=view.rewards.get(address)??[];
   rewards={items:rows.slice(offset,offset+limit),offset,limit,total:rows.length,nextOffset:offset+limit<rows.length?offset+limit:null,coverage:'vault-events-and-checkpointed-storage',vault:config.lifecycle.vault};
  }
  return {schema:'promo-wallet-status-v1',status:fresh?'observed':'stale',wallet:address,
   provenance:{chainId:String(config.manifest.chainId),anchor:config.manifest.anchor,head:ledger.head,manifestHash:view.manifestHash,ledgerHash:index.ledgerHash,observedAt:index.observedAt??null,ageSeconds:Number.isFinite(age)?Math.max(0,Math.floor(age/1000)):null,indexerState:state.status?.state??'unknown',targetBlock:state.status?.targetBlock??null,canonicality:'saved-observation-not-live-finality',...require('./project-history.cjs').provenance(state.status?.evidenceMode)},
   balances:{SHORT:balance?.SHORT??empty(),MONTHLY:balance?.MONTHLY??empty(),carryRaw:buy?.carryRaw??'0',entryThresholdRaw:config.manifest.entryThresholdRaw,quoteDecimals:config.manifest.quoteDecimals},
   purchases:{items:purchases,offset,limit,total:decisions.length,nextOffset:offset+purchases.length<decisions.length?offset+purchases.length:null,coverage:decisions.some(d=>d.observedAccount)?'decoded-payer-or-explicit-user-operation-sender-candidates-only; absence-is-not-rejection':decisions.some(d=>d.observedSender)?'decoded-payer-or-explicit-transaction-sender-candidates-only; absence-is-not-rejection':'decoded-payer-attributed-candidates-only; absence-is-not-rejection'},rewards,asset:view.publicView?.asset??null};
}

function validate({wallet,offset=0,limit=25}){
 if((wallet!==undefined&&!isAddress(wallet))||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw Object.assign(Error('Invalid query'),{status:400});
}
const unavailable=wallet=>wallet===undefined?({schema:'promo-overview-v1',status:'unavailable',asset:null,reserves:null,draws:null,history:null,provenance:null}):({schema:'promo-wallet-status-v1',status:'unavailable',wallet:wallet.toLowerCase(),balances:null,purchases:null,rewards:null});
// An uncached reader remains useful for one-shot callers and measurement.
function walletStatus({config,...query}){
 validate(query);
 try{return render(config,prepare(config,fs.readFileSync(config.indexer.statePath,'utf8')),query);}catch{return unavailable(query.wallet);}
}
const generation=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
function createReader(input){
 const config=structuredClone(input),file=config.indexer.statePath;
 let cached=null,key=null,attempts=createReplayAttempts();
 const metrics={loads:0,hits:0,failures:0,loadMs:0,stateBytes:0};
 function read(query){
  validate(query);
  try{
   const current=generation(fs.statSync(file,{bigint:true}));
   if(!cached||current!==key){
    cached=null;key=null;
    const started=performance.now(),fd=fs.openSync(file,'r');let raw,before;
    try{
     before=fs.fstatSync(fd,{bigint:true});raw=fs.readFileSync(fd,'utf8');
     if(generation(before)!==generation(fs.fstatSync(fd,{bigint:true})))throw Error('Snapshot changed');
    }finally{fs.closeSync(fd);}
    const next=prepare(config,raw,attempts);
    if(current!==generation(before)||current!==generation(fs.statSync(file,{bigint:true})))throw Error('Snapshot replaced');
    cached=next;key=current;metrics.loads++;metrics.loadMs=performance.now()-started;metrics.stateBytes=Number(before.size);
   }else metrics.hits++;
   // Callers cannot mutate the prepared snapshot through returned objects.
   return structuredClone(render(config,cached,query));
  }catch{cached=null;key=null;attempts=createReplayAttempts();metrics.failures++;return unavailable(query.wallet);}
 }
 return {read,metrics:()=>({...metrics,buyReplay:attempts.metrics()}),generation:()=>key};
}
// Keep history parsing/replay and the prepared view in one dedicated thread.
// Bound outstanding requests; overload/failure is unavailable, never a stale success.
function createAsyncReader(input,{maxPending=64,timeoutMs=30000}={}){
 const {Worker}=require('node:worker_threads'),path=require('node:path');
 const config=structuredClone(input),pending=new Map();let worker=null,sequence=0,closed=false;
 if(!Number.isInteger(maxPending)||maxPending<1||!Number.isInteger(timeoutMs)||timeoutMs<1)throw Error('Invalid reader limits');
 function finish(id,result){const item=pending.get(id);if(!item)return;pending.delete(id);clearTimeout(item.timer);item.resolve(result);}
 function stop(w){
  if(worker!==w)return;
  worker=null;for(const [id,item] of pending)finish(id,unavailable(item.wallet));
  void w.terminate();
 }
 function start(){
  const w=new Worker(path.join(__dirname,'user-status-worker.cjs'),{workerData:config});worker=w;
  w.on('error',()=>stop(w));w.on('exit',()=>stop(w));
  w.on('message',async({id,result,key})=>{
   if(worker!==w||!pending.has(id))return;
   try{
    // A file replaced while the response was in transit must not appear current.
    if(result.status!=='unavailable'&&generation(await fs.promises.stat(config.indexer.statePath,{bigint:true}))!==key)throw Error();
   }catch{result=unavailable(pending.get(id)?.wallet??result.wallet);}
   if(worker===w)finish(id,result);
  });
  return w;
 }
 function read(query){
  validate(query);
  if(closed||pending.size>=maxPending)return Promise.resolve(unavailable(query.wallet));
  return new Promise(resolve=>{
   let w;try{w=worker??start();}catch{resolve(unavailable(query.wallet));return;}
   const id=++sequence,timer=setTimeout(()=>stop(w),timeoutMs);
   pending.set(id,{resolve,timer,wallet:query.wallet});
   try{w.postMessage({id,query});}catch{stop(w);}
  });
 }
 function close(){closed=true;if(worker)stop(worker);}
 return {read,close};
}
function createServer(config,{health}={}){const reader=config?createAsyncReader(config):{read:async q=>unavailable(q.wallet),close:()=>{}};const server=http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 try{
  if(req.method!=='GET'){res.writeHead(405,{Allow:'GET'});res.end(JSON.stringify({error:'methodNotAllowed'}));return;}
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/healthz'&&health){const status=health();res.writeHead(status.ready?200:503);res.end(JSON.stringify(status));return;}
  const match=/^\/v1\/wallets\/(0x[0-9a-fA-F]{40})$/.exec(u.pathname);
  if(!match&&u.pathname!=='/v1/overview'){res.writeHead(404);res.end(JSON.stringify({error:'notFound'}));return;}
  const o=u.searchParams.get('offset')??'0',l=u.searchParams.get('limit')??'25';
  if([...u.searchParams.keys()].some(k=>!['offset','limit'].includes(k))||u.searchParams.getAll('offset').length>1||u.searchParams.getAll('limit').length>1||!/^\d+$/.test(o)||!/^\d+$/.test(l))throw Object.assign(Error(),{status:400});
  const query={wallet:match?.[1],offset:Number(o),limit:Number(l)};validate(query);
  const result=await reader.read(query);
  res.writeHead(result.status==='unavailable'?503:200);res.end(JSON.stringify(result));
 }catch(e){res.writeHead(e.status===400?400:503);res.end(JSON.stringify({error:e.status===400?'invalidQuery':'unavailable'}));}
});server.on('close',()=>reader.close());return server;}
if(require.main===module){try{
 const [file,portText='8787']=process.argv.slice(2),port=Number(portText);
 if(!file||!Number.isInteger(port)||port<1||port>65535)throw Error();
 const config=file==='--standby'?null:JSON.parse(fs.readFileSync(file,'utf8')),server=createServer(config,{health:()=>({ready:false,status:config?'snapshotOnly':'awaitingDeployment'})});
 server.on('error',()=>{console.error('Status API failed to listen');process.exitCode=1;});
 server.listen(port,'127.0.0.1',()=>console.log('Status API listening on 127.0.0.1:'+port));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
}catch{console.error('Usage: CONFIG [PORT]');process.exitCode=1;}}
module.exports={walletStatus,createServer,createReader,createAsyncReader};
