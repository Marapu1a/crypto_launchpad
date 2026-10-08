import { Contract, keccak256, isAddress } from 'ethers';
import { resolve, join } from 'node:path';
import { assertLocalFork } from '../pons/local-execution.mjs';
import { scanTickets, freezeTicketSnapshot } from '../tickets/scanner.mjs';
import { snapshotTickets, digest } from '../tickets/ledger.mjs';
import { fetchBeacon, validateBeacon, GENESIS, PERIOD } from '../randomness/drand.mjs';
import { withLock, loadState, saveState, recoverDeadLock } from './storage.mjs';
import { advanceTransaction } from './journal.mjs';

const person='(address wallet,uint128 firstAttempt,uint128 lastAttempt)[]';
export const ABI={
  program:[`function freeze(${person})`,`function settle(${person},bytes32)`,'function claim(uint256,address)',
    'function quote() view returns(address)','function operator() view returns(address)','function randomness() view returns(address)',
    'function cycle() view returns(uint256)','function pending() view returns(bool)','function lastTerminal() view returns(uint256)',
    'function interval() view returns(uint256)','function minimumFund() view returns(uint256)','function freeFund() view returns(uint256)',
    'function consumedThrough(address) view returns(uint128)','function rewards(uint256,address) view returns(uint256)',
    'function requestForCycle(uint256) view returns(uint256)',
    'function draws(uint256) view returns(bytes32 participantsHash,bytes32 context,bytes32 resultHash,uint256 budget,uint256 awarded,bool settled)'],
  collector:['function quote() view returns(address)','function token() view returns(address)','function curve() view returns(address)',
    'function destination() view returns(address)','function escrow() view returns(address)','function collect()','function forward()','function sweepCurve()'],
  splitter:['function quote() view returns(address)','function prizeFund() view returns(address)','function credit(uint256) view returns(uint256)','function deliver(uint256)'],
  curve:['function quoteFeeBalance() view returns(uint256)','function creatorTaxBalance() view returns(uint256)','function graduated() view returns(bool)'],
  escrow:['function balanceOfToken(address,address) view returns(uint256)'],
  quote:['function balanceOf(address) view returns(uint256)'],
  adapter:['function shortConsumer() view returns(address)',
    'function requests(uint256) view returns(address consumer,bytes32 context,uint64 round,bool proven,bool delivered,bytes32 seed)',
    'function prove(uint256,bytes)','function deliver(uint256)'],
};
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const check=(v,m)=>{if(!v)throw Error(m);};
const contract=(provider,kind,address)=>new Contract(address,ABI[kind],provider);

export async function createWorkerConfig(provider,{profile,collector,executor,limits}) {
  await assertLocalFork(provider);
  const p=contract(provider,'program',profile.registry),c=contract(provider,'collector',collector);
  const addresses={program:profile.registry,collector,splitter:await c.destination(),escrow:await c.escrow(),
    quote:profile.quote,curve:profile.curve,adapter:await p.randomness()};
  const config={schema:'local-short-worker-v1',profile,executor,addresses,limits,codeHashes:{}};
  for(const [kind,address] of Object.entries(addresses))config.codeHashes[kind]=keccak256(await provider.getCode(address));
  await verifyConfig(provider,config);return config;
}
async function verifyConfig(provider,c) {
  check(c.schema==='local-short-worker-v1'&&isAddress(c.executor),'Invalid worker config');
  const metadata=await assertLocalFork(provider);
  check(metadata.instanceId===c.profile.localInstance,'Worker fork instance changed');
  for(const field of ['maxGasPrice','maxGasLimit','nativeFloor'])check(typeof c.limits[field]==='string'&&/^[1-9]\d*$/.test(c.limits[field]),'Invalid gas limit '+field);
  for(const [kind,address] of Object.entries(c.addresses)){
    check(isAddress(address)&&ABI[kind],'Invalid contract '+kind);
    const code=await provider.getCode(address);check(code!=='0x'&&keccak256(code)===c.codeHashes[kind],'Worker runtime changed '+kind);
  }
  const p=contract(provider,'program',c.addresses.program),collector=contract(provider,'collector',c.addresses.collector);
  const splitter=contract(provider,'splitter',c.addresses.splitter),adapter=contract(provider,'adapter',c.addresses.adapter);
  check(same(c.addresses.program,c.profile.registry)&&same(c.addresses.quote,c.profile.quote)&&same(c.addresses.curve,c.profile.curve),'Ticket profile mismatch');
  for(const [instance,getter,expected] of [[p,'operator',c.executor],[p,'quote',c.addresses.quote],[p,'randomness',c.addresses.adapter],
    [collector,'token',c.profile.token],[collector,'curve',c.addresses.curve],[collector,'quote',c.addresses.quote],
    [collector,'destination',c.addresses.splitter],[collector,'escrow',c.addresses.escrow],
    [splitter,'prizeFund',c.addresses.program],[splitter,'quote',c.addresses.quote],[adapter,'shortConsumer',c.addresses.program]]){
    check(same(await instance[getter](),expected),'Worker binding changed '+getter);
  }
}

export async function runLocalWorker({provider,signer,config,root,bundleDirectory,getBeacon=fetchBeacon,hook}) {
  root=resolve(root);await verifyConfig(provider,config);
  check(same(await signer.getAddress(),config.executor)&&signer.provider===provider,'Wrong worker signer');
  const base=join(root,config.addresses.program.toLowerCase()),statePath=base+'.worker.json',ticketsPath=base+'.tickets.json';
  // One root per host and a dedicated executor wallet: no independent nonce writers.
  const senderLock=join(root,'senders',config.profile.localInstance+'-'+config.executor.toLowerCase()+'.lock');
  return withLock(senderLock,()=>withLock(statePath+'.lock',async()=>{
    let state=await loadState(statePath,config);
    const c=Object.fromEntries(Object.entries(config.addresses).map(([kind,address])=>[kind,contract(provider,kind,address)]));
    if(!state){
      check(await c.program.cycle()===0n,'Missing worker history for active program');
      state={schema:'local-worker-v1',identity:digest(config),history:[],cycles:{}};await saveState(statePath,state);
    }
    const save=()=>saveState(statePath,state);
    const guard=async()=>{
      await verifyConfig(provider,config);
      const anchor=config.profile.anchor;
      check((await provider.getBlock(anchor.number))?.hash===anchor.hash,'Worker anchor changed');
      const last=state.history.at(-1);
      if(last)check((await provider.getBlock(last.blockNumber))?.hash===last.blockHash,'Worker confirmed history reorg');
    };
    await guard();
    const transact=(request,action)=>advanceTransaction({provider,signer,state,save,request,action,limits:config.limits,guard,hook});
    if(state.failure)return {status:'blocked',reason:'reverted-transaction',hash:state.failure.hash};
    if(state.pending)return transact();
    const tip=await provider.getBlock('latest');
    // Scanner owns its separate atomic journal. Recover an existing snapshot if a crash
    // occurred after its save but before saving the worker's cycle reference.
    const {readFile}=await import('node:fs/promises');
    let indexedHead=config.profile.anchor.number;
    try{indexedHead=JSON.parse(await readFile(ticketsPath,'utf8')).head.number;}catch(e){if(e.code!=='ENOENT')throw e;}
    check(Number.isSafeInteger(indexedHead)&&indexedHead<=tip.number,'Invalid index head');
    const indexed=await scanTickets(provider,config.profile,ticketsPath,Math.min(tip.number,indexedHead+500),{bundleDirectory});
    if(indexed.head.number<tip.number)return {status:'waiting',reason:'index-catchup',head:indexed.head.number};
    const request=(kind,method,args=[])=>({request:{to:c[kind].target,data:c[kind].interface.encodeFunctionData(method,args),value:0},action:kind+'.'+method});
    let plan,waiting='conditions';
    const cycle=await c.program.cycle(),pending=await c.program.pending();
    for(const [id,snapshot] of Object.entries(state.cycles)){
      if(BigInt(id)>cycle)continue;
      const draw=await c.program.draws(id);
      check(same(draw.participantsHash,snapshot.participantsHash),'Worker snapshot mismatch');
      if(draw.settled)for(const person of snapshot.participants){
        if(await c.program.rewards(id,person.wallet)>0n){plan=request('program','claim',[id,person.wallet]);break;}
      }
      if(plan)break;
    }
    if(!plan&&pending){
      const snapshot=state.cycles[String(cycle)];check(snapshot,'Missing pending cycle snapshot');
      const id=await c.program.requestForCycle(cycle),r=await c.adapter.requests(id),draw=await c.program.draws(cycle);
      check(same(r.consumer,c.program.target)&&same(r.context,draw.context),'RNG context mismatch');
      if(!r.proven){
        if(tip.timestamp<GENESIS+(Number(r.round)-1)*PERIOD)waiting='beacon-time';
        else{
          let beacon;
          try{beacon=await getBeacon(Number(r.round));}catch{waiting='beacon-unavailable';}
          if(beacon)plan=request('adapter','prove',[id,validateBeacon(beacon,Number(r.round))]);
        }
      }else if(!r.delivered)plan=request('adapter','deliver',[id]);
      else plan=request('program','settle',[snapshot.participants,r.seed]);
    }
    if(!plan&&!pending&&BigInt(tip.timestamp)>=await c.program.lastTerminal()+await c.program.interval()&&await c.program.freeFund()>=await c.program.minimumFund()){
      const id=String(cycle+1n),label='worker-cycle-'+id;
      let snapshot=state.cycles[id]??indexed.snapshots[label];
      if(!snapshot){
        const consumed={};for(const wallet of Object.keys(indexed.wallets??{}))consumed[wallet]=String(await c.program.consumedThrough(wallet));
        if(snapshotTickets(indexed,indexed.head.number,consumed).participants.length){
          snapshot=await freezeTicketSnapshot(provider,config.profile,ticketsPath,label,indexed.head.number);
        }
      }
      if(snapshot){
        check(snapshot.cycle===id&&same(snapshot.program,c.program.target),'Recovered snapshot binding mismatch');
        state.cycles[id]=snapshot;await save();plan=request('program','freeze',[snapshot.participants]);
      }
    }
    // Paying existing balances precedes collecting more: continuous trading cannot starve delivery.
    if(!plan)for(let lane=0;lane<3;lane++)if(await c.splitter.credit(lane)>0n){plan=request('splitter','deliver',[lane]);break;}
    if(!plan&&await c.quote.balanceOf(c.collector.target)>0n)plan=request('collector','forward');
    if(!plan&&await c.escrow.balanceOfToken(c.collector.target,c.quote.target)>0n)plan=request('collector','collect');
    if(!plan&&!await c.curve.graduated()&&(await c.curve.quoteFeeBalance()>0n||await c.curve.creatorTaxBalance()>0n))plan=request('collector','sweepCurve');
    if(!plan)return {status:'waiting',reason:waiting,cycle:String(cycle)};
    return transact(plan.request,plan.action);
  }));
}

export async function recoverLocalWorkerLocks(provider,config,root) {
  await verifyConfig(provider,config);root=resolve(root);
  const paths=[join(root,'senders',config.profile.localInstance+'-'+config.executor.toLowerCase()+'.lock'),
    join(root,config.addresses.program.toLowerCase()+'.worker.json.lock'),
    join(root,config.addresses.program.toLowerCase()+'.tickets.json.lock')];
  const recovered=[];for(const path of paths)if(await recoverDeadLock(path))recovered.push(path);
  return {status:'recovered',locks:recovered};
}
