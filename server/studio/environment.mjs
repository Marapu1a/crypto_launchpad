import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {HDNodeWallet,Contract} from 'ethers';
import pg from 'pg';
import {providerFor} from '../../src/pons/client.mjs';
import {assertLocalFork} from '../../src/pons/local-execution.mjs';
import {migrate} from '../../db/migrate.mjs';
import {createPool} from '../shared/store.mjs';
import {USDG,ESCROW} from './template.mjs';
const sleep=n=>new Promise(r=>setTimeout(r,n));
const run=promisify(execFile);
export const testSigner=provider=>HDNodeWallet.fromPhrase('test test test test test test test test test test test junk').connect(provider);
export async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
export async function createEnvironment(root){
 root=path.resolve(root);fs.mkdirSync(root,{recursive:true});
 const bin=process.env.PG_BIN||'C:/Program Files/PostgreSQL/17/bin',data=path.join(root,'pgdata');
 const command=async(name,args)=>{
  const exe=path.join(bin,name+(process.platform==='win32'?'.exe':''));
  if(name==='pg_ctl')return new Promise((ok,bad)=>{const c=spawn(exe,args,{stdio:'ignore',windowsHide:true});c.once('error',bad);c.once('exit',code=>code===0?ok():bad(Error('pg_ctl failed')));});
  return run(exe,args,{windowsHide:true});
 };
 let child,provider,pools,started=false;
 const close=async()=>{
  await Promise.allSettled(Object.values(pools??{}).map(p=>p.end()));provider?.destroy();
  if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
  if(started){await command('pg_ctl',['-D',data,'-m','fast','-w','stop']);started=false;}
 };
 try{
  const pgPort=await freePort(),rpcPort=await freePort();
  await command('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','-E','UTF8']);
  await command('pg_ctl',['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${pgPort}`,'-w','start']);started=true;
  const url=(role,db='studio')=>`postgresql://${role}@127.0.0.1:${pgPort}/${db}`;
  let admin=new pg.Client({connectionString:url('postgres','postgres')});await admin.connect();
  try{await admin.query('CREATE ROLE lp_owner NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE lp_api LOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE lp_jobs LOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE lp_ingest LOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE lp_executor LOGIN NOSUPERUSER NOBYPASSRLS;');await admin.query('CREATE DATABASE studio OWNER lp_owner');}finally{await admin.end();}
  const urls={admin:url('postgres'),api:url('lp_api'),jobs:url('lp_jobs'),ingest:url('lp_ingest'),executor:url('lp_executor')};
  pools=Object.fromEntries(Object.entries(urls).map(([role,url])=>[role,createPool(url)]));
  admin=await pools.admin.connect();try{await migrate(admin);}finally{admin.release();}
  const log=fs.openSync(path.join(root,'fork.log'),'a');
  child=spawn(process.execPath,['node_modules/hardhat/internal/cli/cli.js','node','--hostname','127.0.0.1','--port',String(rpcPort)],{env:{...process.env,PONS_FORK_BLOCK:'82000000',HARDHAT_CONFIG:path.resolve('hardhat.config.cjs')},stdio:['ignore',log,log],windowsHide:true});fs.closeSync(log);
  const rpcUrl='http://127.0.0.1:'+rpcPort;
  let ready=false;
  for(let i=0;i<120;i++){
   if(child.exitCode!==null)throw Error('Fork startup failed; inspect local log');
   try{const r=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'hardhat_metadata',params:[]}),signal:AbortSignal.timeout(1000)});if((await r.json()).result?.forkedNetwork?.forkBlockNumber===82000000){ready=true;break;}}catch{}
   await sleep(500);
  }
  if(!ready)throw Error('Fork unavailable');provider=providerFor(rpcUrl);provider.pollingInterval=50;await assertLocalFork(provider);await provider.send('evm_mine',[]);
  const signer=testSigner(provider),quote=new Contract(USDG,['function transfer(address,uint256) returns(bool)'],provider);
  // Explicit historical-fork fixture only. No funding from a production wallet.
  await provider.send('hardhat_impersonateAccount',[ESCROW]);await provider.send('hardhat_setBalance',[ESCROW,'0x56bc75e2d63100000']);
  try{const hash=await provider.send('eth_sendTransaction',[{from:ESCROW,to:USDG,data:quote.interface.encodeFunctionData('transfer',[signer.address,4000000000n])}]);await provider.waitForTransaction(hash);}finally{await provider.send('hardhat_stopImpersonatingAccount',[ESCROW]);}
  const runtime={root:path.join(root,'projects'),rpcUrl,urls,httpPort:4185,forkPid:child.pid,ownerPid:process.pid,instance:(await assertLocalFork(provider)).instanceId};fs.writeFileSync(path.join(root,'runtime.json'),JSON.stringify(runtime,null,2));
  return {root,provider,signer,pools,runtime,close};
 }catch(e){await close();throw e;}
}
