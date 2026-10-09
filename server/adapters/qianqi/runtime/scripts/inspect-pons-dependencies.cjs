// Read-only dependency inventory. Zero standard slots do NOT prove non-upgradeability.
const fs=require('node:fs'),{ethers}=require('ethers');
const slot=name=>ethers.toBeHex(BigInt(ethers.id('eip1967.proxy.'+name))-1n,32);
async function inspect(provider,expected){
 const chain=await provider.getNetwork();if(chain.chainId!==4663n)throw Error('Wrong chain');
 const head=await provider.getBlock('latest'),tag=head.number,addresses={...expected.addresses};
 const read=async(a,method)=>{try{return await new ethers.Contract(a,[`function ${method}() view returns(address)`],provider)[method]({blockTag:tag});}catch{return null;}};
 const operator=await read(addresses.hook,'feeSweepOperator');if(operator&&operator!==ethers.ZeroAddress)addresses.operator=operator;
 const out={schema:'pons-dependency-inventory-v1',observedAt:new Date().toISOString(),chainId:4663,block:{number:tag,hash:head.hash},publicSends:false,sourceVerification:false,contracts:{}};
 for(const [name,address]of Object.entries(addresses)){
  const code=await provider.getCode(address,tag);if(code==='0x')throw Error('Missing runtime '+name);
  const row=out.contracts[name]={address,runtimeHash:ethers.keccak256(code),bytes:ethers.dataLength(code),previousHashMatches:expected.hashes[name]?ethers.keccak256(code)===expected.hashes[name]:null,slots:{},getters:{}};
  for(const key of ['implementation','admin','beacon']){
   const value=await provider.getStorage(address,slot(key),tag);row.slots[key]=value;
   if(key!=='admin'&&BigInt(value)!==0n){const target=ethers.getAddress('0x'+value.slice(-40));const targetCode=await provider.getCode(target,tag);row[key]={address:target,runtimeHash:ethers.keccak256(targetCode),bytes:ethers.dataLength(targetCode)};
    if(key==='beacon'){const impl=await read(target,'implementation');if(impl){const c=await provider.getCode(impl,tag);row.beaconImplementation={address:impl,runtimeHash:ethers.keccak256(c),bytes:ethers.dataLength(c)};}}
   }
  }
  for(const method of ['owner','pendingOwner','admin','implementation','factory','feeEscrow','feeSweepOperator','poolManager'])row.getters[method]=await read(address,method);
 }
 if((await provider.getBlock(tag)).hash!==head.hash)throw Error('Snapshot reorg');
 out.limitations=['Read failures of optional getters are null, not absence of authority','Standard EIP1967 slots only; custom proxies and mutable external dependencies require source review','Runtime equality is not source verification or authorization to deploy'];return out;
}
if(require.main===module)(async()=>{const [input,output]=process.argv.slice(2);if(!input||!output||fs.existsSync(output))throw Error('Supply input snapshot and new output file');const url=process.env.RH_RPC_URL;if(!url||new URL(url).protocol!=='https:')throw Error('HTTPS RPC required');const p=new ethers.JsonRpcProvider(url);try{const out=await inspect(p,JSON.parse(fs.readFileSync(input)));fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({block:out.block,contracts:Object.keys(out.contracts),publicSends:false}));}finally{p.destroy();}})().catch(()=>{console.error('Dependency inspection failed; no RPC URL emitted');process.exitCode=1;});
module.exports={inspect,slot};
