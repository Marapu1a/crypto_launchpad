const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {ethers}=require('ethers'),P=require('../../scripts/pons-curve-buy.cjs'),D=require('../../scripts/direct-buy.cjs');
const {indexOnce}=require('../../scripts/persistent-buy-indexer.cjs');
function fixture(t){
 const addr=n=>'0x'+BigInt(n).toString(16).padStart(40,'0'),wallet=addr(100);
 const m={schema:P.SCHEMA,routeVersion:P.ID,eligibility:'automatic-buy-v1',quoteBasis:'wallet-net-debit-v1',chainId:4663,quoteDecimals:6,entryThresholdRaw:'100000000',anchor:{number:10,hash:ethers.id('anchor')},codeHashes:{}};
 for(const [i,k]of P.FIELDS.entries()){m[k]=addr(i+10);m.codeHashes[k]=ethers.keccak256('0x01');}m.quote='0x5fc5360d0400a0fd4f2af552add042d716f1d168';
 const blocks=[];
 for(const [i,amount]of [60000000n,40000000n].entries()){
  const n=11+i,bh=ethers.id('block'+n),th=ethers.id('tx'+n),logs=[];
  const emit=(abi,event,args,address)=>logs.push({address,...abi.encodeEventLog(abi.getEvent(event),args)});
  emit(P.TRANSFER,'Transfer',[wallet,m.curve,amount],m.quote);emit(P.TRANSFER,'Transfer',[m.curve,wallet,amount*2n],m.token);emit(P.EVENTS,'CurveBuy',[wallet,wallet,amount,amount*2n,amount/100n,amount*3n/100n],m.curve);
  const tx={hash:th,blockHash:bh,blockNumber:n,transactionIndex:0,from:wallet,to:m.curve,chainId:4663,value:'0x0',input:P.CALL.encodeFunctionData('buy',[amount,amount*2n,wallet])};
  const receipt={transactionHash:th,blockHash:bh,blockNumber:n,transactionIndex:0,from:wallet,to:m.curve,status:1,logs:logs.map((l,j)=>({...l,blockHash:bh,blockNumber:n,transactionHash:th,transactionIndex:0,logIndex:j,removed:false}))};
  blocks.push({number:n,hash:bh,parentHash:blocks.at(-1)?.hash??m.anchor.hash,timestamp:n,transactions:[{tx,receipt}]});
 }
 const factory=new ethers.Interface(require('../../scripts/integrations/pons-v2.cjs').FAB),getters=new ethers.Interface(['function token() view returns(address)','function pairToken() view returns(address)','function factory() view returns(address)','function feePolicy() view returns(address)']);
 const calls=[],flags={badBinding:false,outage:false};
 const rpc=async(method,params=[])=>{
  calls.push([method,params]);if(flags.outage)throw Error('offline');
  if(method==='eth_chainId')return '0x1237';if(method==='eth_getCode')return '0x01';
  if(method==='eth_getTransactionReceipt')return blocks.flatMap(b=>b.transactions).find(x=>x.tx.hash===params[0]).receipt;
  if(method==='eth_getBlockByNumber'){const n=params[0]==='finalized'?blocks.at(-1).number:Number(BigInt(params[0]));if(n===10)return m.anchor;const b=blocks.find(b=>b.number===n);return {...b,transactions:params[1]?b.transactions.map(x=>x.tx):[]};}
  if(method==='eth_call'){
   const [call,tag]=params;const f=factory.parseTransaction({data:call.data});
   if(f?.name==='getLaunchedToken')return factory.encodeFunctionResult(f.name,[[m.token,flags.badBinding&&tag==='0xc'?addr(999):m.curve,wallet,wallet,m.quote,8090000000n,0,200,300,false,0,0,0,0,true]]);
   if(f?.name==='memeHook')return factory.encodeFunctionResult(f.name,[m.hook]);
   const g=getters.parseTransaction({data:call.data});return getters.encodeFunctionResult(g.name,[m[{token:'token',pairToken:'quote',factory:'factory',feePolicy:'hook'}[g.name]]]);
  }throw Error(method);
 };
 const statePath='.local/logs/pons-index-test-'+crypto.randomUUID()+'.json';t.after(()=>{if(fs.existsSync(statePath))fs.unlinkSync(statePath);});
 const config={manifest:m,buyPolicyMode:'unadmitted'},run=opts=>indexOnce({config,rpc,statePath,...opts}),read=()=>JSON.parse(fs.readFileSync(statePath));
 function replace(){blocks[1]={...blocks[1],hash:ethers.id('replacement'),transactions:[]};}
 return {m,blocks,calls,flags,run,read,replace,statePath,config,rpc};
}
module.exports={fixture};
