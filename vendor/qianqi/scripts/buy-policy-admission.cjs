const {pagedLogs}=require('./paged-log-read.cjs');
// Read-only BuyPolicySource admission. Trust root is supplied by deployment policy, never notices.
// No signing, state writes, or fallback from finalized to latest.
const {Interface,isAddress,isHexString,ZeroAddress,ZeroHash,keccak256}=require('ethers');
const {validateManifest,buyPolicyHistory,canonical,hash}=require('./direct-buy.cjs');
const {initialAdapters,genesisAdaptersHash,commitment,extend}=require('./buy-policy-format.cjs');
const ABI=new Interface(['function instanceId() view returns(bytes32)','function genesisHash() view returns(bytes32)','function publisher() view returns(address)','function noticeBlocks() view returns(uint256)','function publishedCount() view returns(uint256)','function currentHash() view returns(bytes32)','function lastFromBlock() view returns(uint256)','function SCHEMA_VERSION() view returns(uint256)','function genesisAdaptersHash() view returns(bytes32)','function announce(bytes32 previousHash,bytes32 adapterId,uint256 fromBlock)','event BuyPolicyAnnounced(bytes32 indexed instanceId,bytes32 indexed previousHash,bytes32 indexed nextHash,bytes32 adapterId,uint256 fromBlock)']);
const check=(ok,message)=>{if(!ok)throw Error(message);};
const low=x=>x.toLowerCase();
const num=x=>{const n=Number(BigInt(x));check(Number.isSafeInteger(n)&&n>=0,'Invalid block/index');return n;};
const tag=x=>'0x'+BigInt(x).toString(16);
async function loadBuyPolicy({trust,genesis,rpc,cutoff}){
 validateManifest(genesis);
 for(const key of ['source','publisher'])check(isAddress(trust[key])&&low(trust[key])!==ZeroAddress,'Invalid trust '+key);
 for(const key of ['instanceId','sourceCodeHash','genesisHash'])check(isHexString(trust[key],32)&&low(trust[key])!==ZeroHash,'Invalid trust '+key);
 check(hash(genesis)===low(trust.genesisHash),'Untrusted genesis');
 check(BigInt(trust.chainId)===BigInt(genesis.chainId),'Trust chain mismatch');
 check(Number.isSafeInteger(trust.noticeBlocks)&&trust.noticeBlocks>0,'Positive notice required');
 check(BigInt(await rpc('eth_chainId',[]))===BigInt(trust.chainId),'Wrong RPC chain');
 const block=async height=>{const b=await rpc('eth_getBlockByNumber',[height,false]);check(b&&isHexString(b.hash,32),'Missing block');if(height!=='finalized')check(num(b.number)===num(height),'Wrong block number');return b;};
 const code=async height=>{const c=await rpc('eth_getCode',[trust.source,tag(height)]);check(c&&c!=='0x'&&keccak256(c)===low(trust.sourceCodeHash),'Untrusted source runtime');};
 const anchor=await block(tag(genesis.anchor.number));check(low(anchor.hash)===low(genesis.anchor.hash),'Genesis anchor changed');
 const final=await block('finalized'),height=num(final.number);check(height>=num(anchor.number),'Finalized before genesis');
 const effectiveCutoff=cutoff??height;check(Number.isSafeInteger(effectiveCutoff)&&effectiveCutoff>=num(anchor.number)&&effectiveCutoff<=height,'BUY policy cutoff is not finalized');
 await code(height);
 const read=async name=>ABI.decodeFunctionResult(name,await rpc('eth_call',[{to:trust.source,data:ABI.encodeFunctionData(name)},tag(height)]))[0];
 check(low(await read('instanceId'))===low(trust.instanceId)&&low(await read('genesisHash'))===low(trust.genesisHash),'Source identity mismatch');
 check(low(await read('publisher'))===low(trust.publisher)&&num(await read('noticeBlocks'))===trust.noticeBlocks,'Source authority/notice mismatch');
 check(num(await read('SCHEMA_VERSION'))===1&&low(await read('genesisAdaptersHash'))===genesisAdaptersHash(genesis),'Source schema/genesis adapters mismatch');
 const count=num(await read('publishedCount')),currentHash=low(await read('currentHash')),lastFrom=num(await read('lastFromBlock'));
 // The pinned source increments publishedCount for every announcement. With zero
 // announcements the finalized getters prove an empty history; avoid rescanning
 // the entire lifetime on every pass. Commitment and lastFrom checks still apply.
 const logs=count===0?[]:await pagedLogs(num(genesis.anchor.number),height,(from,to)=>rpc('eth_getLogs',[{address:trust.source,fromBlock:tag(from),toBlock:tag(to),topics:[ABI.getEvent('BuyPolicyAnnounced').topicHash,trust.instanceId]}]));
 check(Array.isArray(logs),'Missing notices');
 const history={schema:'buy-policy-history-v1',versions:[{fromBlock:num(genesis.anchor.number),manifest:genesis}]};
 const evidence=[],seen=new Set(),adapters=new Set(initialAdapters(genesis)),pendingAdapters=[];
 let chainHash=hash(genesis),lastActivation=0,unsupported=false;
 for(const l of [...logs].sort((a,b)=>num(a.blockNumber)-num(b.blockNumber)||num(a.transactionIndex)-num(b.transactionIndex)||num(a.logIndex)-num(b.logIndex))){
  check(!l.removed&&low(l.address)===low(trust.source),'Wrong notice emitter');
  const n=num(l.blockNumber);check(n>=num(anchor.number)&&n<=height,'Notice outside finalized range');
  const key=low(l.transactionHash)+':'+num(l.logIndex);check(!seen.has(key),'Duplicate notice');seen.add(key);
  const header=await block(tag(n));check(low(header.hash)===low(l.blockHash),'Notice reorg');await code(n);
  const tx=await rpc('eth_getTransactionByHash',[l.transactionHash]);
  const receipt=await rpc('eth_getTransactionReceipt',[l.transactionHash]);
  check(tx&&receipt&&BigInt(receipt.status)===1n,'Missing/failed notice transaction');
  check(low(tx.hash)===low(l.transactionHash)&&low(receipt.transactionHash)===low(tx.hash),'Notice transaction mismatch');
  check(low(tx.blockHash)===low(header.hash)&&low(receipt.blockHash)===low(header.hash)&&num(tx.blockNumber)===n&&num(receipt.blockNumber)===n,'Notice provenance mismatch');
  check(num(tx.transactionIndex)===num(l.transactionIndex)&&num(receipt.transactionIndex)===num(l.transactionIndex),'Notice index mismatch');
  // Authorization is enforced by pinned source code + immutable publisher, including contract wallets.
  check(tx.to,'Missing transaction target');
  check(receipt.to&&low(receipt.to)===low(tx.to)&&low(receipt.from)===low(tx.from),'Notice sender mismatch');
  const matches=receipt.logs.filter(x=>num(x.logIndex)===num(l.logIndex));
  check(matches.length===1&&canonical(matches[0])===canonical(l),'Notice receipt mismatch');
  const parsed=ABI.parseLog(l),encoded=ABI.encodeEventLog(parsed.fragment,parsed.args),a=parsed.args;
  check(canonical(encoded.topics.map(low))===canonical(l.topics.map(low))&&low(encoded.data)===low(l.data),'Noncanonical notice');
  check(low(a.instanceId)===low(trust.instanceId),'Wrong instance');
  check(low(a.previousHash)===chainHash,'Broken policy hash chain');
  const fromBlock=num(a.fromBlock),adapter=low(a.adapterId);
  check(adapter!==ZeroHash&&!adapters.has(adapter),'Duplicate/empty adapter');
  check(fromBlock>lastActivation&&n>=lastActivation&&fromBlock-n>=trust.noticeBlocks,'Insufficient policy notice/order');
  chainHash=commitment(chainHash,adapter,fromBlock);
  check(chainHash===low(a.nextHash),'Published commitment mismatch');
  adapters.add(adapter);lastActivation=fromBlock;
  const manifest=unsupported?null:extend(history.versions.at(-1).manifest,adapter,fromBlock,n);
  if(!manifest){
   unsupported=true;pendingAdapters.push({adapterId:adapter,fromBlock});
  }else{
   history.versions.push({manifest,fromBlock,announcedAtBlock:n,announcedBlockHash:low(header.hash)});
   buyPolicyHistory(history);
  }
  evidence.push({transactionHash:low(tx.hash),logIndex:num(l.logIndex),blockNumber:n,blockHash:low(header.hash),adapterId:adapter,fromBlock,commitment:chainHash});
 }
 check(evidence.length===count&&chainHash===currentHash&&lastActivation===lastFrom,'Incomplete policy history');
 const required=pendingAdapters.find(p=>p.fromBlock<=effectiveCutoff);
 check(!required,'BUY adapter update required at cutoff: '+required?.adapterId);
 check(low((await block(tag(height))).hash)===low(final.hash),'Finalized checkpoint changed');
 const finalAfter=await block('finalized');check(num(finalAfter.number)>=height,'Finalized head regressed');
 if(num(finalAfter.number)===height)check(low(finalAfter.hash)===low(final.hash),'Finalized checkpoint changed');
 return {schema:'buy-policy-admission-v2',history,currentHash,pendingAdapters,cutoff:effectiveCutoff,trustHash:hash(trust),checkpoint:{number:height,hash:low(final.hash)},evidence,
  limitation:'RPC finalized assertion; not an independent consensus proof. Deployment trust and network finality require independent verification.'};
}
module.exports={ABI,loadBuyPolicy};
