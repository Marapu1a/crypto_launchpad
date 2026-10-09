// Explicit release expectations, never inferred from the chain being inspected.
const {ethers}=require('ethers');
const check=(ok,m)=>{if(!ok)throw Error(m);};
const uint=(v,positive=false)=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&BigInt(v)<(1n<<256n)&&(!positive||BigInt(v)>0n);
function genesis(){return {
 short:require('./short-dataset.cjs').rulesHash({version:1,pNumerator:4,pDenominator:5,hNumerator:1,hDenominator:1},[7,4,2,1,1,1,1,1,1,1],'5000000'),
 monthly:require('./monthly-outcome.cjs').rulesHash(require('./monthly-outcome.cjs').RULES),
};}
function validate(o){
 check(o?.schema==='promo-operational-profile-v1','Operational profile required');
 for(const k of ['governor','operations','project','buyPolicyPublisher'])check(ethers.isAddress(o.roles?.[k])&&o.roles[k]!==ethers.ZeroAddress,'Invalid operational role '+k);
 for(const kind of ['short','monthly']){
  const c=o.controllers?.[kind];check(c&&uint(c.noticeSeconds,true)&&uint(c.maxGasPrice,true)&&uint(c.nativeFloor),'Invalid controller settings '+kind);
 }
 const b=o.buyPolicy;
 check(b&&ethers.isAddress(b.source)&&b.source!==ethers.ZeroAddress&&ethers.isHexString(b.codeHash,32)&&uint(b.noticeBlocks,true),'Invalid BUY policy pin');
 const g=genesis();check(o.genesis?.short===g.short&&o.genesis?.monthly===g.monthly,'Unapproved launch genesis');
 return o;
}
function create(plan,settings){
 check(require('./public-launch-plan.cjs').inspectPlan(plan).conflicts.length===0,'Launch plan conflicts');
 return validate({...settings,schema:'promo-operational-profile-v1',genesis:genesis()});
}
async function inspect({provider,profile,config,at,test}){
 const o=validate(profile.operational),addr=k=>profile.pins[k][0];
 const read=(address,method,type='address',args=[],inputs='')=>new ethers.Contract(address,[`function ${method}(${inputs}) view returns(${type})`],provider)[method](...args,at);
 const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
 const match=async(k,method,value,type='address')=>test(same(await read(addr(k),method,type),value),'operational:'+k+'.'+method);
 for(const k of ['short','monthly','collector']){
  await match(k,'owner',o.roles.governor);await match(k,'pendingOwner',ethers.ZeroAddress);
 }
 for(const k of ['short','monthly']){
  await match(k,k==='short'?'shortRulesNotice':'monthlyRulesNotice',o.controllers[k].noticeSeconds,'uint256');
  for(const key of ['maxGasPrice','nativeFloor'])await match(k,key,o.controllers[k][key],'uint256');
 }
 await match('short','maxBudget',ethers.MaxUint256,'uint256');await match('vault','nextStartTarget','100000000','uint256');
 const rules='tuple(uint32 version,uint32 pNumerator,uint32 pDenominator,uint32 hNumerator,uint32 hDenominator)';
 const short=await read(addr('short'),'shortEpochPolicy',`tuple(${rules} outcome,uint256[] weights,uint256 minimumUnit,bytes32 hash,uint256 firstBlock)`,[1],'uint64');
 const monthly=await read(addr('monthly'),'monthlyEpochPolicy',`tuple(${rules} outcome,bytes32 hash,uint256 firstBlock)`,[1],'uint64');
 test(short.hash===o.genesis.short,'operational:shortGenesis');test(monthly.hash===o.genesis.monthly,'operational:monthlyGenesis');
 const f=config.fundingJob,s=config.schedulerConfig,b=s.buyPolicy;
 test(same(f.recipients[1],o.roles.operations)&&same(f.recipients[2],o.roles.project),'operational:recipientRoles');
 test(s.shortBudgetMode==='FREE_SHORT'&&String(s.manifest.entryThresholdRaw)==='100000000'&&Number(s.manifest.quoteDecimals)===6,'operational:entryAndBudget');
 test(!!b&&same(b.source,o.buyPolicy.source)&&same(b.sourceCodeHash,o.buyPolicy.codeHash)&&same(b.publisher,o.roles.buyPolicyPublisher)&&String(b.noticeBlocks)===o.buyPolicy.noticeBlocks,'operational:buyPolicyConfig');
 const code=await provider.getCode(o.buyPolicy.source,at.blockTag);
 test(code!=='0x'&&same(ethers.keccak256(code),o.buyPolicy.codeHash),'operational:buyPolicyRuntime');
 if(code!=='0x'&&same(ethers.keccak256(code),o.buyPolicy.codeHash)){
  test(same(await read(o.buyPolicy.source,'publisher'),o.roles.buyPolicyPublisher),'operational:buyPolicyPublisher');
  test(same(await read(o.buyPolicy.source,'noticeBlocks','uint256'),o.buyPolicy.noticeBlocks),'operational:buyPolicyNotice');
  test(!!b&&same(await read(o.buyPolicy.source,'genesisHash','bytes32'),b.genesisHash),'operational:buyPolicyGenesis');
 }
 const ops=config.ops;
 test(!!ops&&uint(ops.maxGasPrice,true)&&uint(ops.reserveGasPrice,true)&&BigInt(ops.reserveGasPrice)>=BigInt(ops.maxGasPrice)
  &&['short','monthly'].every(k=>BigInt(ops.maxGasPrice)<=BigInt(o.controllers[k].maxGasPrice)),'operational:workerGasBounds');
 // This only checks configured ceilings. Native sufficiency remains a per-action wait.
}
if(require.main===module){
 try{const fs=require('node:fs'),[settingsFile,out,planFile='config/robinhood-launch-plan.json']=process.argv.slice(2);
  check(settingsFile&&out,'Settings and new output path required');
  const result=create(JSON.parse(fs.readFileSync(planFile,'utf8')),JSON.parse(fs.readFileSync(settingsFile,'utf8')));
  fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={create,validate,inspect,genesis};
