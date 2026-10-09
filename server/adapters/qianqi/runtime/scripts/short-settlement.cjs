const {pagedLogs}=require('./paged-log-read.cjs');
// Independent full-sort verifier and read-only recovery for the canonical path.
const {ethers}=require('ethers');
const model=require('./short-outcome.cjs');
const dataset=require('./short-dataset.cjs');
const coder=ethers.AbiCoder.defaultAbiCoder();
function compute(context,seed,participants,rules,prizes){
  const result=model.compute(context,seed,participants,rules,prizes);
  result.resultHash=ethers.keccak256(coder.encode(
    ['bytes32','bytes32','bytes32','bytes32','bytes32','bytes32',model.RESULT],
    [ethers.id('SHORT_DATASET_RESULT_V1'),context,seed,dataset.rootFor(participants),model.rulesHash(rules),
      ethers.keccak256(coder.encode(['uint256[]'],[prizes])),{...result,resultHash:ethers.ZeroHash}]));
  return result;
}
// Direct publish calldata transport only. Caller supplies the trusted deployment
// ABI/address and RPC; chain data availability and finality remain external duties.
async function recover(provider,source,drawId){
  const head=await provider.getBlock('latest'),at={blockTag:head.number};
  const state=await source.settlements(drawId,at);
  if(state.phase===0n)throw Error('Unknown settlement');
  const proposal=await source.datasetProposal(state.proposalId,at);
  const events=await pagedLogs(Number(proposal.request.cutoffBlockNumber)+1,head.number,(from,to)=>source.queryFilter(source.filters.DatasetChunk(state.proposalId),from,to));
  const chunks=[];
  for(const event of events){
    if(event.args.index!==BigInt(chunks.length))throw Error('Missing or duplicate chunk');
    const tx=await provider.getTransaction(event.transactionHash);
    if(!tx||tx.to?.toLowerCase()!==source.target.toLowerCase()||tx.blockHash!==event.blockHash)throw Error('Publication unavailable');
    const decoded=source.interface.parseTransaction({data:tx.data});
    if(decoded?.name!=='publish'||decoded.args[0]!==state.proposalId)throw Error('Unsupported publication transport');
    const chunk=Array.from(decoded.args[1],p=>({wallet:p.wallet,firstAttempt:p.firstAttempt,lastAttempt:p.lastAttempt}));
    const digest=ethers.keccak256(coder.encode([model.PARTICIPANTS],[chunk]));
    if(digest!==event.args.chunkHash||digest!==await source.datasetChunkHash(state.proposalId,chunks.length,at)
        ||BigInt(chunk.length)!==event.args.count)throw Error('Chunk commitment mismatch');
    chunks.push(chunk);
  }
  const participants=chunks.flat();
  if(BigInt(chunks.length)!==await source.datasetChunkCount(state.proposalId,at)
      ||BigInt(participants.length)!==proposal.count||dataset.rootFor(participants)!==proposal.root)throw Error('Incomplete dataset');
  const rules=(await source.shortEpochPolicy(proposal.request.rulesEpoch,at)).outcome;
  const prizes=Array.from(await source.datasetBasket(state.proposalId,at));
  const expected=state.phase>=2n?compute(proposal.context,state.seed,participants,rules,prizes):null;
  if((await provider.getBlock(head.number)).hash!==head.hash)throw Error('Chain changed; retry recovery');
  return {blockNumber:head.number,blockHash:head.hash,state,chunks,expected,
    nextAction:state.phase===1n?'waitSeed':state.phase===3n?'terminal':state.nextChunk<BigInt(chunks.length)?'processShort':'finishShort'};
}
module.exports={compute,recover};
