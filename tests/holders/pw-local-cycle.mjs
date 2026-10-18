import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {Contract,ContractFactory,getCreateAddress,ZeroAddress,formatEther,parseEther} from 'ethers';
import {compileProduction} from '../../src/worker/production-build.mjs';
import {compileNativePrograms} from '../../src/worker/native-build.mjs';
import {deployPwLocalGraph} from '../../server/owner-launch/pw-local.mjs';
import {advancePonsAccounting,snapshotPonsTickets} from '../../src/tickets/pons-accounting.mjs';
import {GENESIS,PERIOD,validateBeacon} from '../../src/randomness/drand.mjs';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
export const vector=JSON.parse(readFileSync('vendor/qianqi/research/drand-feasibility/vector.json','utf8'));
export const vectorTime=GENESIS+(vector.beacon.round-1)*PERIOD;
export async function restartCheckpoint({provider,db,scope,root,txHash,resolveReceipt,reconcilePage=false}){
 const bridge=createServer(async(req,res)=>{
  try{let body='';for await(const chunk of req)body+=chunk;const q=JSON.parse(body);
   res.setHeader('content-type','application/json');
   try{res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result:await provider.send(q.method,q.params)}));}
   catch(e){res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:e.message}}));}
  }catch{res.statusCode=400;res.end();}
 });
 await new Promise(r=>bridge.listen(0,'127.0.0.1',r));
 try{
  const file=resolve(root,'restart-'+(resolveReceipt?'resolve':'inspect')+'.json');
  writeFileSync(file,JSON.stringify({rpc:'http://127.0.0.1:'+bridge.address().port,instanceId:(await provider.send('hardhat_metadata',[])).instanceId,scope,txHash,resolveReceipt,reconcilePage}));
  const {stdout}=await promisify(execFile)(process.execPath,['tests/holders/restart-worker.mjs',file],{windowsHide:true,env:{...process.env,PW_TEST_DB:db.url('lp_executor')},timeout:60000});
  return JSON.parse(stdout.trim());
 }finally{await new Promise(r=>bridge.close(r));}
}
export async function setupPwCycle({provider,signer,owner,fixture,root,approvedAmounts=false}){
 const file='tests/contracts/PwLaunchFixture.sol',build=compileProduction({[file]:{content:readFileSync(file,'utf8')}});
 const deploy=async(name,args)=>{const a=build.contracts[file][name],c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
 const escrow=await fixture('NativeEscrowFixture'),factory=await deploy('PwLaunchFixture',[escrow.target]);
 const tokenAddress=getCreateAddress({from:factory.target,nonce:1}).toLowerCase();
 const scope={projectId:'55555555-5555-4555-8555-555555555555',chainId:4663,token:tokenAddress,asset:ZeroAddress};
 const preparation=JSON.parse(readFileSync('tokens/PatternWatcher/preparation.json','utf8'));
 const parameters={mode:'local-rehearsal',executionEnabled:false,owner:await (await provider.getSigner(9)).getAddress(),publisher:owner,operator:owner,project:owner,holderMinimum:'10',drawMinimum:'5',drawUnit:'1',ticketRaw:'1000',timing:{lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30}};
 if(approvedAmounts)Object.assign(parameters,{holderMinimum:preparation.holders.minimumPaymentRaw,drawMinimum:String(parseEther(preparation.draw.minimumFund)),drawUnit:String(parseEther(preparation.draw.minimumUnit)),ticketRaw:String(parseEther(preparation.draw.ticketPurchase))});
 const args={provider,signer,preparation,parameters,scope,externals:{escrow:escrow.target,factory:factory.target},localInstanceId:(await provider.send('hardhat_metadata',[])).instanceId,
  launchFixture:async collector=>{
   const receipt=await (await factory.launch(preparation.name,'PWTEST',collector)).wait(),launch=await factory.getLaunchedToken(tokenAddress);
   assert.equal(launch.creatorTaxBps,300n);assert.equal(launch.pairToken,ZeroAddress);
   return {token:new Contract(tokenAddress,build.contracts[file].PwTokenFixture.abi,signer),curve:new Contract(launch.curve,build.contracts[file].PwCurveFixture.abi,signer),launchAt:(await provider.getBlock(receipt.blockNumber)).timestamp};
  }};
 await assert.rejects(deployPwLocalGraph({...args,parameters:{...parameters,mode:'production'}}),/Local PW/);
 const graph=await deployPwLocalGraph(args);writeFileSync(root+'/launch-manifest.json',JSON.stringify(graph.manifest,null,2));
 const activity=[];
 const purchases=async (wallets,value=approvedAmounts?parseEther('0.5'):1667n)=>{
  for(const recipient of wallets){
   const r=await (await graph.curve.buy(recipient,{value})).wait();
   const log=r.logs.find(l=>l.address.toLowerCase()===graph.curve.target.toLowerCase()),event=graph.curve.interface.parseLog(log);
   assert.equal(event.args.tax,value*300n/10000n);
   activity.push({id:r.hash+':'+log.index,txHash:r.hash,trader:recipient,quoteRaw:String(value),timestamp:(await provider.getBlock(r.blockNumber)).timestamp,side:'buy',venue:'curve',decision:'purchase'});
  }
 };
 const drawCycle=async()=>{
  const {draw,split}=graph;await (await split.deliver(1)).wait();await (await split.deliver(2)).wait();
  const funded=await draw.freeFund();assert.ok(funded>=BigInt(parameters.drawMinimum));
  await provider.send('evm_setNextBlockTimestamp',[vectorTime-3601]);await provider.send('evm_mine',[]);
  const head=await provider.getBlock('latest'),checkpoint={number:head.number,hash:head.hash,timestamp:head.timestamp};
  const policy={contracts:{token:{address:tokenAddress}},template:{config:{asset:'ETH',ticketPurchase:formatEther(parameters.ticketRaw)}}};
  const source={schema:'pons-purchase-accounting-v1',source:'Pons API',status:'current',checkedAt:head.timestamp,reviewCount:0,
   profile:{token:tokenAddress,quote:ZeroAddress,decimals:18,threshold:formatEther(parameters.ticketRaw),excludedWallets:[],venues:['curve']},activity,tradeCount:activity.length};
  const accounting=advancePonsAccounting({policy,report:source,head:checkpoint,now:head.timestamp});
  writeFileSync(root+'/pons-tickets.json',JSON.stringify(accounting));
  const restored=JSON.parse(readFileSync(root+'/pons-tickets.json','utf8'));
  const tickets=await snapshotPonsTickets(policy,restored,draw);assert.equal(tickets.participants.length,2);
  await (await draw.freeze(tickets.participants,tickets.checkpoint)).wait();
  const adapter=new Contract(await draw.randomness(),compileNativePrograms().artifacts.ShortDrandAdapter.abi,signer);
  const requestId=await draw.requestForCycle(1);assert.equal(Number((await adapter.requests(requestId)).round),vector.beacon.round);
  await provider.send('evm_setNextBlockTimestamp',[vectorTime]);await provider.send('evm_mine',[]);
  await (await adapter.prove(requestId,validateBeacon(vector.beacon,vector.beacon.round))).wait();
  // Reconstruct contract handle after proof; resume without requesting a new seed.
  const resumed=new Contract(adapter.target,adapter.interface,signer);await (await resumed.deliver(requestId)).wait();await (await resumed.deliver(requestId)).wait();
  await (await draw.settle(tickets.participants)).wait();await assert.rejects(draw.settle(tickets.participants));
  const outcome=await draw.draws(1);assert.equal(await draw.freeFund()+await draw.liabilities(),funded);
  for(const p of tickets.participants){assert.equal(await draw.consumedThrough(p.wallet),BigInt(p.lastAttempt));if(await draw.rewards(1,p.wallet)>0n)await (await draw.claim(1,p.wallet)).wait();}
  assert.equal(await draw.liabilities(),0n);
  return {source:'modeled Pons API',participants:tickets.participants.length,tickets:tickets.participants.map(p=>({wallet:p.wallet,count:String(BigInt(p.lastAttempt)-BigInt(p.firstAttempt)+1n)})),funded:String(funded),awarded:String(outcome.awarded),carry:String(await draw.freeFund()),beaconRound:vector.beacon.round,proof:'historical BLS, no seed override'};
 };
 return {...graph,scope,instance:graph.manifest.scope?await graph.vault.instance():null,purchases,drawCycle};
}
