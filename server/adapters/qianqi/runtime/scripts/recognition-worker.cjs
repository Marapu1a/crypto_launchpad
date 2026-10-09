// Runs inside the existing coordinator journal: never a second concurrent signer.
const fs=require('fs'),path=require('path'),E=require('ethers'),crypto=require('crypto'),D=require('./direct-buy.cjs'),R=require('./purchase-recognition.cjs'),P=require('./prepare-purchase-recognition.cjs');
const check=(v,m)=>{if(!v)throw Error('Recognition worker: '+m);};
function settings(c){const p=c.recognitionPublishing;check(p?.enabled===true&&Number.isInteger(p.batchSize)&&p.batchSize>=1&&p.batchSize<=50,'disabled or invalid batch size');check(path.isAbsolute(p.publicDirectory)&&new URL(p.publicBaseUrl).protocol==='https:','public evidence destination');R.trust(c.recognition);check(c.recognition.publication,'public notice required');check(c.recognition.publisher.toLowerCase()===c.executor.toLowerCase(),'publisher/executor mismatch');return p;}
function history(c){const config=require('./shared-index-config.cjs').buildIndexConfigs(require('./pons-automation.cjs').schedulerConfigFor(c)).indexConfig;const state=JSON.parse(fs.readFileSync(config.indexer.statePath,'utf8'));return {config,state,...P.publicationHistory(config,state)};}
function candidate(h,row){
 try{
  const m=h.config.manifest;
  if(row.tx.to?.toLowerCase()==='0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc'){require('./pons-router-calldata-research.cjs').decode(m,row.tx);return true;}
  if(h.manifest.recognition?.adapter!=='pons-native-reviewed-v2')return false;
  const park=require('./pons-park-native.cjs');
  if(row.tx.to?.toLowerCase()===park.ROUTER||row.tx.to?.toLowerCase()===row.tx.from.toLowerCase()){park.decode(m,row.tx);return true;}
  require('./pons-native-settlement.cjs').decode(m,row.tx);
  return true; // Every selected route still requires full trace/runtime verification.

 }catch{return false;}
}
function select(h,limit){const ledger=D.replay(h.manifest,h.blocks),rows=new Map(h.blocks.flatMap(b=>b.transactions.map(r=>[r.tx.hash.toLowerCase(),r])));return ledger.decisions.filter(d=>d.status==='WAITING_RECOGNITION').filter(d=>candidate(h,rows.get(d.transactionHash.toLowerCase()))).slice(0,limit).map(d=>d.transactionHash);}

async function publicChecks(c,key,fetcher=fetch){
 const p=settings(c),notice=c.recognition.publication;check(Date.now()>=Date.parse(notice.notBefore),'public notice not elapsed');
 const options={signal:AbortSignal.timeout(20000),redirect:'error'};
 const nr=await fetcher(notice.url,options);check(nr.ok,'notice unavailable');const bytes=Buffer.from(await nr.arrayBuffer());check(crypto.createHash('sha256').update(bytes).digest('hex')===notice.sha256,'notice changed');
 const response=await fetcher(p.publicBaseUrl.replace(/\/$/,'')+'/'+key+'.json',options);check(response.ok,'bundle unavailable');const body=await response.text();check(Buffer.byteLength(body)<=R.MAX_BYTES&&D.hash(JSON.parse(body))===key,'public bundle mismatch');
}
function publish(c,plan){const p=settings(c),bytes=fs.readFileSync(plan.file);check(D.hash(JSON.parse(bytes))===plan.bundleHash,'local bundle mismatch');fs.mkdirSync(p.publicDirectory,{recursive:true});const target=path.join(p.publicDirectory,plan.bundleHash+'.json');if(fs.existsSync(target)){check(D.hash(JSON.parse(fs.readFileSync(target)))===plan.bundleHash,'public file conflict');fs.chmodSync(target,0o644);return;}const temp=target+'.tmp';fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o644});fs.chmodSync(temp,0o644);fs.renameSync(temp,target);}
async function prepare(c,provider){const p=settings(c),h=history(c);const hashes=select(h,p.batchSize);if(!hashes.length)return null;
 check(Date.now()>=Date.parse(c.recognition.publication.notBefore),'public notice not elapsed');
 const plan=await P.prepare({config:h.config,manifest:h.manifest,blocks:h.blocks,transactionHashes:hashes,rpc:provider.send.bind(provider),directory:c.recognition.bundleDirectory});return plan;
}
async function guard(c,provider,request){settings(c);check(request.to?.toLowerCase()===c.recognition.source.toLowerCase()&&BigInt(request.value||0)===0n,'source envelope');const call=R.ABI.parseTransaction({data:request.data});check(call?.name==='confirm'&&call.args[1]>0n&&call.args[1]<=BigInt(c.recognitionPublishing.batchSize),'selector/count');
 const h=history(c),key=call.args[0].toLowerCase(),file=path.join(c.recognition.bundleDirectory,key+'.json');const bytes=fs.readFileSync(file);check(bytes.length<=R.MAX_BYTES,'bundle size');const bundle=JSON.parse(bytes);check(D.hash(bundle)===key,'bundle digest');
 const plan=await P.prepare({config:h.config,manifest:h.manifest,blocks:h.blocks,transactionHashes:bundle.proofs.map(p=>p.transactionHash),rpc:provider.send.bind(provider),directory:c.recognition.bundleDirectory});check(plan.request.data.toLowerCase()===request.data.toLowerCase(),'replay changed');await publicChecks(c,key);
}
async function run({config:c,provider,send,lastResolved},deps={history,prepare,publish,publicChecks}){
 if(!c.recognitionPublishing?.enabled)return {status:'disabled'};
 settings(c);const h=deps.history(c);if(lastResolved?.action==='confirm'&&lastResolved.blockNumber>h.state.index.head)return {status:'waiting',reason:'recognitionIndexCatchup'};
 // No confirmation is pending: a new notice must not suspend ordinary draws.
 if(Date.now()<Date.parse(c.recognition.publication.notBefore))return {status:'deferred',reason:'recognitionNotice'};
 const plan=await deps.prepare(c,provider);if(!plan)return {status:'idle'};deps.publish(c,plan);await deps.publicChecks(c,plan.bundleHash);
 const receipt=await send(plan);return {status:'waiting',reason:'recognitionIndexCatchup',bundleHash:plan.bundleHash,transactionHash:receipt.hash};
}
module.exports={settings,history,select,publicChecks,publish,prepare,guard,run};
