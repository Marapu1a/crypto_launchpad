// Read-only bounded archive capability probe. Never constructs a signer or sends a transaction.
const fs=require('node:fs'),{ethers}=require('ethers');
const USDG='0x5fc5360d0400a0fd4f2af552add042d716f1d168';
async function inspectHistoricalRpc({rpc,quote=USDG,depths=[0,10000,864000]}){
 if(!ethers.isAddress(quote)||depths.length>4||!depths.length||depths.some(n=>!Number.isSafeInteger(n)||n<0))throw Error('Invalid bounded probe');
 const out={schema:'public-rpc-capabilities-v1',observedAt:new Date().toISOString(),quote,observations:[],historicalReadsAvailable:false,publicLaunchReady:false};
 try{
  out.chainId=String(BigInt(await rpc('eth_chainId',[])));if(out.chainId!=='4663')throw Error('Wrong chain');
  const latest=await rpc('eth_getBlockByNumber',['latest',false]),finalized=await rpc('eth_getBlockByNumber',['finalized',false]);
  if(!latest?.hash||!finalized?.hash||BigInt(finalized.number)>BigInt(latest.number))throw Error('Missing/inconsistent heads');
  out.latest={number:latest.number,hash:latest.hash,timestamp:latest.timestamp};out.finalized={number:finalized.number,hash:finalized.hash,timestamp:finalized.timestamp};
  out.finalizedLagBlocks=String(BigInt(latest.number)-BigInt(finalized.number));
  const abi=new ethers.Interface(['function decimals() view returns(uint8)','function totalSupply() view returns(uint256)']);
  for(const depth of depths){
   const n=BigInt(finalized.number)-BigInt(depth);if(n<0n)throw Error('Probe height before genesis');
   const tag=ethers.toQuantity(n),row={number:tag,depthBlocks:depth};out.observations.push(row);
   try{
    const b=await rpc('eth_getBlockByNumber',[tag,false]);if(!b?.hash||BigInt(b.number)!==n)throw Error('Missing historical block');row.hash=b.hash;
    const code=await rpc('eth_getCode',[quote,tag]);if(!ethers.isHexString(code)||code==='0x')throw Error('Missing historical code');row.codeHash=ethers.keccak256(code);
    row.decimals=String(abi.decodeFunctionResult('decimals',await rpc('eth_call',[{to:quote,data:abi.encodeFunctionData('decimals')},tag]))[0]);
    row.totalSupply=String(abi.decodeFunctionResult('totalSupply',await rpc('eth_call',[{to:quote,data:abi.encodeFunctionData('totalSupply')},tag]))[0]);
    row.storageSlot0=await rpc('eth_getStorageAt',[quote,'0x0',tag]);if(!ethers.isHexString(row.storageSlot0,32))throw Error('Invalid historical storage');
    if((await rpc('eth_getBlockByNumber',[tag,false]))?.hash!==row.hash)throw Error('Historical block changed');
    row.ok=row.decimals==='6';if(!row.ok)row.error='Unexpected USDG decimals';
   }catch(e){row.ok=false;row.error=e.message;}
  }
  if((await rpc('eth_getBlockByNumber',[finalized.number,false]))?.hash!==finalized.hash)throw Error('Finalized observation changed');
  out.historicalReadsAvailable=out.observations.every(r=>r.ok);
 }catch(e){out.error=e.message;}
 out.limitation='Sampled USDG code/call/storage availability, not a full archive SLA or a read of our not-yet-deployed checkpoint storage. No signing/deployment/finality proof.';
 return out;
}
async function main(){
 const file=process.argv[2],url=process.env.RH_RPC_URL||'https://rpc.mainnet.chain.robinhood.com';
 if(!file||fs.existsSync(file))throw Error('New output path required');
 let id=0;const rpc=async(method,params)=>{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(j.error)throw Error(j.error.message);return j.result;};
 const out=await inspectHistoricalRpc({rpc});out.endpointOrigin=new URL(url).origin;
 fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({historicalReadsAvailable:out.historicalReadsAvailable,error:out.error,observations:out.observations.map(x=>({number:x.number,ok:x.ok,error:x.error}))}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={inspectHistoricalRpc,USDG};
