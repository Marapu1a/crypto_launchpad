import fs from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {JsonRpcProvider,Contract,keccak256} from 'ethers';
import {createTestPostgres} from '../../tests/contracts/production-postgres.mjs';
import {freePort} from '../studio/environment.mjs';
import {createExecutorKeystore} from '../../src/worker/executor-keystore.mjs';
import {NETWORK,FACTORY} from '../../src/pons/client.mjs';
import {USDG,ESCROW} from '../../src/launch/template.mjs';
import {initialDraft} from '../../src/pons/plan.mjs';
import {upgradeProgramDraft} from '../../src/draws/program-config.mjs';
import pins from '../../src/qianqi/routes/genesis-fields.json' with {type:'json'};

export async function createOwnerRehearsal(root,{httpPort=4186,version=1}={}){
 if(![1,2].includes(version))throw Error('Unsupported rehearsal version');
 root=path.resolve(root);await fs.mkdir(root,{recursive:true});let db,fork,provider;
 const close=async()=>{provider?.destroy();if(fork&&fork.exitCode===null){const done=new Promise(r=>fork.once('exit',r));fork.kill();await done;}await db?.close();};
 try{
  db=await createTestPostgres(path.join(root,'postgres'));
  const port=await freePort(),rpcUrl='http://127.0.0.1:'+port,log=openSync(path.join(root,'fork.log'),'a');
  fork=spawn(process.execPath,['node_modules/hardhat/internal/cli/cli.js','node','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,HARDHAT_CONFIG:path.resolve('tests/fork/production-hardhat.config.cjs')},stdio:['ignore',log,log],windowsHide:true});closeSync(log);
  let meta;for(let i=0;i<120;i++){
   if(fork.exitCode!==null)throw Error('Rehearsal fork stopped');
   try{const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'hardhat_metadata',params:[]}),signal:AbortSignal.timeout(1000)});meta=(await r.json()).result;if(meta?.forkedNetwork?.forkBlockNumber===82000000&&meta.chainId===4663)break;}catch{}
   await new Promise(r=>setTimeout(r,500));
  }
  if(meta?.forkedNetwork?.forkBlockNumber!==82000000||meta.chainId!==4663)throw Error('Historical fork unavailable');
  provider=new JsonRpcProvider(rpcUrl,undefined,{cacheTimeout:-1});provider.pollingInterval=50;
  await provider.send('evm_mine',[]);
  const owner=await (await provider.getSigner(0)).getAddress(),keys={};
  for(const role of ['executor','publisher']){
   const password=randomBytes(32).toString('hex'),passwordFile=path.join(root,role+'.password');
   await fs.writeFile(passwordFile,password,{flag:'wx',mode:0o600});
   const key=await createExecutorKeystore({directory:path.join(root,role),projectId:randomUUID(),password});keys[role]={keyFile:key.file,passwordFile,address:key.address};
  }
  const quote=new Contract(USDG,['function transfer(address,uint256) returns(bool)'],provider);
  await provider.send('hardhat_setBalance',[ESCROW,'0x56bc75e2d63100000']);await provider.send('hardhat_impersonateAccount',[ESCROW]);
  try{await provider.send('eth_sendTransaction',[{from:ESCROW,to:USDG,data:quote.interface.encodeFunctionData('transfer',[owner,4000000000n])}]);}finally{await provider.send('hardhat_stopImpersonatingAccount',[ESCROW]);}
  const anchor=await provider.getBlock('latest'),factory=new Contract(NETWORK.factory,FACTORY,provider);
  const profile={mode:'rehearsal',instanceId:meta.instanceId,owner,executor:keys.executor.address,publisher:keys.publisher.address,anchor:{number:anchor.number,hash:anchor.hash},timing:{lead:3600,clockLag:30,clockAhead:30,finalizedLag:1800,beaconLag:30},limits:{maxGasPrice:'100000000000',maxGasLimit:'15000000',nativeFloor:'100000'},funding:{executor:'1000000000000000',publisher:'1000000000000000'},totalNativeLimit:'2000000000000000000',externals:{}};
  for(const [role,address] of Object.entries({factory:NETWORK.factory,router:NETWORK.router,quote:USDG,escrow:ESCROW,hook:await factory.memeHook(),batchExecutor:pins.pins.batchExecutor[0]}))profile.externals[role]={address,codeHash:keccak256(await provider.getCode(address))};
  const defaults={draft:{...initialDraft(),name:'Token Rehearsal',symbol:'TOKEN',pair:USDG,creatorFee:'2',openingBuy:'0'},draws:JSON.parse(await fs.readFile('config/rehearsals/first-token.json','utf8')).draws,team:await (await provider.getSigner(5)).getAddress(),operations:await (await provider.getSigner(6)).getAddress()};
  if(version===2)defaults.draws=upgradeProgramDraft(defaults.draws,10000);
  const config={schema:version===2?'owner-rehearsal-v2':'owner-rehearsal-v1',rpcUrl,urls:{admin:db.url('postgres'),executor:db.url('lp_executor'),api:db.url('lp_api')},profile,keys,defaults,httpPort,root};
  const file=path.join(root,'owner-server.json');await fs.writeFile(file,JSON.stringify(config,null,2),{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(root,'rpc.txt'),rpcUrl,{flag:'wx',mode:0o600});await fs.writeFile(path.join(root,'db.txt'),db.url('lp_executor'),{flag:'wx',mode:0o600});
  return {file,config,close};
 }catch(e){await close();throw e;}
}
