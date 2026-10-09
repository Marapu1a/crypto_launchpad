// Public admission is separate from journal/recovery and per-action gas accounting.
const {ethers}=require('ethers'),profile=require('./pons-public-profile.cjs');
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const check=(ok,message)=>{if(!ok)throw Error(message);};
const ACTIONS={
 vault:['claim'],adapter:['prove','deliver'],
 short:['checkpointCutoff','closeEmpty','begin','publish','seal','processShort','finishShort'],
 monthly:['checkpointCutoff','closeEmpty','beginMonth','publishMonth','sealMonth','processMonth','finishMonth'],
 collector:['pull','sync','pay','sweepCurve','sweepPool']
};
const OBLIGATIONS=new Set(['claim','prove','deliver','processShort','finishShort','processMonth','finishMonth']);
async function inspectObligations(provider,p,c){
 // Desired owner/economics may drift without invalidating already frozen prizes.
 // Runtime, deployment branch and immutable obligation graph must still match.
 const map=profile.pins(c),head=await provider.getBlock('latest'),at={blockTag:head.number};
 check(String((await provider.getNetwork()).chainId)==='4663','Wrong obligation chain');
 check(Number.isSafeInteger(head.number)&&ethers.isHexString(head.hash,32),'Invalid obligation head');
 const read=(k,name,type='address')=>new ethers.Contract(map[k][0],[`function ${name}() view returns(${type})`],provider)[name](at);
 for(const k of ['vault','short','monthly','adapter','quote','token','registry']){
  const code=await provider.getCode(map[k][0],head.number);check(code!=='0x'&&same(ethers.keccak256(code),map[k][1]),'Obligation runtime mismatch');
 }
 await profile.inspectQuote(provider,p,c,head.number);
 for(const [k,name,target]of [['vault','shortController','short'],['vault','monthlyController','monthly'],['vault','quoteToken','quote'],['vault','projectToken','token'],['short','datasetVault','vault'],['monthly','monthlyVault','vault'],['short','datasetRegistry','registry'],['monthly','monthlyRegistry','registry'],['short','randomProvider','adapter'],['monthly','randomProvider','adapter'],['adapter','shortConsumer','short'],['adapter','monthlyConsumer','monthly']])check(same(await read(k,name),map[target][0]),'Obligation binding mismatch');
 check(same(await read('short','datasetInstance','bytes32'),c.lifecycle.instanceId)&&same(await read('monthly','monthlyInstance','bytes32'),c.lifecycle.monthlyInstanceId),'Obligation instance mismatch');
 check(same(await read('adapter','PROFILE','bytes32'),require('./drand-preflight.cjs').PROFILE),'Obligation RNG mismatch');
 const anchor=c.deliveryJob.anchor;
 check(anchor.number<=head.number&&same((await provider.getBlock(anchor.number))?.hash,anchor.hash),'Obligation anchor mismatch');
 check(same((await provider.getBlock(head.number))?.hash,head.hash),'Obligation observation changed');
}
function createGuard({provider,config:c,publicProfile:p,compiled}){
 profile.validate(p,c);
 const map=profile.pins(c),names={vault:'DualControllerPromoVault',short:'RobinhoodShortController',monthly:'RobinhoodMonthlyController',adapter:'DrandRandomAdapter',collector:'LocalPonsCollector'};
 const interfaces=Object.fromEntries(Object.entries(names).map(([k,n])=>[k,new ethers.Interface(compiled[n].abi)]));
 return async(request,action)=>{
  check(BigInt(request.chainId)===4663n&&BigInt(request.value??0)===0n&&!request.authorizationList,'Public transaction envelope refused');
  check(!request.from||same(request.from,c.executor),'Public transaction sender mismatch');
  if(c.recognition&&same(request.to,c.recognition.source)){check(action==='confirm','Recognition action refused');await require('./recognition-worker.cjs').guard(c,provider,request);return;}
  const kind=Object.keys(ACTIONS).find(k=>same(map[k][0],request.to));
  check(kind&&ACTIONS[kind].includes(action),'Public action not allowed');
  const decoded=interfaces[kind].parseTransaction({data:request.data,value:0});
  check(decoded?.name===action,'Public selector mismatch');
  // Permissionless hash capture has no prize/role/economic effects. Running the
  // full profile here consumes Nitro's 256-block history window before estimate.
  // Admission for begin/seal and all financial actions remains unchanged.
  if(action==='checkpointCutoff'){
   check(String((await provider.getNetwork()).chainId)==='4663','Wrong checkpoint chain');
   const head=await provider.getBlock('latest');
   check(Number.isSafeInteger(head?.number)&&ethers.isHexString(head.hash,32),'Invalid checkpoint head');
   const code=await provider.getCode(map[kind][0],head.number);
   check(code!=='0x'&&same(ethers.keccak256(code),map[kind][1]),'Checkpoint runtime mismatch');
   const n=decoded.args[0];
   if(n>=BigInt(head.number)||BigInt(head.number)+1n-n>256n)
    throw Object.assign(Error('Checkpoint window expired before send'),{code:'LOCAL_BUDGET_WAIT',budget:{reason:'cutoffWindow'}});
   check(same((await provider.getBlock(head.number))?.hash,head.hash),'Checkpoint observation changed');
   return;
  }
  if(kind==='collector'&&action==='pay')check(c.recipients.some(a=>same(a,decoded.args[0])),'Unexpected fee recipient');
  if(OBLIGATIONS.has(action)){await inspectObligations(provider,p,c);return;}
  const report=await profile.inspect(provider,p,c);
  if(report.status!=='matched')throw Object.assign(Error('Public admission blocked'),{code:'PONS_PUBLIC_ADMISSION',admissionReasons:report.reasons});
 };
}
module.exports={createGuard,inspectObligations,ACTIONS};
