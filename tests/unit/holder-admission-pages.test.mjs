import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,keccak256} from 'ethers';
import {collectHolderSnapshot} from '../../src/holders/snapshot.mjs';
import {verifyHolderSnapshotPage} from '../../src/holders/admission.mjs';
import {identity} from '../../src/holders/values.mjs';
const abi=new Interface(['function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)']);
async function fixture(count){
 const token='0x'+'a'.repeat(40),scope={projectId:'55555555-5555-4555-8555-555555555555',chainId:4663,token,asset:'0x'+'0'.repeat(40)};
 const rows=Array.from({length:count},(_,i)=>({wallet:'0x'+(i+1).toString(16).padStart(40,'0'),balance:'1'}));
 const candidate=await collectHolderSnapshot({chainId:4663,token,maxPages:1,maxHolders:count,observedAt:1000,fetchPage:async()=>({token,holders:count,supply:String(count),as_of:{rollup_bucket:1,tail_from_block:1},page:rows,next_cursor:null})});
 const policy={schema:'holder-snapshot-policy-v1',scopeId:identity(scope),semantics:'reviewed-nonproxy-erc20-supply-sum',tokenCodeHash:keccak256('0x6000'),maxHolders:count,maxRpcCalls:count+8,maxAgeSeconds:86400};
 let calls=0,latest=100,fail=false;
 const tags=[];const provider={send:async(method,args)=>{
  calls++;if(fail)throw Error('network outage');
  if(method==='eth_chainId')return '0x1237';
  if(method==='eth_getBlockByNumber'){const n=args[0]==='finalized'?latest:Number(BigInt(args[0]));return {number:'0x'+n.toString(16),timestamp:'0x3e8',hash:'0x'+n.toString(16).padStart(64,'0')};}
  if(method==='eth_getCode'){tags.push(args[1]);return '0x6000';}
  if(method==='eth_call'){tags.push(args[1]);const call=abi.parseTransaction({data:args[0].data});return abi.encodeFunctionResult(call.name,[call.name==='totalSupply'?count:1]);}
  throw Error('Unexpected method');
 }};
 return {args:{provider,candidate,policy,scope,period:1,dueAt:900,until:100000,now:1100,maxItems:100},tags,calls:()=>calls,head:n=>latest=n,fail:v=>fail=v};
}
test('5000 holders complete across 50 bounded passes at one fixed block',async()=>{
 const f=await fixture(5000);let progress=null,result;
 for(let page=0;page<50;page++){
  f.head(100+page);result=await verifyHolderSnapshotPage({...f.args,now:1100+page*100,progress});
  assert.ok(result.rpcCalls<=106);assert.equal(result.progress.cursor,(page+1)*100);
  assert.equal(!!result.proof,page===49);progress=JSON.parse(JSON.stringify(result.progress));
 }
 assert.equal(result.proof.totalSupply,'5000');assert.equal(result.proof.block.number,100);assert.equal(result.proof.executionEnabled,false);
 assert.deepEqual([...new Set(f.tags)],['0x64']);
});
test('failed page preserves caller checkpoint; changed policy, checksum data and stale input fail before reads',async()=>{
 const f=await fixture(4),args={...f.args,maxItems:1};
 const first=await verifyHolderSnapshotPage(args),saved=JSON.stringify(first.progress);
 f.fail(true);await assert.rejects(verifyHolderSnapshotPage({...args,progress:first.progress}),/outage/);assert.equal(JSON.stringify(first.progress),saved);f.fail(false);
 const before=f.calls();
 await assert.rejects(verifyHolderSnapshotPage({...args,progress:first.progress,policy:{...args.policy,maxAgeSeconds:80000}}),/binding changed/);
 await assert.rejects(verifyHolderSnapshotPage({...args,progress:{...first.progress,sum:'3'}}),/sum changed/);
 await assert.rejects(verifyHolderSnapshotPage({...args,progress:first.progress,now:90000}),/Stale/);
 assert.equal(f.calls(),before);
 const second=await verifyHolderSnapshotPage({...args,progress:JSON.parse(saved)});assert.equal(second.progress.cursor,2);assert.equal(second.proof,null);
});
