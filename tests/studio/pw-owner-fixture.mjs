import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Wallet,Transaction} from 'ethers';
import {createPwConsole,pwConsoleHttp} from '../../server/owner-launch/pw-console.mjs';

// UI fixture only: no provider, DB, keystore files or public transactions.
export async function pwOwnerFixture({port=0,enabled=true,browserWallet=false}={}){
 const wallet=new Wallet('0x'+'11'.repeat(32));let state=null,signatures=0,broadcasts=0;
 const kinds=['vault','draw','splitter','collector','launch','bindCollector','bindVault','bindSplitter','bindSchedule'];
 const coordinator={info:()=>({mode:'preview'}),inspect:async()=>state,
  prepare:async()=>state??={stage:'prepared',steps:kinds.map(kind=>({kind})),history:[],pending:null},
  quote:async()=>({kind:kinds[state.history.length],request:{from:wallet.address,to:wallet.address,chainId:4663,nonce:state.history.length,type:2,value:'0',data:'0x',gasLimit:'120000',maxFeePerGas:'1000000000',maxPriorityFeePerGas:'100000000'},estimatedGas:'100000',maximumNativeCost:'120000000000000',totalNativeLimit:'20000000000000000',authorizationToSend:false}),
  record:async(id,raw)=>{const tx=Transaction.from(raw);state.pending={kind:kinds[state.history.length],hash:tx.hash,raw};state.stage='pending';return state;},
  armWallet:async(id,q)=>{state.walletPending={kind:q.kind,request:q.request};state.stage='wallet-pending';return state;},
  attachWallet:async(id,hash)=>{state.pending={kind:state.walletPending.kind,hash};state.walletPending=null;state.stage='pending';broadcasts++;return state;},
  broadcast:async()=>{broadcasts++;},
  resolve:async()=>{if(state.pending){if(!broadcasts)throw Error('Not sent');state.history.push({kind:state.pending.kind,hash:state.pending.hash,blockNumber:100+state.history.length});state.pending=null;state.stage=state.history.length===9?'awaiting-finality':'prepared';}else if(state.stage==='awaiting-finality'){state.stage='deployed';state.scope={token:wallet.address};}return state;}
 };
 const app=createPwConsole({coordinator,input:{id:'preview',draft:{name:'Pattern Watcher',symbol:'PW · пример',description:'Pattern Watcher explores the first hour of tokens on Pons.',telegram:'https://t.me/qianqi_hub_bot',website:'https://example.invalid'}},owner:wallet.address,enabled,browserWallet,signer:{getAddress:()=>wallet.getAddress(),signTransaction:r=>{signatures++;return wallet.signTransaction(r);}},usage:()=>({used:0,maxRequests:1000,persistent:false})});
 let middleware;
 const server=createServer((req,res)=>middleware(req,res,async()=>{
  try{
   const pathname=req.url.split('?')[0],file=pathname==='/'?'pw-owner.html':/^\/assets\/[a-zA-Z0-9_.-]+$/.test(pathname)?pathname.slice(1):null;if(!file)throw Error();
   const bytes=await readFile(resolve('dist',file));res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(bytes);
  }catch{res.writeHead(404);res.end();}
 }));
 await new Promise(r=>server.listen(port,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 middleware=pwConsoleHttp(app,{origin:url});
 return {url,counts:()=>({signatures,broadcasts}),close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
