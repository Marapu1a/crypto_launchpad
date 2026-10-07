// SYNTHETIC lifecycle/BUY branch extensions for reducer tests, not new fork execution.
// The initial branch is the preserved real local-fork direct-BUY evidence.
const fs=require('node:fs');
const {id,AbiCoder}=require('ethers');
const {ABI,domainFor,snapshotFor}=require('../../scripts/attempt-lifecycle.cjs');
const {hash,EXECUTE_ABI,SWAP_TYPE,SWAP_ABI,TRANSFER_ABI,REGISTER_ABI}=require('../../scripts/direct-buy.cjs');
const original=JSON.parse(fs.readFileSync('research/direct-buy/evidence.json','utf8'));
const clone=x=>structuredClone(x),coder=AbiCoder.defaultAbiCoder();
const addr=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const quantity=n=>'0x'+BigInt(n).toString(16);
function history(){
  const manifest=clone(original.manifest),blocks=clone(original.blocks);
  const config={schema:'attempt-lifecycle-v1',instanceId:id('synthetic promo instance'),source:addr(900),
    sourceCodeHash:id('SYNTHETIC fixture marker: not a verified deployment')};
  const wallet=original.sandboxFunding.wallet.toLowerCase();
  const sampleHash=original.observations.find(o=>o.label==='BUY 1 USDG').hash;
  const sample=original.blocks.flatMap(b=>b.transactions).find(t=>t.tx.hash===sampleHash);
  function head(){return {blockNumber:Number(BigInt(blocks.at(-1).number)),blockHash:blocks.at(-1).hash};}
  function append(label,to,input,logs,from=wallet){
    const height=BigInt(blocks.at(-1).number)+1n,blockHash=id('synthetic block '+height+' '+label),txHash=id('synthetic tx '+height+' '+label);
    const tx={...clone(sample.tx),hash:txHash,blockNumber:quantity(height),blockHash,transactionIndex:'0x0',to,from,input,value:'0x0'};
    const receipt={...clone(sample.receipt),transactionHash:txHash,blockNumber:tx.blockNumber,blockHash,transactionIndex:'0x0',to,from,contractAddress:null,
      logs:logs.map((l,i)=>({...l,blockHash,blockNumber:tx.blockNumber,transactionHash:txHash,transactionIndex:'0x0',logIndex:quantity(i),removed:false}))};
    blocks.push({number:tx.blockNumber,hash:blockHash,parentHash:blocks.at(-1).hash,timestamp:quantity(BigInt(blocks.at(-1).timestamp)+1n),transactions:[{tx,receipt}]});
    return blocks.at(-1);
  }
  function log(abi,event,args,address){return {address,...abi.encodeEventLog(abi.getEvent(event),args)};}
  function register(who){return append('register '+who,manifest.registry,'0x1aa3a008',[log(REGISTER_ABI,'Registered',[who],manifest.registry)],who);}
  function buy(raw,who=wallet){
    const quote0=manifest.poolKey[0].toLowerCase()===manifest.quote.toLowerCase(),out=BigInt(raw)*2n;
    const input=coder.encode(['bytes','bytes[]'],['0x060b0e',[
      coder.encode([SWAP_TYPE],[[manifest.poolKey,quote0,raw,1n,0n,'0x']]),
      coder.encode(['address','uint256','bool'],[manifest.quote,0,true]),
      coder.encode(['address','address','uint256'],[manifest.token,who,0])]]);
    return append('synthetic buy '+raw+' '+who,manifest.router,EXECUTE_ABI.encodeFunctionData('execute',['0x10',[input],9999999999n]),[
      log(SWAP_ABI,'Swap',[manifest.poolId,manifest.router,quote0?-BigInt(raw):out,quote0?out:-BigInt(raw),1,1,0,10000],manifest.manager),
      log(TRANSFER_ABI,'Transfer',[who,manifest.manager,raw],manifest.quote),
      log(TRANSFER_ABI,'Transfer',[manifest.manager,who,out],manifest.token)],who);
  }
  function participant(count,first=1n,who=wallet){return {wallet:who.toLowerCase(),count:String(count),firstAttempt:String(first),lastAttempt:String(BigInt(first)+BigInt(count)-1n)};}
  function freeze(name,kind,cutoff,participants,overrides={}){
    const drawId=id(name),rulesHash=id('test '+kind+' rules');
    const snapshot=snapshotFor(domainFor(manifest,config),drawId,kind,cutoff,rulesHash,participants);
    const snapshotHash=hash(snapshot),args={drawId,kind:kind==='SHORT'?0:1,cutoffBlockNumber:cutoff.blockNumber,cutoffBlockHash:cutoff.blockHash,rulesHash,snapshotHash,...overrides};
    append('freeze '+name,config.source,'0x',[log(ABI,'AttemptsFrozen',Object.values(args),config.source)]);
    return {drawId,kind,snapshotHash,snapshot};
  }
  function terminal(draw,outcome=0,overrides={}){
    const args={drawId:draw.drawId,kind:draw.kind==='SHORT'?0:1,snapshotHash:draw.snapshotHash,outcome,resultHash:id('test terminal '+draw.drawId),...overrides};
    return append('terminal '+draw.drawId,config.source,'0x',[log(ABI,'AttemptsConsumed',Object.values(args),config.source)]);
  }
  function empty(label){return append(label,wallet,'0x',[]);}
  return {manifest,config,blocks,wallet,head,append,log,register,buy,participant,freeze,terminal,empty};
}
function example(){
  const h=history(),cutoff=h.head();
  h.buy(300_000000n);
  const short=h.freeze('Short example 1','SHORT',cutoff,[h.participant(1)]);
  h.freeze('Monthly example 1','MONTHLY',h.head(),[h.participant(4)]);
  h.terminal(short,0);
  h.freeze('Short example 2','SHORT',h.head(),[h.participant(3,2)]);
  return {schema:'attempt-example-input-v1',mode:'SYNTHETIC lifecycle and added BUY events over saved local-fork evidence; not a production chain',
    manifest:h.manifest,lifecycle:h.config,blocks:h.blocks};
}
module.exports={history,example,addr,quantity};
