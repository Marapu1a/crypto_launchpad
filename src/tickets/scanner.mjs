import { readFile, mkdir, rename, open, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Interface, keccak256, getAddress } from 'ethers';
import { NETWORK, FACTORY, ROUTER, readAt } from '../pons/client.mjs';
import { assertLocalFork } from '../pons/local-execution.mjs';
import { recognize } from './recognition.mjs';
import { digest, replayTickets, snapshotTickets } from './ledger.mjs';
import { RECOGNITION, MAX_BUNDLE_BYTES, bundleHash, validateRecognition, confirmationLogs, deferDecision, creditedEvents } from './late-recognition.mjs';
const hex=n=>'0x'+BigInt(n).toString(16);
const USDG='0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const GETTERS=new Interface(['function token() view returns(address)','function pairToken() view returns(address)','function factory() view returns(address)']);
const PROGRAM=new Interface(['function quote() view returns(address)','function consumedThrough(address) view returns(uint128)','function pending() view returns(bool)','function cycle() view returns(uint256)','function draws(uint256) view returns(bytes32 participantsHash,bytes32 context,bytes32 resultHash,uint256 budget,uint256 awarded,bool settled)']);
const fields=['factory','router','curve','token','quote','registry','hook'];
export async function createProfile(provider,{token,program,launchBlock,thresholdRaw,instance,recognition}) {
  await assertLocalFork(provider);
  if(!/^[1-9]\d*$/.test(thresholdRaw)||BigInt(thresholdRaw)>=(1n<<256n)||!Number.isSafeInteger(launchBlock)||launchBlock<1||typeof instance!=='string'||!instance)throw Error('Invalid profile parameters');
  const [record]=await readAt(provider,NETWORK.factory,FACTORY,'getLaunchedToken',[getAddress(token)],launchBlock);
  if(!record.exists||record.pairToken.toLowerCase()!==USDG.toLowerCase())throw Error('Only USDG launched tokens supported');
  const anchor=await provider.send('eth_getBlockByNumber',[hex(launchBlock-1),false]);
  const [hook]=await readAt(provider,NETWORK.factory,FACTORY,'memeHook',[],launchBlock);
  const metadata=await provider.send('hardhat_metadata',[]);
  const p={schema:'launchpad-local-ticket-profile-v1',instance,localInstance:metadata.instanceId,chainId:'31337',factory:NETWORK.factory,router:NETWORK.router,
    token:getAddress(token),curve:record.curve,quote:USDG,registry:getAddress(program),hook,quoteBasis:'wallet-net-debit-v1',thresholdRaw,
    anchor:{number:launchBlock-1,hash:anchor.hash},codeHashes:{}};
  const latest=await provider.send('eth_blockNumber',[]);
  if(recognition){
    const codeHash=keccak256(await provider.send('eth_getCode',[recognition.source,latest]));
    p.recognition={...recognition,codeHash};validateRecognition(p.recognition);
  }
  for(const field of fields){const code=await provider.send('eth_getCode',[p[field],latest]);if(code==='0x')throw Error('Missing profile contract '+field);p.codeHashes[field]=keccak256(code);}
  if(p.codeHashes.factory!==NETWORK.factoryHash)throw Error('Factory runtime drift');
  await verifyProfile(provider,p,Number(BigInt(latest)));return p;
}
async function verifyProfile(provider,p,cutoff){
  await assertLocalFork(provider);
  if((await provider.send('hardhat_metadata',[])).instanceId!==p.localInstance)throw Error('Different fork instance');
  if((await provider.send('eth_getBlockByNumber',[hex(p.anchor.number),false]))?.hash!==p.anchor.hash)throw Error('Anchor branch changed');
  for(const f of fields){if(keccak256(await provider.send('eth_getCode',[p[f],hex(cutoff)]))!==p.codeHashes[f])throw Error('Runtime changed: '+f);}
  const [r]=await readAt(provider,p.factory,FACTORY,'getLaunchedToken',[p.token],cutoff);
  if(!r.exists||r.curve.toLowerCase()!==p.curve.toLowerCase()||r.pairToken.toLowerCase()!==p.quote.toLowerCase())throw Error('Factory binding changed');
  if((await readAt(provider,p.factory,FACTORY,'memeHook',[],cutoff))[0].toLowerCase()!==p.hook.toLowerCase())throw Error('Hook binding changed');
  for(const [method,field] of [['token','token'],['pairToken','quote'],['factory','factory']])if((await readAt(provider,p.curve,GETTERS,method,[],cutoff))[0].toLowerCase()!==p[field].toLowerCase())throw Error('Curve binding changed');
  if((await readAt(provider,p.registry,PROGRAM,'quote',[],cutoff))[0].toLowerCase()!==p.quote.toLowerCase())throw Error('Program quote mismatch');
  if((await readAt(provider,p.router,ROUTER,'factory',[],cutoff))[0].toLowerCase()!==p.factory.toLowerCase())throw Error('Router binding changed');
  if(p.recognition){
    validateRecognition(p.recognition);
    const r=p.recognition;
    if(keccak256(await provider.send('eth_getCode',[r.source,hex(cutoff)]))!==r.codeHash)throw Error('Recognition runtime changed');
    for(const method of ['instanceId','publisher'])if(String((await readAt(provider,r.source,RECOGNITION,method,[],cutoff))[0]).toLowerCase()!==r[method].toLowerCase())throw Error('Recognition binding changed');
  }
}
async function load(path,profile){
  let text;try{text=await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return {profile,head:profile.anchor,blocks:[],snapshots:{}};throw e;}
  const {checksum,...state}=JSON.parse(text);
  if(checksum!==digest(state)||digest(state.profile)!==digest(profile))throw Error('State checksum/profile mismatch');return state;
}
async function locked(path,fn){
  await mkdir(dirname(path),{recursive:true});const lock=await open(path+'.lock','wx');
  try{return await fn();}finally{await lock.close();await unlink(path+'.lock');}
}
async function save(path,state){
  const tmp=path+'.tmp';const handle=await open(tmp,'w');
  try{await handle.writeFile(JSON.stringify({...state,checksum:digest(state)},null,2));await handle.sync();}finally{await handle.close();}
  await rename(tmp,path);
}
async function canonical(provider,state){
  if((await provider.send('eth_getBlockByNumber',[hex(state.head.number),false]))?.hash!==state.head.hash)throw Error('Indexed branch changed; halt for replay review');
}
export async function scanTickets(provider,profile,path,cutoff,{bundleDirectory}={}){
  return locked(path,async()=>{
    const state=await load(path,profile);
    if(!Number.isSafeInteger(cutoff)||cutoff<state.head.number||cutoff-state.head.number>500)throw Error('Invalid scan cutoff (max 500 blocks per batch)');
    await verifyProfile(provider,profile,cutoff);await canonical(provider,state);
    const target=await provider.send('eth_getBlockByNumber',[hex(cutoff),false]);if(!target)throw Error('Missing cutoff');
    for(let number=state.head.number+1;number<=cutoff;number++){
      const block=await provider.send('eth_getBlockByNumber',[hex(number),true]);
      if(!block||block.parentHash!==state.head.hash)throw Error('Discontinuous history');
      const events=[],evidence=[],confirmations=[];
      let recognitionCodeHash;
      for(const transaction of block.transactions){
        const receipt=await provider.send('eth_getTransactionReceipt',[transaction.hash]);
        if(!receipt||receipt.blockHash!==block.hash||receipt.transactionHash!==transaction.hash||receipt.logs.some(l=>l.removed||l.blockHash!==block.hash||l.transactionHash!==transaction.hash))throw Error('Receipt branch mismatch');
        const recognized=recognize(profile,transaction,receipt);
        if(recognized.length)evidence.push({transaction,receipt});
        events.push(...recognized.map(event=>deferDecision(profile,event)));
        for(const log of confirmationLogs(profile,receipt)){
          const key=RECOGNITION.parseLog(log).args.bundleHash;
          if(!bundleDirectory)throw Error('Recognition bundle directory required');
          const handle=await open(join(bundleDirectory,key+'.json'),'r');
          let bundle;
          try{
            if((await handle.stat()).size>MAX_BUNDLE_BYTES)throw Error('Recognition bundle too large');
            bundle=JSON.parse(await handle.readFile('utf8'));
          }finally{await handle.close();}
          if(bundleHash(bundle)!==key)throw Error('Recognition bundle hash mismatch');
          recognitionCodeHash??=keccak256(await provider.send('eth_getCode',[profile.recognition.source,hex(number)]));
          confirmations.push({transaction,receipt,log,bundle});
        }
      }
      const saved={number,hash:block.hash,events,evidence};
      if(confirmations.length)Object.assign(saved,{confirmations,recognitionCodeHash});
      state.blocks.push(saved);state.head={number,hash:block.hash};
    }
    if((await provider.send('eth_getBlockByNumber',[hex(cutoff),false]))?.hash!==target.hash)throw Error('Branch changed during scan');
    state.wallets=replayTickets(creditedEvents(state),profile.thresholdRaw);
    await save(path,state);return structuredClone(state);
  });
}
export async function freezeTicketSnapshot(provider,profile,path,label,cutoff){
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(label))throw Error('Invalid snapshot label');
  return locked(path,async()=>{
    const state=await load(path,profile);await canonical(provider,state);
    await verifyProfile(provider,profile,state.head.number);
    const existing=state.snapshots[label];if(existing){if(existing.cutoff!==cutoff)throw Error('Snapshot already frozen');return existing;}
    const latest=Number(BigInt(await provider.send('eth_blockNumber',[])));
    const tip=await provider.send('eth_getBlockByNumber',[hex(latest),false]);
    if((await readAt(provider,profile.registry,PROGRAM,'pending',[],latest))[0])throw Error('Program already has pending draw');
    const consumed={};for(const wallet of Object.keys(state.wallets??{}))consumed[wallet]=String((await readAt(provider,profile.registry,PROGRAM,'consumedThrough',[wallet],latest))[0]);
    const cycle=String((await readAt(provider,profile.registry,PROGRAM,'cycle',[],latest))[0]+1n);
    if(Object.values(state.snapshots).some(s=>s.cycle===cycle))throw Error('Cycle already has a frozen snapshot');
    const {snapshotHash:oldHash,...body}=snapshotTickets(state,cutoff,consumed);
    const payload={...body,program:profile.registry,cycle};
    const snapshot={...payload,snapshotHash:digest(payload)};
    if((await provider.send('eth_getBlockByNumber',[hex(latest),false]))?.hash!==tip.hash)throw Error('Consumption branch changed during snapshot');
    await canonical(provider,state);state.snapshots[label]=snapshot;await save(path,state);return structuredClone(snapshot);
  });
}
export async function verifyTicketSettlement(provider,snapshot){
  await assertLocalFork(provider);
  const {snapshotHash,...body}=snapshot;if(digest(body)!==snapshotHash)throw Error('Snapshot checksum mismatch');
  const [ph,,resultHash,,,settled]=await readAt(provider,snapshot.program,PROGRAM,'draws',[snapshot.cycle],'latest');
  if(!settled||ph.toLowerCase()!==snapshot.participantsHash.toLowerCase())throw Error('Settlement does not match ticket snapshot');
  return {cycle:snapshot.cycle,resultHash};
}
