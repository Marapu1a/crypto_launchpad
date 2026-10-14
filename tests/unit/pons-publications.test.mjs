import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,id} from 'ethers';
import {rememberPublications,receiptPublicationSource} from '../../server/adapters/qianqi/pons-publications.mjs';
function fixture(){
 const abi=new Interface(['event DatasetChunk(bytes32 indexed proposalId,uint256 indexed index,bytes32 chunkHash,uint256 count)']);
 const source={target:'0x'+'1'.repeat(40),interface:abi},encoded=abi.encodeEventLog(abi.getEvent('DatasetChunk'),[id('proposal'),0,id('chunk'),2]);
 const receipt={status:1,hash:id('tx'),blockNumber:9,blockHash:id('block'),logs:[{...encoded,index:3,address:source.target,transactionHash:id('tx'),blockNumber:9,blockHash:id('block'),removed:false}]};
 let calls=0;const provider={getTransactionReceipt:async()=>{calls++;return receipt;},getBlock:async()=>({hash:id('block')})},state={};
 const filter={getTopicFilter:async()=>encoded.topics.slice(0,2)};
 return {source,receipt,provider,state,filter,get calls(){return calls;}};
}
test('known receipts supply publication events; repeated evidence is idempotent and ranges cost no scans',async()=>{
 const f=fixture();rememberPublications(f.state,f.receipt,[f.source]);rememberPublications(f.state,f.receipt,[f.source]);
 assert.equal(Object.keys(f.state.publications).length,1);
 const source=receiptPublicationSource(f.source,f.provider,()=>f.state.publications);
 assert.deepEqual(await source.queryFilter(f.filter,10,10000),[]);assert.equal(f.calls,0);
 const events=await source.queryFilter(f.filter,1,9);assert.equal(events.length,1);assert.equal(events[0].args.count,2n);assert.equal(f.calls,1);
});
test('missing, changed and reorged publication receipts fail rather than discovering logs',async()=>{
 for(const change of [f=>f.receipt.status=0,f=>f.receipt.logs[0].removed=true,f=>f.receipt.logs[0].address='0x'+'2'.repeat(40),f=>f.provider.getBlock=async()=>({hash:id('other')})]){
  const f=fixture();rememberPublications(f.state,f.receipt,[f.source]);change(f);
  await assert.rejects(receiptPublicationSource(f.source,f.provider,()=>f.state.publications).queryFilter(f.filter,1,9),/Publication/);
 }
 const f=fixture();rememberPublications(f.state,f.receipt,[f.source]);f.receipt.blockHash=id('other');assert.throws(()=>rememberPublications(f.state,f.receipt,[f.source]),/changed/);
});
