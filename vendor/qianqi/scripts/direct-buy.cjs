// Pure, versioned decoder/replay. No DB, RPC, signing, floating point or winner selection.
const {AbiCoder,Interface,keccak256,toUtf8Bytes,isAddress}=require('ethers');
const AUTO=require('./pair-auto-buy.cjs');
const INFINITY=require('./infinity-buy.cjs');
const PONS_PROFILES=require('./pons-profiles.cjs');
const coder=AbiCoder.defaultAbiCoder();
const SWAP_ABI=new Interface(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const TRANSFER_ABI=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const REGISTER_ABI=new Interface(['event Registered(address indexed participant)']);
const EXECUTE_ABI=new Interface(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
const SWAP_TYPE='((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)';
const low=x=>x.toLowerCase();
const number=x=>{const n=Number(BigInt(x));if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid index');return n;};
function ensure(condition,message){if(!condition)throw Error(message);}
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function hash(value){return keccak256(toUtf8Bytes(canonical(value)));}
const ROUTES=Object.freeze({'rh-ur-10-060b0e-v1':'0x10:0x060b0e','rh-ur-10-060c0f-v1':'0x10:0x060c0f','rh-ur-0a10-060b0e-v1':'0x0a10:0x060b0e',[AUTO.ID]:'auto'});
const PERMIT_ROUTE='rh-ur-0a10-060b0e-v1';
const PERMIT_TYPE='((address,uint160,uint48,uint48),address,uint256)';
const PERMIT2=Object.freeze({address:'0x000000000022d473030f116ddee9f6b43ac78ba3',codeHash:'0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca'});
const ROUTER_HASH='0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde';
function routePolicy(m){
  const pons=PONS_PROFILES.get(m.schema);if(pons){pons.validate(m);return [{id:pons.ID,fromBlock:m.anchor.number}];}
  if(m.schema===INFINITY.SCHEMA){INFINITY.validate(m);return [{id:INFINITY.ID,fromBlock:m.anchor.number}];}
  if(m.schema==='direct-buy-v2'){
    ensure(m.routeVersion==='scheduled-routes-v1','Unsupported route policy');
    ensure(m.codeHashes?.router===ROUTER_HASH||(String(m.chainId)==='31337'&&m.routerProfile==='local-fixture'&&/^0x[0-9a-f]{64}$/.test(m.codeHashes?.router||'')),'Unsupported router runtime');
    ensure(Array.isArray(m.routes)&&m.routes.length>0,'Empty routes');
    const seen=new Set();
    for(const r of m.routes){
      ensure(Object.hasOwn(ROUTES,r.id)&&!seen.has(r.id),'Unknown/duplicate route');
      if(r.id===AUTO.ID)ensure(AUTO.validProfile(m)&&m.codeHashes?.router===ROUTER_HASH,'Unsupported AUTO profile');
      if(r.id===PERMIT_ROUTE)ensure(m.codeHashes?.router===ROUTER_HASH,'Unsupported Permit2 router runtime');
      ensure(typeof r.fromBlock==='number'&&Number.isSafeInteger(r.fromBlock)&&r.fromBlock>=0,'Invalid activation block');
      seen.add(r.id);
    }
    return m.routes;
  }
  ensure(m.schema==='direct-buy-v1'&&m.routeVersion==='rh-ur-10-060b0e-v1'&&m.routes===undefined,'Unsupported schema/route');
  return [{id:m.routeVersion,fromBlock:0}];
}
// Dependencies belong to the versioned adapter, not mutable manifest fields.
// Historical cutoffs before activation must not acquire the new dependency.
function routeDependencies(input,height){
  const m=buyPolicyHistory(input).at(number(height));
  const active=routePolicy(m).filter(r=>r.fromBlock<=number(height));
  return [...(active.some(r=>r.id===PERMIT_ROUTE||r.id===AUTO.ID)?[PERMIT2]:[]),...(active.some(r=>r.id===AUTO.ID)?[{address:AUTO.ADDRESS,codeHash:AUTO.CODE_HASH}]:[])];
}
function validateManifest(m){
  const pons=PONS_PROFILES.get(m.schema);if(pons){pons.validate(m);return;}
  if(m.schema===INFINITY.SCHEMA){INFINITY.validate(m);return;}
  routePolicy(m);
  ensure(m.quoteDecimals===6&&m.entryThresholdRaw==='100000000','Expected 100 nominal USDG (6 decimals)');
  for(const field of ['router','manager','token','quote','registry','hook'])ensure(isAddress(m[field]),'Invalid '+field);
  ensure(low(m.token)!==low(m.quote),'Identical assets');
  const autoOnly=routePolicy(m).every(r=>r.id===AUTO.ID);
  if(autoOnly&&m.poolKey===undefined&&m.poolId===undefined){number(m.chainId);number(m.anchor.number);return;}
  ensure(Array.isArray(m.poolKey)&&m.poolKey.length===5,'Invalid pool key');
  const key=m.poolKey;
  ensure(BigInt(key[0])<BigInt(key[1]),'Unsorted currencies');
  ensure(key.slice(0,2).map(low).sort().join() === [m.token,m.quote].map(low).sort().join(),'Wrong pool assets');
  ensure(low(key[4])===low(m.hook),'Wrong hook');
  ensure(keccak256(coder.encode(['address','address','uint24','int24','address'],key))===low(m.poolId),'Wrong pool id');
  number(m.chainId);number(m.anchor.number);
}
// Shape validation ONLY for a proposed extension. NOT an upgrade admission API.
// Lifecycle snapshots commit the full manifest hash; replacing it breaks old FREEZE.
// Use versioned replay plus source admission, never this shape check alone.
// This function also cannot prove public announcement.
function validateRouteExtensionCandidate(previous,next,announcedAtBlock){
  validateManifest(previous);validateManifest(next);number(announcedAtBlock);
  ensure(next.schema==='direct-buy-v2','Expected scheduled routes');
  const strip=m=>{const x={...m};delete x.schema;delete x.routeVersion;delete x.routes;return x;};
  ensure(canonical(strip(previous))===canonical(strip(next)),'Unrelated manifest change');
  const before=routePolicy(previous),after=routePolicy(next);
  ensure(after.length>before.length,'No added routes');
  for(let i=0;i<before.length;i++)ensure(canonical(before[i])===canonical(after[i]),'Historical route changed');
  for(const r of after.slice(before.length))ensure(r.fromBlock>number(announcedAtBlock),'Activation must follow announcement');
}
// Local versioned replay input, not proof that an operator published a policy.
function buyPolicyHistory(input){
  if(input.schema!=='buy-policy-history-v1'){
    validateManifest(input);return {genesis:input,at:()=>input,versions:[]};
  }
  ensure(Array.isArray(input.versions)&&input.versions.length>0,'Empty BUY policy history');
  const versions=input.versions;
  const genesis=versions[0].manifest;validateManifest(genesis);
  ensure(versions[0].fromBlock===number(genesis.anchor.number),'Invalid policy genesis');
  for(let i=1;i<versions.length;i++){
    const v=versions[i],prev=versions[i-1];
    ensure(Number.isSafeInteger(v.fromBlock)&&v.fromBlock>prev.fromBlock,'Unordered policy activation');
    ensure(Number.isSafeInteger(v.announcedAtBlock)&&v.announcedAtBlock>=prev.fromBlock,'Invalid policy notice');
    ensure(/^0x[0-9a-fA-F]{64}$/.test(v.announcedBlockHash||''),'Missing policy notice anchor');
    validateRouteExtensionCandidate(prev.manifest,v.manifest,v.announcedAtBlock);
    const count=routePolicy(prev.manifest).length;
    ensure(v.manifest.routes.slice(count).every(r=>r.fromBlock===v.fromBlock),'Route/policy activation mismatch');
  }
  return {genesis,versions,at:height=>{
    ensure(Number.isSafeInteger(height)&&height>=versions[0].fromBlock,'Policy block required');
    return versions.filter(v=>v.fromBlock<=height).at(-1).manifest;
  }};
}
function decodeCanonical(types,data){
  const result=coder.decode(types,data);
  ensure(low(coder.encode(types,result))===low(data),'Non-canonical calldata');
  return result;
}
function swapLogs(m,receipt){
  return receipt.logs.filter(l=>low(l.address)===low(m.manager)&&low(l.topics[0])===low(SWAP_ABI.getEvent('Swap').topicHash))
    .map(log=>({log,swap:SWAP_ABI.parseLog(log).args}));
}
function decodeTransaction(m,tx,receipt,block){
  const pons=PONS_PROFILES.get(m.schema);if(pons)return pons.decode(m,tx,receipt,block);
  if(m.schema===INFINITY.SCHEMA)return INFINITY.decode(m,tx,receipt);
  const auto=m.routes?.find(r=>r.id===AUTO.ID);
  if(auto&&number(tx.blockNumber)>=auto.fromBlock&&tx.to&&low(tx.to)===AUTO.ADDRESS)
    return AUTO.decode(m,tx,receipt,{SWAP_ABI,TRANSFER_ABI});
  if(m.poolId===undefined)return [];
  const all=swapLogs(m,receipt);
  return all.filter(x=>low(x.swap.id)===low(m.poolId)).map(({log,swap})=>{
    const base={candidateId:[m.chainId,low(log.blockHash),low(log.transactionHash),number(log.logIndex)].join(':'),
      blockNumber:number(log.blockNumber),blockHash:low(log.blockHash),transactionHash:low(log.transactionHash),
      transactionIndex:number(log.transactionIndex),logIndex:number(log.logIndex),poolId:low(m.poolId),
      payer:null,recipient:null,grossQuoteRaw:null,evidenceLogIndexes:[number(log.logIndex)]};
    const result=(status,reason,extra={})=>({...base,...extra,status,reason});
    const quote0=low(m.poolKey[0])===low(m.quote);
    const q=quote0?swap.amount0:swap.amount1,t=quote0?swap.amount1:swap.amount0;
    if(q>0n&&t<0n)return result('INELIGIBLE','SELL');
    if(q>=0n||t<=0n)return result('AMBIGUOUS','INVALID_BUY_DELTAS');
    if(!tx.to||low(tx.to)!==low(m.router))return result('UNSUPPORTED_ROUTE','NOT_DIRECT_ROUTER_CALL');
    if(all.length!==1)return result('UNSUPPORTED_ROUTE','MULTIPLE_POOL_SWAPS');
    try{
      ensure(BigInt(receipt.status)===1n,'Failed transaction');
      const parsed=EXECUTE_ABI.parseTransaction({data:tx.input});
      if(!parsed)return result('UNSUPPORTED_ROUTE','COMMAND_SEQUENCE');
      const commands=parsed.args.commands,hasPermit=commands==='0x0a10';
      if((commands!=='0x10'&&!hasPermit)||parsed.args.inputs.length!==(hasPermit?2:1))return result('UNSUPPORTED_ROUTE','COMMAND_SEQUENCE');
      // Preserve legacy decisions/hashes, including rejection reasons before opt-in.
      const policy=m.schema===undefined?[{id:'rh-ur-10-060b0e-v1',fromBlock:0}]:routePolicy(m);
      if(hasPermit&&!policy.some(r=>r.id===PERMIT_ROUTE))return result('UNSUPPORTED_ROUTE','COMMAND_SEQUENCE');
      if(low(EXECUTE_ABI.encodeFunctionData('execute',parsed.args))!==low(tx.input))return result('UNSUPPORTED_ROUTE','NON_CANONICAL_CALLDATA');
      const [actions,parameters]=decodeCanonical(['bytes','bytes[]'],parsed.args.inputs[hasPermit?1:0]);
      const route=policy.find(r=>ROUTES[r.id]===commands+':'+actions);
      if(!route||parameters.length!==3)return result('UNSUPPORTED_ROUTE','ACTION_SEQUENCE');
      if(number(log.blockNumber)<route.fromBlock)return result('UNSUPPORTED_ROUTE','ROUTE_NOT_ACTIVE');
      const [spec]=decodeCanonical([SWAP_TYPE],parameters[0]);
      const [key,zeroForOne,amountIn,minimum,price,hookData]=spec;
      if(keccak256(coder.encode(['address','address','uint24','int24','address'],key))!==low(m.poolId))return result('AMBIGUOUS','CALLDATA_POOL_MISMATCH');
      if(zeroForOne!==quote0||amountIn===0n||price!==0n||hookData!=='0x')return result('UNSUPPORTED_ROUTE','SWAP_PARAMETERS');
      if(hasPermit){
        const [permit,signature]=decodeCanonical([PERMIT_TYPE,'bytes'],parsed.args.inputs[0]);
        // Signature/nonce/deadline validity is enforced by actual Permit2 execution:
        // exact commands prohibit ALLOW_REVERT. Do not invent a second EOA-only verifier.
        if(low(permit[0][0])!==low(m.quote)||low(permit[1])!==low(m.router)||signature==='0x')
          return result('UNSUPPORTED_ROUTE','PERMIT_PARAMETERS');
        if(permit[0][1]<-q)return result('AMBIGUOUS','PERMIT_AMOUNT_MISMATCH');
      }
      const payer=low(tx.from);let recipient=payer;
      if(actions==='0x060b0e'){
        const [settleCurrency,settleAmount,payerIsUser]=decodeCanonical(['address','uint256','bool'],parameters[1]);
        const [takeCurrency,takeRecipient,takeAmount]=decodeCanonical(['address','address','uint256'],parameters[2]);
        if(low(settleCurrency)!==low(m.quote)||low(takeCurrency)!==low(m.token)||settleAmount!==0n||takeAmount!==0n||!payerIsUser)
          return result('UNSUPPORTED_ROUTE','SETTLEMENT_PARAMETERS');
        recipient=BigInt(takeRecipient)===1n?payer:low(takeRecipient);
      }else{
        const [settleCurrency,maxAmount]=decodeCanonical(['address','uint256'],parameters[1]);
        const [takeCurrency,minAmount]=decodeCanonical(['address','uint256'],parameters[2]);
        if(low(settleCurrency)!==low(m.quote)||low(takeCurrency)!==low(m.token))return result('UNSUPPORTED_ROUTE','SETTLEMENT_PARAMETERS');
        if(-q>maxAmount||t<minAmount)return result('AMBIGUOUS','SETTLEMENT_LIMIT_MISMATCH');
      }
      const attributed={payer,recipient,grossQuoteRaw:String(-q)};
      if(payer!==recipient)return result('UNSUPPORTED_ROUTE','PAYER_RECIPIENT_DIFFER',attributed);
      if(low(swap.sender)!==low(m.router)||BigInt(tx.value)!==0n||-q>amountIn||t<minimum)
        return result('AMBIGUOUS','SWAP_EXECUTION_MISMATCH',attributed);
      const transfers=receipt.logs.filter(l=>[low(m.token),low(m.quote)].includes(low(l.address))&&low(l.topics[0])===low(TRANSFER_ABI.getEvent('Transfer').topicHash))
        .map(l=>({log:l,...TRANSFER_ABI.parseLog(l).args.toObject()}));
      const payment=transfers.filter(x=>low(x.log.address)===low(m.quote)&&low(x.from)===payer&&low(x.to)===low(m.manager)&&x.value===-q);
      const delivery=transfers.filter(x=>low(x.log.address)===low(m.token)&&low(x.from)===low(m.manager)&&low(x.to)===recipient&&x.value===t);
      // Intentionally narrow: unexpected service fees/transfers are visible, not guessed.
      if(transfers.length!==2||payment.length!==1||delivery.length!==1||number(payment[0].log.logIndex)<=number(log.logIndex)||number(delivery[0].log.logIndex)<=number(payment[0].log.logIndex))
        return result('AMBIGUOUS','SETTLEMENT_TRANSFER_MISMATCH',attributed);
      return result('ELIGIBLE','SUPPORTED_BUY', {...attributed,evidenceLogIndexes:[number(log.logIndex),number(payment[0].log.logIndex),number(delivery[0].log.logIndex)]});
    }catch{return result('AMBIGUOUS','MALFORMED_OR_INCONSISTENT_EVIDENCE');}
  });
}

// Replay a complete branch from the anchor before registration deployment.
// Branch replacement is full replay; stale committed draws are NOT repaired here.
function replayEngine(input,deliveredBlocks,previous=null,capture=false){
  const policy=buyPolicyHistory(input),m=policy.genesis;
  ensure(!input.recognition||!previous,"Recognition requires full project replay");
  const manifestHash=hash(input),checkpoint=previous?.checkpoint,prior=previous?.ledger;
  if(previous){
    ensure(checkpoint?.schema==='buy-replay-checkpoint-v1'&&checkpoint.manifestHash===manifestHash,'Replay checkpoint policy mismatch');
    ensure(prior?.manifestHash===manifestHash&&checkpoint.ledgerHash===hash(prior),'Replay checkpoint ledger mismatch');
    ensure(canonical(checkpoint.head)===canonical(prior.head)&&Number.isSafeInteger(prior.head.number)&&prior.head.number>=number(m.anchor.number),'Replay checkpoint head mismatch');
    ensure(typeof checkpoint.registryDeployed==='boolean'&&Array.isArray(checkpoint.txHashes),'Invalid replay checkpoint');
    ensure(checkpoint.txHashes.every(x=>/^0x[0-9a-f]{64}$/.test(x))&&new Set(checkpoint.txHashes).size===checkpoint.txHashes.length,'Invalid checkpoint transactions');
  }
  const byNumber=new Map();
  for(const b of deliveredBlocks){const n=number(b.number);if(byNumber.has(n))ensure(canonical(byNumber.get(n))===canonical(b),'Conflicting block delivery');else byNumber.set(n,b);}
  const blocks=[...byNumber.values()].sort((a,b)=>number(a.number)-number(b.number));
  const headers=new Map([[number(m.anchor.number),low(m.anchor.hash)],...blocks.map(b=>[number(b.number),low(b.hash)])]);
  for(const v of policy.versions.slice(1))if(!previous||v.announcedAtBlock>prior.head.number)ensure(headers.get(v.announcedAtBlock)===low(v.announcedBlockHash),'Policy notice not on supplied branch');
  let parent=previous?prior.head.hash:low(m.anchor.hash),height=previous?prior.head.number:number(m.anchor.number);
  const registrations=new Map((prior?.registrations||[]).map(r=>[r.participant,r]));
  const wallets=new Map((prior?.wallets||[]).map(w=>[w.wallet,{carryRaw:BigInt(w.carryRaw),entriesMinted:BigInt(w.entriesMinted)}])),decisions=[...(prior?.decisions||[])];
  const automatic=!!PONS_PROFILES.get(m.schema)||m.schema===INFINITY.SCHEMA;
  let registryDeployed=checkpoint?.registryDeployed??false;
  const txHashes=new Set(checkpoint?.txHashes||[]);
  for(const b of blocks){
    const project=!!b.projectEvidence;
    if(project)require('./project-history.cjs').validate(b,input,{number:height,hash:parent});
    else ensure(number(b.number)===height+1&&low(b.parentHash)===parent,'Non-contiguous canonical branch');
    if(b.ponsOmission!==undefined){ensure(!!PONS_PROFILES.get(m.schema),'Pons omission on other venue');require('./pons-bloom-evidence.cjs').validateOmission(b,policy.at(number(b.number)));}
    const events=[],logIndexes=new Set();
    const txs=[...b.transactions].sort((a,c)=>number(a.tx.transactionIndex)-number(c.tx.transactionIndex));
    for(let i=0;i<txs.length;i++){
      const {tx,receipt}=txs[i];
      const txIndex=number(tx.transactionIndex);
      ensure(project?i===0||txIndex>number(txs[i-1].tx.transactionIndex):txIndex===i,'Missing/duplicate transaction index');
      ensure(!txHashes.has(low(tx.hash)),'Duplicate canonical transaction');txHashes.add(low(tx.hash));
      ensure(low(tx.blockHash)===low(b.hash)&&number(tx.blockNumber)===number(b.number),'Transaction block mismatch');
      ensure(low(receipt.transactionHash)===low(tx.hash)&&low(receipt.blockHash)===low(b.hash)&&number(receipt.blockNumber)===number(b.number)&&number(receipt.transactionIndex)===txIndex,'Receipt mismatch');
      ensure(low(receipt.from)===low(tx.from)&&low(receipt.to||'0x')===low(tx.to||'0x'),'Receipt sender/target mismatch');
      ensure(require('./transaction-chain.cjs').matchesChain(tx,m.chainId),'Transaction chain mismatch');
      ensure(BigInt(receipt.status)===1n||receipt.logs.length===0,'Failed transaction has logs');
      if(receipt.contractAddress&&low(receipt.contractAddress)===low(m.registry)&&BigInt(receipt.status)===1n)registryDeployed=true;
      const unique=new Map();
      for(const l of receipt.logs){
        ensure(!l.removed&&low(l.blockHash)===low(b.hash)&&number(l.blockNumber)===number(b.number)&&low(l.transactionHash)===low(tx.hash)&&number(l.transactionIndex)===txIndex,'Log provenance mismatch');
        const index=number(l.logIndex);
        if(unique.has(index)){ensure(canonical(unique.get(index))===canonical(l),'Conflicting log delivery');continue;}
        ensure(!logIndexes.has(index),'Duplicate log index across transactions');logIndexes.add(index);unique.set(index,l);
        if(!automatic&&low(l.address)===low(m.registry)&&low(l.topics[0])===low(REGISTER_ABI.getEvent('Registered').topicHash)){
          ensure(registryDeployed,'Registration before deployment');
          events.push({kind:'register',index,participant:low(REGISTER_ABI.parseLog(l).args.participant),blockNumber:number(b.number),blockHash:low(b.hash),transactionHash:low(tx.hash),transactionIndex:i});
        }
      }
      for(const d of decodeTransaction(policy.at(number(b.number)),tx,{...receipt,logs:[...unique.values()].sort((a,c)=>number(a.logIndex)-number(c.logIndex))},b))events.push({kind:'swap',index:d.logIndex,decision:d});
    }
    if(!project)ensure([...logIndexes].sort((a,b)=>a-b).every((index,i)=>index===i),'Missing receipt log index');
    for(const e of events.sort((a,b)=>a.index-b.index)){
      if(e.kind==='register'){
        ensure(!registrations.has(e.participant),'Duplicate registration in canonical history');
        const {kind,index,...record}=e;registrations.set(e.participant,{...record,logIndex:index});
      }else{
        const d=e.decision;
        if(!automatic&&d.status==='ELIGIBLE'&&!registrations.has(d.payer)){d.status='INELIGIBLE';d.reason='NOT_REGISTERED_AT_SWAP';}
        if(d.status==='ELIGIBLE'){
          const w=wallets.get(d.payer)||{carryRaw:0n,entriesMinted:0n};
          const x=w.carryRaw+BigInt(d.grossQuoteRaw),threshold=BigInt(m.entryThresholdRaw);
          d.entriesMinted=String(x/threshold);w.entriesMinted+=x/threshold;w.carryRaw=x%threshold;wallets.set(d.payer,w);
        }else d.entriesMinted='0';
        decisions.push(d);
      }
    }
    height=number(b.number);parent=low(b.hash);
  }
  ensure(automatic||registryDeployed,'Range must include registry deployment; imported carry is not supported');
  const ledger={schema:'direct-buy-ledger-v1',manifestHash,head:{number:height,hash:parent},
    finality:'canonical-in-supplied-branch-not-eligible-for-commit',
    registrations:[...registrations.values()].sort((a,b)=>a.participant.localeCompare(b.participant)),decisions,
    wallets:[...wallets].sort(([a],[b])=>a.localeCompare(b)).map(([wallet,w])=>({wallet,carryRaw:String(w.carryRaw),entriesMinted:String(w.entriesMinted),shortAttemptsMinted:String(w.entriesMinted),monthlyAttemptsMinted:String(w.entriesMinted)}))};
  if(input.recognition)require('./purchase-recognition.cjs').apply(input,blocks,ledger);
  return {ledger,checkpoint:capture?{schema:'buy-replay-checkpoint-v1',manifestHash,head:ledger.head,ledgerHash:hash(ledger),registryDeployed,txHashes:[...txHashes]}:null};
}
function replay(input,blocks){return replayEngine(input,blocks).ledger;}
// Only for an integrity-checked local snapshot. Public consumers still replay evidence.
function replayWithCheckpoint(input,blocks,previous=null){return replayEngine(input,blocks,previous,true);}
module.exports={buyPolicyHistory,validateRouteExtensionCandidate,replay,replayWithCheckpoint,decodeTransaction,canonical,hash,validateManifest,routeDependencies,PERMIT_TYPE,SWAP_ABI,TRANSFER_ABI,REGISTER_ABI,EXECUTE_ABI,SWAP_TYPE};
