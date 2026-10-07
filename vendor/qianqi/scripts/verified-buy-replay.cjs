// A consumer's private, in-memory proof cache. Never imports the writer's ledger
// or checkpoint. Native digests compare complete JSON evidence, not just headers.
const {createHash}=require('node:crypto');
const {hash,replayWithCheckpoint}=require('./direct-buy.cjs');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createVerifiedBuyReplay(){
 let previous=null,metrics={mode:'empty',replayedBlocks:0};
 function replay(manifest,blocks){
  try{
   const identity=hash(manifest),digests=blocks.map(digest);
   const ordered=blocks.every((b,i)=>!i||BigInt(b.number)>BigInt(blocks[i-1].number));
   const extendsPrior=!manifest.recognition&&ordered&&previous&&identity===previous.identity&&blocks.length>=previous.digests.length&&previous.digests.every((d,i)=>d===digests[i]);
   const offset=extendsPrior?previous.digests.length:0;
   const unchanged=extendsPrior&&offset===blocks.length;
   const result=unchanged?previous.result:replayWithCheckpoint(manifest,blocks.slice(offset),extendsPrior?previous.result:null);
   metrics={mode:unchanged?'reused':extendsPrior?'checkpoint':'full',replayedBlocks:blocks.length-offset};
   previous=ordered?{identity,digests,result}:null;
   // Neither lifecycle reducers nor callers may mutate the privately verified base.
   return structuredClone(result.ledger);
  }catch(e){previous=null;metrics={mode:'failed',replayedBlocks:0};throw e;}
 }
 return {replay,metrics:()=>({...metrics})};
}
module.exports={createVerifiedBuyReplay};
