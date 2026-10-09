import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {verifyHistoryArchive} from './history-archive.mjs';
import {inspectFinance,abi} from './finance-shadow.mjs';
import {datasetAbi} from './history-replay.mjs';
import {check,canonical,contentHash,low} from './ticket-shadow.mjs';
import {computeDatasetOutcome,datasetContext} from './outcome-replay.mjs';
export async function verifyOutcomeArchive({history,capture,routes,finance}){
 const {payload:h}=await verifyHistoryArchive({history,capture,routes}),records=new Map(),proposals=new Map();
 for(const directory of [history,finance])for(const f of (await readdir(directory)).filter(f=>/^\d+-rpc.json$/.test(f)).sort()){
  const r=JSON.parse(await readFile(resolve(directory,f),'utf8'));records.set(canonical([r.method,r.params]),r.result);
  if(r.method==='eth_getLogs')for(const l of r.result)if(low(l.address)===low(h.publicProfile.lifecycle.source)&&l.topics[0]===datasetAbi.getEvent('DatasetProposed').topicHash){const decoded=datasetAbi.parseLog(l);const key=decoded.args.proposalId;check(!proposals.has(key)||canonical(proposals.get(key))===canonical(l),'Conflicting proposal evidence');proposals.set(key,l);}
 }
 const rpc=async(method,params)=>{const r=records.get(canonical([method,params]));check(r!==undefined,'Missing outcome archive evidence');return structuredClone(r);};
 const financial=await inspectFinance({rpc,head:h.provenance.head,history:h});const draws=[];
 for(const snapshot of h.replay.draws){
  const binding=h.datasets.find(d=>d.drawId===snapshot.snapshot.drawId),log=proposals.get(binding.proposalId);check(log,'Missing outcome proposal');
  const {request,rules,weights,minimumUnit}=datasetAbi.parseLog(log).args;
  const financeDraw=financial.draws.find(d=>d.drawId===snapshot.snapshot.drawId);check(financeDraw,'Missing verified seed');
  const computed=computeDatasetOutcome({context:financeDraw.context,seed:financeDraw.seed,participants:snapshot.snapshot.participants,rules,weights,minimumUnit,budget:request.budget});
  check(computed.root===request.expectedRoot&&computed.policyHash===snapshot.snapshot.rulesHash,'Outcome input commitment mismatch');
  const l=h.publicProfile.lifecycle;
  const context=datasetContext({chainId:4663,controller:l.source,instanceId:l.instanceId,registry:h.publicProfile.profile.registry,vault:l.vault,quote:financial.contracts.quote,request,policyHash:computed.policyHash,basketHash:computed.basketHash});
  check(context===financeDraw.context&&String(request.budget)===financeDraw.budget,'Rebuilt RNG context mismatch');
  // Controller values are comparison targets only, never inputs to computeDatasetOutcome.
  const raw=await rpc('eth_call',[{to:l.source,data:abi.encodeFunctionData('shortResult',[request.drawId])},'0x'+h.provenance.head.number.toString(16)]);
  const observed=abi.decodeFunctionResult('shortResult',raw)[0];
  const expected={winners:observed.winners.map(low),amounts:observed.amounts.map(String),prizeIndices:observed.prizeIndices.map(String),admittedCount:String(observed.admittedCount),resultHash:observed.resultHash};
  check(contentHash(computed.result)===contentHash(expected),'Independent outcome mismatch');
  check(computed.result.winners.length===financeDraw.winners.length&&computed.result.winners.every((w,i)=>w===financeDraw.winners[i].wallet&&computed.result.amounts[i]===financeDraw.winners[i].awarded),'Independent payout mismatch');
  draws.push({drawId:request.drawId,context,seed:financeDraw.seed,rules:Object.fromEntries(['version','pNumerator','pDenominator','hNumerator','hDenominator'].map(k=>[k,String(rules[k])])),weights:weights.map(String),minimumUnit:String(minimumUnit),budget:String(request.budget),...computed});
 }
 return {status:'INDEPENDENT_SHORT_OUTCOMES_MATCH',head:h.provenance.head,executionEligible:false,draws,limits:['Historical captured RPC canonicality and event completeness trusted','BLS verified by historical contract eth_call, not local independent cryptography','Only two completed Short draws; no Monthly outcome verification','No server deployment, private worker journal audit or handoff']};
}
