// RPC-selected project evidence. Absence in gaps is an RPC assertion, not a header proof.
const SCHEMA='pons-project-events-v1';
const n=x=>Number(BigInt(x)),low=x=>x.toLowerCase();
const check=(v,m)=>{if(!v)throw Error('Project history: '+m);};
function genesis(input){return input.versions?input.versions[0].manifest:input;}
function watched(input,lifecycle,extra=[]){const m=genesis(input);return [...new Set([m.token,m.curve,m.registry,lifecycle?.source,lifecycle?.monthlySource,lifecycle?.vault,input.recognition?.source,...extra].filter(Boolean).map(low))].sort();}
function relevant(log,m,addresses){return addresses.includes(low(log.address))||!!(m.manager&&low(log.address)===low(m.manager)&&log.topics[1]?.toLowerCase()===m.poolId?.toLowerCase());}
function mark(blocks,input,lifecycle,previous,extra=[]){
 const m=genesis(input),addresses=watched(input,lifecycle,extra);let prev=previous??{number:n(m.anchor.number),hash:low(m.anchor.hash)};
 return blocks.map(b=>{const out={...b,projectEvidence:{schema:SCHEMA,chainId:String(m.chainId),token:low(m.token),addresses,previousNumber:n(prev.number),previousHash:low(prev.hash)}};delete out.ponsOmission;prev=b;return out;});
}
function validate(b,input,previous){
 const m=genesis(input),p=b.projectEvidence;
 check(p?.schema===SCHEMA&&String(p.chainId)===String(m.chainId)&&p.token===low(m.token),'wrong domain');
 check(require('./pons-profiles.cjs').get(m.schema),'Pons only');
 check(Array.isArray(p.addresses)&&watched(m).every(a=>p.addresses.includes(a)),'missing watched source');
 check(Number.isSafeInteger(p.previousNumber)&&p.previousNumber>=n(m.anchor.number)&&n(b.number)>p.previousNumber,'invalid range');
 if(previous)check(p.previousNumber===previous.number&&p.previousHash===previous.hash,'disconnected range');
 if(n(b.number)===p.previousNumber+1)check(low(b.parentHash)===p.previousHash,'adjacent branch mismatch');
}
function validateSources(b,addresses){if(!b.projectEvidence)return;check(addresses.filter(Boolean).every(a=>b.projectEvidence.addresses.includes(low(a))),'lifecycle source not watched');}
function compact(blocks,input,lifecycle,{tail=128,extra=[]}={}){
 if(!blocks.length)return [];
 const m=genesis(input),addresses=watched(input,lifecycle,extra),end=n(blocks.at(-1).number);
 const notices=new Set((input.versions||[]).slice(1).map(v=>v.announcedAtBlock));
 const kept=[];
 for(const b of blocks){
  const hasProjectEvent=b.transactions.some(({receipt})=>receipt.logs.some(l=>relevant(l,m,addresses)));
  // A neighboring 7702 authorization can invalidate a buyer's parent delegation.
  // Keep its full envelope/receipt as execution context only in project event blocks.
  const transactions=b.transactions.filter(({tx,receipt})=>receipt.logs.some(l=>relevant(l,m,addresses))||(hasProjectEvent&&tx.authorizationList?.length));
  if(!transactions.length&&n(b.number)<end-tail&&!notices.has(n(b.number)))continue;
  const out={number:b.number,hash:b.hash,parentHash:b.parentHash,timestamp:b.timestamp,transactions};
  if(transactions.length){for(const key of ['batchAccounts','entrypointAccounts','projectReferences','recognitionSourceCode','recognitionBundles'])if(b[key])out[key]=b[key];}
  kept.push(out);
 }
 return mark(kept,input,lifecycle,undefined,extra);
}
async function references(blocks,input,lifecycle,rpc,lookup=[]){
 if(!lifecycle)return;
 const addresses=[lifecycle.source,lifecycle.monthlySource].filter(Boolean).map(low),abi=require('./attempt-lifecycle.cjs').ABI;
 const known=new Map([...lookup,...blocks].map(b=>[n(b.number),b]));
 for(const b of blocks){
  const refs=new Map((b.projectReferences||[]).map(r=>[n(r.number),r]));
  for(const {receipt} of b.transactions)for(const l of receipt.logs){
   if(!addresses.includes(low(l.address)))continue;let event;try{event=abi.parseLog(l);}catch{continue;}
   if(event?.args.cutoffBlockNumber===undefined)continue;
   const height=n(event.args.cutoffBlockNumber);let h=known.get(height)||refs.get(height);
   if(!h){check(rpc,'missing cutoff header');h=await rpc('eth_getBlockByNumber',['0x'+BigInt(height).toString(16),false]);}
   check(h&&n(h.number)===height&&low(h.hash)===low(event.args.cutoffBlockHash)&&height<n(b.number),'invalid cutoff header');
   refs.set(height,{number:h.number,hash:h.hash,timestamp:h.timestamp});
  }
  if(refs.size)b.projectReferences=[...refs.values()];
 }
}
function provenance(mode){return mode===SCHEMA?{evidenceMode:SCHEMA,historyCompleteness:'trusted-rpc-log-selection; gaps-not-independently-proven'}:{};}
module.exports={SCHEMA,genesis,watched,relevant,mark,validate,validateSources,compact,references,provenance};
