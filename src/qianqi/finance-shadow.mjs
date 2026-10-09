import {Interface,AbiCoder,keccak256,sha256,ZeroHash} from 'ethers';
import {check,low,integer,checkedLog} from './ticket-shadow.mjs';
import {qianqiProfile as p} from './shadow-reader.mjs';
export const abi=new Interface([
 'function randomProvider() view returns(address)','function datasetVault() view returns(address)',
 'function drawRequest(bytes32) view returns(uint256)','function requests(uint256) view returns(bytes32 drawId,bytes32 context,bool delivered)',
 'function settlements(bytes32) view returns(bytes32 proposalId,uint8 phase,bytes32 seed,uint256 nextChunk,uint256 processed,uint256 admitted)',
 'function shortResult(bytes32) view returns(tuple(address[] winners,uint256[] amounts,uint256[] prizeIndices,uint256 admittedCount,bytes32 resultHash))',
 ...['activeProposal','activeMonth','pendingMonth'].map(n=>`function ${n}() view returns(bytes32)`),
 'function pendingDatasetDraw() view returns(bytes32)','function pendingMonthlyDrawId() view returns(bytes32)',
 'function draws(bytes32) view returns(address asset,uint64 campaignId,uint8 status,uint256 budget,uint256 awarded,uint256 paid)',
 'function reward(bytes32,address) view returns(uint256)',
 ...['freeShort','freeCurrent','freeNext'].map(n=>`function ${n}() view returns(uint256)`),
 ...['reserved','claimable','balanceOf'].map(n=>`function ${n}(address) view returns(uint256)`),
 'event DatasetSealed(bytes32 indexed proposalId,bytes32 indexed drawId,bytes32 context)',
 'event AttemptsConsumed(bytes32 indexed drawId,uint8 indexed kind,bytes32 snapshotHash,uint8 outcome,bytes32 resultHash)',
 'event RandomBound(uint256 indexed requestId,bytes32 indexed drawId,bytes32 context)',
 'event DrawReserved(bytes32 indexed drawId,uint64 indexed campaignId,address indexed asset,uint256 budget)',
 'event RewardAssigned(bytes32 indexed drawId,address indexed winner,uint256 amount)',
 'event DrawFinalized(bytes32 indexed drawId,uint256 awarded,uint256 released)',
 'event RewardPaid(bytes32 indexed drawId,address indexed asset,address indexed winner,uint256 amount)',
 'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
export const rngAbi=new Interface([
 'function requests(uint256) view returns(address consumer,bytes32 context,uint64 round,bool proven,bool delivered,bytes32 seed)',
 ...['shortConsumer','monthlyConsumer'].map(n=>`function ${n}() view returns(address)`),
 ...['nextId','leadSeconds','GENESIS','PERIOD'].map(n=>`function ${n}() view returns(uint256)`),
 'function CHAIN_HASH() view returns(bytes32)','function verify(uint64,bytes) view returns(bool)',
 'function contextRequest(address,bytes32) view returns(uint256)','function prove(uint256,bytes)',
 'event Requested(uint256 indexed id,address indexed consumer,bytes32 indexed context,uint64 round)',
 'event Proven(uint256 indexed id,bytes32 seed)','event Delivered(uint256 indexed id)',
]);
const tag=n=>'0x'+integer(n).toString(16), coder=AbiCoder.defaultAbiCoder();
export async function inspectFinance({rpc,head,history}){
 check(BigInt(await rpc('eth_chainId',[]))===4663n,'Wrong chain');
 const block=await rpc('eth_getBlockByNumber',[tag(head.number),false]);check(low(block.hash)===head.hash,'Wrong finance head');
 check(integer((await rpc('eth_getBlockByNumber',['finalized',false])).number)>=head.number,'Unfinalized finance head');
 const read=async(to,name,args=[],iface=abi)=>iface.decodeFunctionResult(name,await rpc('eth_call',[{to,data:iface.encodeFunctionData(name,args)},tag(head.number)]));
 const one=async(...args)=>(await read(...args))[0];
 const vault=low(await one(p.short,'datasetVault')),rng=low(await one(p.short,'randomProvider')),quote=history.publicProfile.profile.quote.toLowerCase();
 check(low(await one(p.monthly,'randomProvider'))===rng,'Different RNG providers');
 check(low(await one(rng,'shortConsumer',[],rngAbi))===p.short&&low(await one(rng,'monthlyConsumer',[],rngAbi))===p.monthly,'Wrong RNG consumers');
 const codes={};for(const address of [vault,rng,p.short,p.monthly,quote]){const code=await rpc('eth_getCode',[address,tag(head.number)]);check(code!=='0x','Missing finance runtime');codes[address]=keccak256(code);}
 check(codes[vault]===history.publicProfile.lifecycle.vaultCodeHash&&codes[p.short]===history.publicProfile.lifecycle.sourceCodeHash&&codes[p.monthly]===history.publicProfile.lifecycle.monthlySourceCodeHash,'Finance runtime drift');
 const evidence=new Map();
 async function logs(address,name,iface=abi){
  check(await rpc('eth_getCode',[address,tag(79000000)])==='0x','Finance start predates contract requirement');
  const rows=await rpc('eth_getLogs',[{address,topics:[iface.getEvent(name).topicHash],fromBlock:tag(79000001),toBlock:tag(head.number)}]);check(rows.length<1000,'Finance log budget');
  const seen=new Set();
  for(const l of rows){check(low(l.address)===address&&integer(l.blockNumber)<=head.number,'Wrong finance log');const key=`${l.transactionHash}:${l.logIndex}`;check(!seen.has(key),'Duplicate finance log');seen.add(key);
   const receipt=await rpc('eth_getTransactionReceipt',[l.transactionHash]),header=await rpc('eth_getBlockByNumber',[tag(l.blockNumber),false]);checkedLog(l,receipt,header);evidence.set(key,{receipt,header});
  }return rows.map(l=>({log:l,args:iface.parseLog(l).args}));
 }
 const reserved=await logs(vault,'DrawReserved'),assigned=await logs(vault,'RewardAssigned'),paid=await logs(vault,'RewardPaid'),finalized=await logs(vault,'DrawFinalized');
 const seals=await logs(p.short,'DatasetSealed'),terminals=await logs(p.short,'AttemptsConsumed');
 const bound=await logs(p.short,'RandomBound'),monthlyBound=await logs(p.monthly,'RandomBound');
 const requested=await logs(rng,'Requested',rngAbi),proven=await logs(rng,'Proven',rngAbi),delivered=await logs(rng,'Delivered',rngAbi);
 check(monthlyBound.length===0,'Monthly RNG requires separate replay');
 check(requested.length===integer(await one(rng,'nextId',[],rngAbi))&&requested.length===bound.length,'Unaccounted RNG request');
 check(reserved.length===history.replay.draws.length&&bound.length===reserved.length,'Unaccounted draw history');
 const only=(rows,fn,label)=>{const found=rows.filter(fn);check(found.length===1,label);return found[0];};
 const known=new Set(history.replay.draws.map(d=>d.snapshot.drawId));check([...assigned,...paid,...finalized].every(x=>known.has(x.args.drawId))&&finalized.length===known.size,'Unknown draw liability events');
 const chainHash=await one(rng,'CHAIN_HASH',[],rngAbi),genesis=await one(rng,'GENESIS',[],rngAbi),period=await one(rng,'PERIOD',[],rngAbi),lead=await one(rng,'leadSeconds',[],rngAbi);
 const draws=[];let outstanding=0n;
 for(const snapshot of history.replay.draws){
  const drawId=snapshot.snapshot.drawId,b=only(bound,x=>x.args.drawId===drawId,'Missing draw binding'),id=b.args.requestId;
  const request=await read(rng,'requests',[id],rngAbi),binding=await read(p.short,'requests',[id]),settlement=await read(p.short,'settlements',[drawId]);
  const sealed=only(seals,x=>x.args.drawId===drawId,'Missing dataset seal');check(sealed.args.context===request.context,'Dataset RNG context mismatch');
  const seal=history.datasets.find(d=>d.drawId===drawId);check(seal&&sealed.args.proposalId===seal.proposalId,'Wrong sealed proposal');check(seal&&settlement.proposalId===seal.proposalId&&settlement.phase===3n,'Unfinished or wrong settlement');
  check(await one(p.short,'drawRequest',[drawId])===id&&binding.drawId===drawId&&binding.context===b.args.context&&binding.delivered,'Controller RNG mismatch');
  check(low(request.consumer)===p.short&&request.context===b.args.context&&request.proven&&request.delivered&&request.seed===settlement.seed,'Provider RNG mismatch');
  check(await one(rng,'contextRequest',[p.short,request.context],rngAbi)===id,'RNG context mismatch');
  const rq=only(requested,x=>x.args.id===id,'Missing Requested'),pr=only(proven,x=>x.args.id===id,'Missing Proven'),dl=only(delivered,x=>x.args.id===id,'Missing Delivered');
  check(rq.args.context===request.context&&low(rq.args.consumer)===p.short&&rq.args.round===request.round,'Request event mismatch');
  const timestamp=BigInt(evidence.get(`${rq.log.transactionHash}:${rq.log.logIndex}`).header.timestamp);
  check(request.round===1n+(timestamp+lead+1n-genesis+period-1n)/period,'Wrong future RNG round');
  check(BigInt(evidence.get(`${pr.log.transactionHash}:${pr.log.logIndex}`).header.timestamp)>=genesis+(request.round-1n)*period,'Proof before beacon time');
  check(low(rq.log.transactionHash)===low(b.log.transactionHash)&&low(rq.log.transactionHash)===low(sealed.log.transactionHash),'Nonatomic draw request');
  const tx=await rpc('eth_getTransactionByHash',[pr.log.transactionHash]);check(low(tx.hash)===low(pr.log.transactionHash)&&low(tx.blockHash)===low(pr.log.blockHash)&&low(tx.to)===rng,'Wrong prove transaction');
  const proof=rngAbi.decodeFunctionData('prove',tx.input);check(proof[0]===id,'Wrong proof id');
  check(await one(rng,'verify',[request.round,proof[1]],rngAbi),'Invalid BLS proof');
  const seed=keccak256(coder.encode(['bytes32','bytes32','uint256','address','uint256','address','bytes32'],[chainHash,sha256(proof[1]),4663,rng,id,p.short,request.context]));
  check(seed===request.seed&&pr.args.seed===seed,'Derived seed mismatch');
  check(integer(rq.log.blockNumber)<=integer(pr.log.blockNumber)&&integer(pr.log.blockNumber)<=integer(dl.log.blockNumber),'Wrong RNG event order');
  const state=await read(vault,'draws',[drawId]),r=only(reserved,x=>x.args.drawId===drawId,'Missing reserve'),f=only(finalized,x=>x.args.drawId===drawId,'Missing finalization');
  check(low(state.asset)===quote&&state.status===2n&&state.budget===r.args.budget&&state.campaignId===r.args.campaignId&&low(r.args.asset)===quote,'Vault draw mismatch');
  const result=await one(p.short,'shortResult',[drawId]),rewards=assigned.filter(x=>x.args.drawId===drawId),payments=paid.filter(x=>x.args.drawId===drawId);
  const terminal=only(terminals,x=>x.args.drawId===drawId,'Missing terminal');check(terminal.args.snapshotHash===snapshot.snapshotHash&&terminal.args.resultHash===result.resultHash&&terminal.args.outcome===(result.winners.length?1n:0n),'Terminal result mismatch');
  check(rewards.length===result.winners.length,'Winner count mismatch');let awarded=0n,paidTotal=0n;const winners=[];
  for(let i=0;i<result.winners.length;i++){
   const wallet=low(result.winners[i]),a=only(rewards,x=>low(x.args.winner)===wallet,'Reward assignment mismatch');check(a.args.amount===result.amounts[i],'Reward amount mismatch');
   const claims=payments.filter(x=>low(x.args.winner)===wallet);check(claims.length<=1,'Duplicate reward payment');let paidAmount=0n;
   for(const c of claims){check(low(c.args.asset)===quote&&c.args.amount===a.args.amount,'Paid amount mismatch');const receipt=evidence.get(`${c.log.transactionHash}:${c.log.logIndex}`).receipt;
    const transfers=receipt.logs.filter(l=>low(l.address)===quote&&l.topics[0]===abi.getEvent('Transfer').topicHash).map(l=>abi.parseLog(l).args);
    check(transfers.filter(t=>low(t.from)===vault&&low(t.to)===wallet&&t.value===c.args.amount).length===1,'Missing prize token transfer');paidAmount+=c.args.amount;
   }
   const remaining=await one(vault,'reward',[drawId,wallet]);check(remaining===a.args.amount-paidAmount,'Remaining reward mismatch');awarded+=a.args.amount;paidTotal+=paidAmount;outstanding+=remaining;winners.push({wallet,awarded:String(a.args.amount),paid:String(paidAmount),remaining:String(remaining)});
  }
  check(payments.length===winners.filter(w=>BigInt(w.paid)>0n).length,'Unknown prize recipient');
  check(state.awarded===awarded&&state.paid===paidTotal&&f.args.awarded===awarded&&f.args.released===state.budget-awarded,'Draw accounting mismatch');
  draws.push({drawId,requestId:String(id),round:String(request.round),context:request.context,seed,budget:String(state.budget),awarded:String(awarded),paid:String(paidTotal),released:String(f.args.released),winners});
 }
 const reserves={};for(const n of ['freeShort','freeCurrent','freeNext'])reserves[n]=String(await one(vault,n));
 for(const n of ['reserved','claimable'])reserves[n]=String(await one(vault,n,[quote]));reserves.balance=String(await one(quote,'balanceOf',[vault]));
 check(BigInt(reserves.reserved)===0n&&BigInt(reserves.claimable)===outstanding,'Unaccounted liabilities');
 const accounted=['freeShort','freeCurrent','freeNext','reserved','claimable'].reduce((s,k)=>s+BigInt(reserves[k]),0n);check(accounted<=BigInt(reserves.balance),'Vault deficit');reserves.unallocated=String(BigInt(reserves.balance)-accounted);
 check(await one(p.short,'pendingDatasetDraw')===ZeroHash&&await one(vault,'pendingMonthlyDrawId')===ZeroHash,'Pending draw requires handoff review');
 check(await one(p.short,'activeProposal')===ZeroHash&&await one(p.monthly,'activeMonth')===ZeroHash&&await one(p.monthly,'pendingMonth')===ZeroHash,'Active preparation requires handoff review');
 check(low((await rpc('eth_getBlockByNumber',[tag(head.number),false])).hash)===head.hash,'Finance head changed');
 return {status:'FINANCE_RNG_MATCH',head,executionEligible:false,contracts:{vault,rng,quote,codes},draws,reserves,limits:['Fixed historical head, not current live readiness','BLS verified by historical contract eth_call; not independent consensus or EVM replay','Winner selection read from controller, not independently recomputed','No worker nonce/journal/private state inspection or handoff','No full fee inflow allocation replay; liabilities and balance coverage only']};
}
