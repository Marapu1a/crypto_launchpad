// Read-only bundle builder. Produces reviewable calldata, never sends a transaction.
const fs=require('node:fs'),path=require('node:path'),E=require('ethers');
const R=require('./purchase-recognition.cjs'),D=require('./direct-buy.cjs');
const SOURCE=new E.Interface(['function instanceId() view returns(bytes32)','function publisher() view returns(address)','function availableAt() view returns(uint256)','function published(bytes32) view returns(bool)']);
const check=(ok,message)=>{if(!ok)throw Error('Recognition preparation: '+message);};
const low=x=>String(x).toLowerCase();
const header=b=>({number:String(BigInt(b.number)),hash:low(b.hash),parentHash:low(b.parentHash),timestamp:String(BigInt(b.timestamp))});
function rehearse(config,input,blocks,bundle,sourceCode,before){
 const L=require('./attempt-lifecycle.cjs'),t=config.recognition,key=D.hash(bundle),head=before.buyLedger.head;
 const number=head.number+1;check(Number.isSafeInteger(number),'invalid next block');
 const blockHash=E.id('SYNTHETIC recognition preflight '+head.hash+key),transactionHash=E.id('SYNTHETIC recognition transaction '+blockHash),from=t.publisher,to=t.source;
 const block={number,hash:blockHash,parentHash:head.hash,timestamp:Number(BigInt(blocks.find(b=>Number(BigInt(b.number))===head.number).timestamp))+1,
  recognitionSourceCode:sourceCode,recognitionBundles:{[key]:bundle}};
 const tx={hash:transactionHash,blockNumber:number,blockHash,transactionIndex:0,chainId:config.manifest.chainId,from,to,value:'0x0',input:R.ABI.encodeFunctionData('confirm',[key,bundle.proofs.length])};
 const log={...R.ABI.encodeEventLog(R.ABI.getEvent('PurchasesRecognized'),[t.instanceId,key,bundle.proofs.length]),address:to,blockNumber:number,blockHash,transactionHash,transactionIndex:0,logIndex:0,removed:false};
 block.transactions=[{tx,receipt:{transactionHash,blockNumber:number,blockHash,transactionIndex:0,from,to,status:1,logs:[log]}}];
 const after=L.replayAttempts(input,config.lifecycle,[...blocks,block]);
 check(D.hash(before.draws)===D.hash(after.draws),'existing draws changed');
 return {mode:'synthetic-confirmation-over-verified-history',head,ledgerHashBefore:D.hash(before.buyLedger),ledgerHashAfter:D.hash(after.buyLedger),existingDraws:before.draws.length,
  newlyConfirmed:after.buyLedger.decisions.filter(d=>d.recognition?.bundleHash===key).length};
}
async function prepare({config,blocks,manifest,transactionHashes,rpc,directory,stageOnly=false}){
 const t=R.trust(config.recognition),m=config.manifest;
 check(Array.isArray(transactionHashes)&&transactionHashes.length>0&&transactionHashes.length<=50&&transactionHashes.every(x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x)),'Select 1..50 unique purchases');
 transactionHashes=transactionHashes.map(low);
 check(new Set(transactionHashes).size===transactionHashes.length,'Select 1..50 unique purchases');
 check(config.lifecycle,'lifecycle config required for publication replay');
 const expected=R.attach(m,config.recognition),input=manifest||expected;
 check(D.hash(D.buyPolicyHistory(input).genesis)===D.hash(m)&&D.hash(input.recognition??null)===D.hash(expected.recognition),'history/config trust mismatch');
 const beforeLedger=require('./attempt-lifecycle.cjs').replayAttempts(input,config.lifecycle,blocks);
 for(const tx of transactionHashes){const candidates=beforeLedger.buyLedger.decisions.filter(d=>d.transactionHash===tx);
  check(candidates.length===1&&candidates[0].status==='WAITING_RECOGNITION','purchase already counted, missing or ambiguous');}
 if(BigInt(await rpc('eth_chainId',[]))!==BigInt(m.chainId))throw Error('Wrong RPC chain');
 const final=await rpc('eth_getBlockByNumber',['finalized',false]),proofs=[];
 const finalTag='0x'+BigInt(final.number).toString(16);
 check(BigInt(beforeLedger.head.number)<=BigInt(final.number),'history not finalized');
 if(config.buyPolicy){const resolved=await require('./buy-policy-runtime.cjs').resolveBuyPolicy(config,rpc,beforeLedger.head.number);check(D.hash(resolved.manifest)===D.hash(input),'history policy is not admitted');}
 const sourceCode=await rpc('eth_getCode',[t.source,finalTag]);
 check(sourceCode!=='0x'&&E.keccak256(sourceCode)===low(t.sourceCodeHash),'source runtime mismatch');
 const read=async(name,args=[])=>SOURCE.decodeFunctionResult(name,await rpc('eth_call',[{to:t.source,data:SOURCE.encodeFunctionData(name,args)},finalTag]))[0];
 check(low(await read('instanceId'))===low(t.instanceId)&&low(await read('publisher'))===low(t.publisher),'source authority mismatch');
 const availableAt=await read('availableAt');check(availableAt>0n,'invalid source notice');if(!stageOnly){check(BigInt(final.timestamp)>=availableAt,'source notice not elapsed');if(t.publication)check(Number(BigInt(final.timestamp))*1000>=Date.parse(t.publication.notBefore),'public notice not elapsed');}
 for(const transactionHash of transactionHashes){
  const block=blocks.find(b=>b.transactions.some(r=>r.tx.hash.toLowerCase()===transactionHash.toLowerCase()));
  if(!block||BigInt(block.number)>BigInt(final.number))throw Error('Purchase not retained/finalized');
  const tag='0x'+BigInt(block.number).toString(16),before='0x'+(BigInt(block.number)-1n).toString(16),row=block.transactions.find(r=>r.tx.hash.toLowerCase()===transactionHash.toLowerCase());
  if(D.hash(header(await rpc('eth_getBlockByNumber',[tag,false])))!==D.hash(header(block)))throw Error('Purchase header changed');
  const receipt=await rpc('eth_getTransactionReceipt',[row.tx.hash]);
  if(D.hash(receipt.logs)!==D.hash(row.receipt.logs)||receipt.blockHash!==block.hash||BigInt(receipt.status)!==1n)throw Error('Purchase receipt changed');
  const trace=await rpc('debug_traceTransaction',[row.tx.hash,{tracer:'callTracer',tracerConfig:{withLog:true}}]);
  const targets=new Set([row.tx.from.toLowerCase()]);
  function walk(frame){targets.add(frame.to.toLowerCase());for(const c of frame.calls||[])walk(c);}walk(trace);
  const codeHashes={},parentCodeHashes={};
  for(const address of targets){codeHashes[address]=E.keccak256(await rpc('eth_getCode',[address,tag]));parentCodeHashes[address]=E.keccak256(await rpc('eth_getCode',[address,before]));if(codeHashes[address]!==parentCodeHashes[address])throw Error('Runtime changed in purchase block');}
  const proof={transactionHash:row.tx.hash.toLowerCase(),blockHash:block.hash.toLowerCase(),trace,codeHashes,parentCodeHashes};
  R.verify(m,t,row,proof,block);proofs.push(proof);
  if((await rpc('eth_getBlockByNumber',[tag,false])).hash!==block.hash)throw Error('Purchase branch changed');
 }
 const bundle={schema:'purchase-recognition-bundle-v1',instanceId:t.instanceId.toLowerCase(),chainId:String(m.chainId),token:m.token.toLowerCase(),proofs};
 if(Buffer.byteLength(JSON.stringify(bundle))>R.MAX_BYTES)throw Error('Split batch: evidence exceeds byte limit');
 const bundleHash=D.hash(bundle),validation=rehearse(config,input,blocks,bundle,sourceCode,beforeLedger);
 check(validation.newlyConfirmed===proofs.length,'batch replay count mismatch');
 check(!await read('published',[bundleHash]),'bundle already published');
 const request={from:t.publisher,to:t.source,chainId:'0x'+BigInt(m.chainId).toString(16),value:'0x0',data:R.ABI.encodeFunctionData('confirm',[bundleHash,proofs.length])};
 if(!stageOnly)await rpc('eth_call',[{from:request.from,to:request.to,value:request.value,data:request.data},finalTag]);
 check(low((await rpc('eth_getBlockByNumber',[finalTag,false])).hash)===low(final.hash),'finalized branch changed');
 const retainedHead=await rpc('eth_getBlockByNumber',['0x'+BigInt(beforeLedger.head.number).toString(16),false]);
 check(low(retainedHead.hash)===low(beforeLedger.head.hash),'retained history branch changed');
 const file=path.join(directory,bundleHash+'.json');fs.mkdirSync(directory,{recursive:true});
 if(fs.existsSync(file)){if(D.hash(JSON.parse(fs.readFileSync(file,'utf8')))!==bundleHash)throw Error('Conflicting existing bundle');}
 else fs.writeFileSync(file,JSON.stringify(bundle)+'\n',{flag:'wx'});
 return {schema:stageOnly?'purchase-recognition-stage-v1':'purchase-recognition-plan-v2',bundleHash,count:proofs.length,file,validation,sourceCheckpoint:{number:String(BigInt(final.number)),hash:final.hash,availableAt:String(availableAt)},
  publicationChecksRemaining:['projectHistoryAudit','publicAnnouncement24h','bundleAvailability'],request:stageOnly?null:request,sent:false};
}
function publicationHistory(config,state,now=Date.now()){
 const {checksum,...stored}=state;
 check(require('./indexer-checksum.cjs').validIndexerChecksum(stored,checksum),'index checksum mismatch');
 check(state.configHash===D.hash({kind:'persistent-buy-indexer-v1',config})&&state.index?.policyStatus?.mode==='admitted'&&state.status?.state==='caughtUp','index identity/admission/readiness mismatch');
 const age=now-Date.parse(state.index.observedAt);
 check(Number.isFinite(age)&&age>=0&&Number.isFinite(config.indexer?.maxAgeSeconds)&&config.indexer.maxAgeSeconds>0&&age<=config.indexer.maxAgeSeconds*1000,'index stale');
 return {manifest:state.index.manifest,blocks:state.index.blocks};
}
module.exports={prepare,publicationHistory};
if(require.main===module)(async()=>{
 const [configPath,statePath,directory,...transactionHashes]=process.argv.slice(2);
 if(!directory||!process.env.RH_RPC_URL)throw Error('Usage: CONFIG INDEX_STATE BUNDLE_DIRECTORY TX_HASH...; RH_RPC_URL required');
 const config=JSON.parse(fs.readFileSync(configPath,'utf8')),state=JSON.parse(fs.readFileSync(statePath,'utf8'));
 const result=await prepare({config,...publicationHistory(config,state),directory,transactionHashes,rpc:require('./public-rpc-qualification.cjs').httpRpc(process.env.RH_RPC_URL)});
 console.log(JSON.stringify(result,null,2));
})().catch(()=>{console.error('Recognition preparation failed; no transaction sent');process.exitCode=1;});
