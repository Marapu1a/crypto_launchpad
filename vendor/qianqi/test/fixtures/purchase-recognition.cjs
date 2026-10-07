// Captured router evidence + explicitly synthetic confirmation/draw history.
const E=require('ethers'),D=require('../../scripts/direct-buy.cjs'),R=require('../../scripts/purchase-recognition.cjs'),L=require('../../scripts/attempt-lifecycle.cjs'),P=require('../../scripts/pons-curve-buy.cjs');
const addr=n=>E.getAddress('0x'+BigInt(n).toString(16).padStart(40,'0'));
function fixture(name='usdg'){
 const f=structuredClone(require('./pons-router-research/'+name+'.json')),m=f.manifest,wallet=f.tx.from.toLowerCase(),codes=structuredClone(require('./pons-router-research/runtime-codes.json'));
 const recognition={schema:'purchase-recognition-v1',source:addr(991),sourceCodeHash:E.keccak256('0x01'),publisher:addr(992),instanceId:E.id('synthetic recognition'),adapter:'pons-router-65050-v1',implementations:{quote:{address:'0x68184c449e1a8f34fa18d289737129fd27b66f8f',codeHash:'0x3a551ac5c744af57e68a1d1431ac403c0f516ffd7d224a75746aee11fc4f3baf'},weth:{address:'0xc6b81b429797e0f555440b70cd99e032d7ae947e',codeHash:'0xbe1295f37be34ffe03ad779bda0ef278907e1856b51a3be2f35ee541d75d4650'}}};
 const manifest=R.attach(m,recognition),config={schema:'attempt-lifecycle-v1',instanceId:E.id('synthetic draw'),source:addr(993),sourceCodeHash:E.keccak256('0x02')};
 const blocks=[{number:f.tx.blockNumber,hash:f.tx.blockHash,parentHash:E.id('captured parent not retained'),timestamp:1791060000,transactions:[{tx:f.tx,receipt:f.receipt}]}];
 // Saved deadline precedes synthetic wall clock in some fixtures; use its actual bound.
 blocks[0].timestamp=Number(require('../../scripts/pons-router-calldata-research.cjs').decode(m,f.tx).deadline)-1;
 const proof={transactionHash:f.tx.hash.toLowerCase(),blockHash:f.tx.blockHash.toLowerCase(),trace:f.trace,codeHashes:Object.fromEntries(Object.entries(codes).map(([a,c])=>[a,E.keccak256(c)])),parentCodeHashes:Object.fromEntries(Object.entries(codes).map(([a,c])=>[a,E.keccak256(c)]))};
 function bundle(proofs=[proof]){return {schema:'purchase-recognition-bundle-v1',instanceId:recognition.instanceId,chainId:String(m.chainId),token:m.token.toLowerCase(),proofs:structuredClone(proofs)};}
 function append(to,input,logs=[],from=wallet){
  const number=Number(BigInt(blocks.at(-1).number))+1,hash=E.id('synthetic recognition block '+number),th=E.id('synthetic recognition tx '+number);
  const tx={hash:th,blockHash:hash,blockNumber:number,transactionIndex:0,chainId:m.chainId,from,to,input,value:'0x0'};
  const receipt={transactionHash:th,blockHash:hash,blockNumber:number,transactionIndex:0,from,to,status:1,logs:logs.map((l,i)=>({...l,blockHash:hash,blockNumber:number,transactionHash:th,transactionIndex:0,logIndex:i,removed:false}))};
  const b={number,hash,parentHash:blocks.at(-1).hash,timestamp:Number(blocks.at(-1).timestamp)+1,transactions:[{tx,receipt}]};blocks.push(b);return b;
 }
 const log=(abi,event,args,address)=>({address,...abi.encodeEventLog(abi.getEvent(event),args)});
 function buy(amount=101000000n){return append(m.curve,P.CALL.encodeFunctionData('buy',[amount,amount*2n,wallet]),[log(P.TRANSFER,'Transfer',[wallet,m.curve,amount],m.quote),log(P.TRANSFER,'Transfer',[m.curve,wallet,amount*2n],m.token),log(P.EVENTS,'CurveBuy',[wallet,wallet,amount,amount*2n,amount/100n,amount*3n/100n],m.curve)]);}
 function confirm(b=bundle()){
  const key=D.hash(b),out=append(recognition.source,R.ABI.encodeFunctionData('confirm',[key,b.proofs.length]),[log(R.ABI,'PurchasesRecognized',[recognition.instanceId,key,b.proofs.length],recognition.source)],recognition.publisher);
  out.recognitionSourceCode='0x01';out.recognitionBundles={[key]:b};return out;
 }
 function head(){return {blockNumber:Number(BigInt(blocks.at(-1).number)),blockHash:blocks.at(-1).hash};}
 function freeze(kind,count,first=1,cutoff=head()){
  const drawId=E.id(kind+blocks.length),rulesHash=E.id('synthetic rules'),participants=count?[{wallet,count:String(count),firstAttempt:String(first),lastAttempt:String(first+count-1)}]:[];
  const snapshot=L.snapshotFor(L.domainFor(m,config),drawId,kind,cutoff,rulesHash,participants),snapshotHash=D.hash(snapshot);
  append(config.source,'0x',[log(L.ABI,'AttemptsFrozen',[drawId,kind==='SHORT'?0:1,cutoff.blockNumber,cutoff.blockHash,rulesHash,snapshotHash],config.source)]);return {drawId,kind,snapshotHash,snapshot};
 }
 function consume(d){append(config.source,'0x',[log(L.ABI,'AttemptsConsumed',[d.drawId,d.kind==='SHORT'?0:1,d.snapshotHash,0,E.id('synthetic outcome')],config.source)]);}
 const marked=()=>require('../../scripts/project-history.cjs').mark(blocks,manifest,config);
 return {m,manifest,recognition,config,blocks,wallet,proof,bundle,append,buy,confirm,head,freeze,consume,marked,run:()=>L.replayAttempts(manifest,config,marked())};
}
module.exports={fixture};
