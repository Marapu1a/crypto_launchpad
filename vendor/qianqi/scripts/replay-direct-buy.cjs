const fs=require('node:fs');
const {keccak256}=require('ethers');
const AUTO=require('./pair-auto-buy.cjs');
const PONS_PROFILES=require('./pons-profiles.cjs');
const {replay,canonical,hash,validateManifest,buyPolicyHistory,routeDependencies}=require('./direct-buy.cjs');

// Independent reader, never an operator BUY list. Optional Pons mode proves
// event absence with hash-bound headers; candidate blocks keep every receipt.
async function scan(input,rpcUrl,toBlock,lifecycle=null){
  let sequence=0;
  async function rpc(method,params=[]){
    const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params}),signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Object.assign(Error('RPC HTTP '+response.status),{code:'RPC_HTTP_ERROR',statusCode:response.status});
    const data=await response.json();if(data.error||data.result==null)throw Error('RPC cannot supply '+method);return data.result;
  }
  return scanWithRpc(input,rpc,toBlock,lifecycle);
}
async function scanWithRpc(input,rpc,toBlock,lifecycle=null,{fromBlock,mode,watchAddresses=[]}={}){
  const manifest=buyPolicyHistory(input).genesis;
  const pons=PONS_PROFILES.get(manifest.schema),batch=pons?.FIELDS.includes('batchExecutor');
  const project=mode==='pons-project-events-v1';
  if(mode!==undefined&&!['pons-block-receipts-v1','pons-bloom-receipts-v1','pons-project-events-v1'].includes(mode))throw Error('Unknown scan mode');
  const sparse=mode==='pons-bloom-receipts-v1',fast=mode!==undefined;
  if(fast&&!pons)throw Error('Pons receipt scan requires Pons manifest');
  const curveBuyTopic=batch?require('./pons-curve-buy.cjs').EVENTS.getEvent('CurveBuy').topicHash:null;
  const poolSwapTopic=batch&&manifest.manager?require('./pons-v4-buy.cjs').SWAP.getEvent('Swap').topicHash:null;
  if(BigInt(await rpc('eth_chainId'))!==BigInt(manifest.chainId))throw Error('Wrong RPC chain');
  const tag=n=>'0x'+BigInt(n).toString(16);
  const anchor=await rpc('eth_getBlockByNumber',[tag(manifest.anchor.number),false]);
  if(anchor.hash.toLowerCase()!==manifest.anchor.hash.toLowerCase())throw Error('Anchor is not canonical');
  if(BigInt(toBlock)<=BigInt(manifest.anchor.number))throw Error('Empty range');
  const first=fromBlock===undefined?BigInt(manifest.anchor.number)+1n:BigInt(fromBlock);
  if(first<=BigInt(manifest.anchor.number)||first>BigInt(toBlock))throw Error('Invalid scan range');
  const head=await rpc('eth_getBlockByNumber',[tag(toBlock),false]);
  for(const dependency of routeDependencies(input,toBlock)){
    const code=await rpc('eth_getCode',[dependency.address,tag(toBlock)]);
    if(code==='0x'||keccak256(code)!==dependency.codeHash)throw Error('Unexpected BUY adapter dependency runtime');
  }
  for(const field of pons?pons.FIELDS:['router','manager','hook','token','quote','registry',...(manifest.schema==='direct-buy-infinity-v1'?['settlement']:[])]){
    const code=await rpc('eth_getCode',[manifest[field],tag(toBlock)]);
    if(code==='0x'||keccak256(code)!==manifest.codeHashes[field])throw Error('Unexpected '+field+' runtime; review deployment binding');
  }
  if(lifecycle){
    const code=await rpc('eth_getCode',[lifecycle.source,tag(toBlock)]);
    if(code==='0x'||keccak256(code)!==lifecycle.sourceCodeHash.toLowerCase())throw Error('Unexpected lifecycle source runtime');
    if(['attempt-lifecycle-v3','attempt-lifecycle-v4'].includes(lifecycle.schema))for(const [address,digest] of [[lifecycle.monthlySource,lifecycle.monthlySourceCodeHash],[lifecycle.vault,lifecycle.vaultCodeHash]]){
      const code=await rpc('eth_getCode',[address,tag(toBlock)]);
      if(code==='0x'||keccak256(code)!==digest.toLowerCase())throw Error('Unexpected dual lifecycle runtime');
    }
  }
  if(fast)await pons.validateBindings(manifest,rpc,tag(toBlock));
  const {mapLimit}=require('./bounded-map.cjs');
  // An incremental caller must join its canonical prefix and replay the result.
  async function readBlock(n){
    let block=await rpc('eth_getBlockByNumber',[tag(n),!sparse]);
    if(!block||BigInt(block.number)!==n||!Array.isArray(block.transactions))throw Error('Invalid scan block');
    if(sparse){
      const bloom=require('./pons-bloom-evidence.cjs'),ponsOmission=bloom.encodeHeader(block);
      if(!bloom.relevant(block.logsBloom,manifest,[lifecycle?.source,lifecycle?.monthlySource,lifecycle?.vault,input.recognition?.source,...watchAddresses])){
        return {number:block.number,hash:block.hash,parentHash:block.parentHash,timestamp:block.timestamp,transactions:[],ponsOmission};
      }
      const full=await rpc('eth_getBlockByNumber',[tag(n),true]);
      if(full?.hash!==block.hash||full.number!==block.number||!Array.isArray(full.transactions))throw Error('Candidate block changed');
      block=full;
    }
    let receipts;
    if(fast){
      // On this RPC a block-receipt call costs 500 throughput units, versus
      // 20 for one receipt. Small candidate blocks are cheaper individually.
      receipts=sparse&&block.transactions.length<25
        ?await mapLimit(block.transactions,4,tx=>rpc('eth_getTransactionReceipt',[tx.hash]))
        :await rpc('eth_getBlockReceipts',[tag(n)]);
      if(!Array.isArray(receipts)||receipts.length!==block.transactions.length)throw Error('Incomplete block receipts');
      receipts=[...receipts].sort((a,b)=>Number(BigInt(a.transactionIndex)-BigInt(b.transactionIndex)));
      for(let i=0;i<receipts.length;i++){
        const r=receipts[i],tx=block.transactions[i];
        if(BigInt(tx.transactionIndex)!==BigInt(i)||BigInt(r.transactionIndex)!==BigInt(i)||
          r.transactionHash.toLowerCase()!==tx.hash.toLowerCase()||r.blockHash.toLowerCase()!==block.hash.toLowerCase()||
          BigInt(r.blockNumber)!==n||!Array.isArray(r.logs))throw Error('Block receipt provenance mismatch');
      }
    }
    // All receipts remain in evidence, including unrelated traffic. Only omit
    // historical venue calls when no event can affect this project's replay.
    const watched=new Set([manifest.token,manifest.curve,manifest.registry].filter(Boolean).map(a=>a.toLowerCase()));
    const relevant=!fast||receipts.some(r=>r.logs.some(l=>watched.has(l.address.toLowerCase())||
      manifest.manager&&l.address.toLowerCase()===manifest.manager.toLowerCase()&&l.topics[1]?.toLowerCase()===manifest.poolId.toLowerCase()));
    const transactions=[],batchAccounts={},entrypointAccounts={};
    if(batch&&relevant){const code=await rpc('eth_getCode',[manifest.batchExecutor,tag(n-1n)]);if(keccak256(code)!==manifest.codeHashes.batchExecutor)throw Error('Unexpected parent executor runtime');}
    if(pons&&relevant)await pons.validateBindings(manifest,rpc,tag(n));
    if(pons&&relevant)await mapLimit(pons.FIELDS,fast?4:1,async field=>{
      const code=await rpc('eth_getCode',[manifest[field],tag(n)]);
      if(code==='0x'||keccak256(code)!==manifest.codeHashes[field])throw Error('Unexpected historical Pons '+field+' runtime');
    });
    if(manifest.schema==='direct-buy-infinity-v1')for(const field of ['router','manager','hook','token','quote','settlement']){
      const code=await rpc('eth_getCode',[manifest[field],tag(n)]);
      if(code==='0x'||keccak256(code)!==manifest.codeHashes[field])throw Error('Unexpected historical Infinity '+field+' runtime');
    }
    for(const tx of block.transactions){
      if(tx.to?.toLowerCase()===AUTO.ADDRESS&&routeDependencies(input,n).some(d=>d.address===AUTO.ADDRESS)){
        const code=await rpc('eth_getCode',[AUTO.ADDRESS,tag(n)]);
        if(code==='0x'||keccak256(code)!==AUTO.CODE_HASH)throw Error('Unexpected historical AUTO runtime');
      }
      const receipt=fast?receipts[transactions.length]:await rpc('eth_getTransactionReceipt',[tx.hash]);
      // Keep all receipts. Only a target venue candidate needs account delegation
      // evidence; unrelated self-calls must not require historical account state.
      const candidate=batch&&receipt.logs.some(l=>
        l.address.toLowerCase()===manifest.curve.toLowerCase()&&l.topics[0]===curveBuyTopic||
        manifest.manager&&l.address.toLowerCase()===manifest.manager.toLowerCase()&&l.topics[0]===poolSwapTopic&&l.topics[1]?.toLowerCase()===manifest.poolId.toLowerCase());
      if(candidate&&tx.to&&tx.from.toLowerCase()===tx.to.toLowerCase()){const payer=tx.from.toLowerCase();if(!batchAccounts[payer])batchAccounts[payer]={parentHash:block.parentHash,code:await rpc('eth_getCode',[payer,tag(n-1n)])};}
      if(candidate&&pons.accountCandidate){
        const account=pons.accountCandidate(manifest,tx);
        if(account&&!entrypointAccounts[account]){
          const implementation=await rpc('eth_getCode',[manifest.entryPointAccount,tag(n-1n)]);
          if(keccak256(implementation)!==manifest.codeHashes.entryPointAccount)throw Error('Unexpected parent EntryPoint account runtime');
          entrypointAccounts[account]={parentHash:block.parentHash,code:await rpc('eth_getCode',[account,tag(n-1n)])};
        }
      }
      transactions.push({tx,receipt});
    }
    return {number:block.number,hash:block.hash,parentHash:block.parentHash,timestamp:block.timestamp,transactions,...(batch?{batchAccounts}:{}),...(pons?.accountCandidate?{entrypointAccounts}:{})};
  }
  let blocks;
  if(project){
    const P=require('./project-history.cjs'),addresses=P.watched(input,lifecycle,watchAddresses);
    const {pagedLogs}=require('./paged-log-read.cjs');
    const filters=[{address:addresses},...(manifest.manager?[{address:manifest.manager,topics:[null,manifest.poolId]}]:[])];
    const logs=[];
    for(const filter of filters)logs.push(...await pagedLogs(Number(first),Number(toBlock),(from,to)=>rpc('eth_getLogs',[{...filter,fromBlock:tag(from),toBlock:tag(to)}])));
    const candidates=new Set(logs.map(l=>Number(BigInt(l.blockNumber))));
    for(const v of input.versions||[])if(v.announcedAtBlock>=Number(first)&&v.announcedAtBlock<=Number(toBlock))candidates.add(v.announcedAtBlock);
    const heights=new Set(candidates);
    for(let n=BigInt(toBlock)>128n?BigInt(toBlock)-128n:first;n<=BigInt(toBlock);n++)if(n>=first)heights.add(Number(n));
    blocks=await mapLimit([...heights].sort((a,b)=>a-b),4,async n=>{
      if(candidates.has(n))return readBlock(BigInt(n));
      const b=await rpc('eth_getBlockByNumber',[tag(n),false]);
      if(!b||BigInt(b.number)!==BigInt(n))throw Error('Missing project header');
      return {number:b.number,hash:b.hash,parentHash:b.parentHash,timestamp:b.timestamp,transactions:[]};
    });
    // Every selected log must occur unchanged in its full receipt before filtering.
    const receipts=new Map(blocks.flatMap(b=>b.transactions.flatMap(t=>t.receipt.logs.map(l=>[l.transactionHash.toLowerCase()+':'+BigInt(l.logIndex),l]))));
    for(const log of logs){const found=receipts.get(log.transactionHash.toLowerCase()+':'+BigInt(log.logIndex));
      if(!found||found.blockHash!==log.blockHash||BigInt(found.blockNumber)!==BigInt(log.blockNumber)||BigInt(found.transactionIndex)!==BigInt(log.transactionIndex)||found.address.toLowerCase()!==log.address.toLowerCase()||found.data!==log.data||JSON.stringify(found.topics)!==JSON.stringify(log.topics))throw Error('Project log/receipt mismatch');}
    await P.references(blocks,input,lifecycle,rpc);
    const previous=await rpc('eth_getBlockByNumber',[tag(first-1n),false]);
    if(!previous||BigInt(previous.number)!==first-1n)throw Error('Missing project predecessor');
    blocks=P.mark(P.compact(blocks,input,lifecycle,{extra:watchAddresses}),input,lifecycle,{number:Number(first-1n),hash:previous.hash},watchAddresses);
  }else{
    const heights=[];for(let n=first;n<=BigInt(toBlock);n++)heights.push(n);
    blocks=await mapLimit(heights,sparse?8:fast?4:1,readBlock);
  }
  if((await rpc('eth_getBlockByNumber',[tag(toBlock),false])).hash!==head.hash)throw Error('Chain changed during scan; retry canonical range');
  return {manifest:input,blocks};
}
async function main(){
  const args=process.argv.slice(2),options={};
  const allowed=new Set(['--evidence','--manifest','--rpc','--to-block','--output','--verify']);
  for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||!args[i+1]||options[args[i]])throw Error('Invalid/duplicate option');options[args[i]]=args[i+1];}
  let input,policyStatus={mode:'unadmitted',reason:'Offline evidence; no source admission'};
  if(options['--evidence']){
    if(options['--rpc']||options['--manifest']||options['--to-block'])throw Error('Choose saved evidence or independent RPC scan');
    input=JSON.parse(fs.readFileSync(options['--evidence'],'utf8'));
  }else{
    if(!options['--rpc']||!options['--manifest']||!options['--to-block'])throw Error('Supply --evidence FILE or --manifest FILE --rpc URL --to-block N');
    const saved=JSON.parse(fs.readFileSync(options['--manifest'],'utf8'));
    const {JsonRpcProvider}=require('ethers'),provider=new JsonRpcProvider(options['--rpc']);
    let resolved;try{resolved=await require('./buy-policy-runtime.cjs').resolveBuyPolicy(saved.manifest?saved:{manifest:saved},(m,p)=>provider.send(m,p),Number(options['--to-block']));}finally{provider.destroy();}
    policyStatus=resolved.policyStatus;
    input=await scan(resolved.manifest,options['--rpc'],options['--to-block']);
  }
  const ledger=replay(input.manifest,input.blocks);
  const result={ledger,ledgerHash:hash(ledger),policyStatus};
  if(options['--verify']){
    const claimed=JSON.parse(fs.readFileSync(options['--verify'],'utf8'));
    if(claimed.ledgerHash!==result.ledgerHash||canonical(claimed.ledger)!==canonical(ledger))throw Error('Published ledger differs from independently replayed history');
  }
  if(options['--output'])fs.writeFileSync(options['--output'],canonical(result)+'\n');
  console.log(JSON.stringify({policyStatus,candidates:ledger.decisions.length,wallets:ledger.wallets,ledgerHash:result.ledgerHash,finality:ledger.finality},null,2));
}
module.exports={scan,scanWithRpc};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
