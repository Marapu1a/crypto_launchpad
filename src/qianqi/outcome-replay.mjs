import {AbiCoder,id,keccak256,ZeroHash} from 'ethers';
import {check} from './ticket-shadow.mjs';
import {participantRoot} from './history-replay.mjs';
const coder=AbiCoder.defaultAbiCoder();
export const rulesType='tuple(uint32 version,uint32 pNumerator,uint32 pDenominator,uint32 hNumerator,uint32 hDenominator)';
export const requestType='tuple(bytes32 drawId,uint64 campaignId,uint64 rulesEpoch,uint256 cutoffBlockNumber,bytes32 cutoffBlockHash,bytes32 snapshotHash,bytes32 expectedRoot,uint256 expectedCount,uint256 expectedAttempts,uint256 budget)';
export const resultType='tuple(address[] winners,uint256[] amounts,uint256[] prizeIndices,uint256 admittedCount,bytes32 resultHash)';
const hash=(types,values)=>keccak256(coder.encode(types,values));
const uint=(v,bits=256)=>{check(typeof v==='bigint'||(typeof v==='number'&&Number.isSafeInteger(v))||(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)),'Noncanonical outcome integer');const n=BigInt(v);check(n>=0n&&n<(1n<<BigInt(bits)),'Outcome integer out of range');return n;};
const gcd=(a,b)=>b?gcd(b,a%b):a;
function validateRules(r){const v=['version','pNumerator','pDenominator','hNumerator','hDenominator'].map(k=>uint(r[k],32));check(v[0]===1n&&v[1]>0n&&v[1]<v[2]&&v[3]>0n&&v[4]>0n&&gcd(v[1],v[2])===1n&&gcd(v[3],v[4])===1n,'Invalid outcome rules');return v;}
export function admissionThreshold(entries,rules){const [,pn,pd,hn,hd]=validateRules(rules),e=uint(entries,128);return (1n<<256n)*pn*e*hd/(pd*(e*hd+hn));}
export function buildBasket(budget,weights,minimumUnit){budget=uint(budget);minimumUnit=uint(minimumUnit);check(weights.length>0&&weights.length<=64&&minimumUnit>0n,'Invalid basket template');weights=weights.map(w=>{w=uint(w);check(w>0n,'Zero basket weight');return w;});const sum=uint(weights.reduce((a,b)=>a+b,0n)),unit=budget/sum;check(unit>=minimumUnit,'Budget below minimum');return {prizes:weights.map(w=>unit*w),remainder:budget-unit*sum};}
export function policyHashes(rules,weights,minimumUnit){validateRules(rules);const outcomeHash=hash(['bytes32',rulesType],[id('SHORT_OUTCOME_RULES_V1'),rules]);return {outcomeHash,policyHash:hash(['bytes32','bytes32','uint256[]','uint256'],[id('SHORT_DATASET_RULES_V1'),outcomeHash,weights,minimumUnit])};}
export function datasetContext({chainId,controller,instanceId,registry,vault,quote,request,policyHash,basketHash}){return hash(['bytes32','uint256','address','bytes32','address','address','address',requestType,'bytes32','bytes32'],[id('SHORT_DATASET_CONTEXT_V1'),chainId,controller,instanceId,registry,vault,quote,request,policyHash,basketHash]);}
export function computeDatasetOutcome({context,seed,participants,rules,weights,minimumUnit,budget}){
 check(context!==ZeroHash,'Zero outcome context');validateRules(rules);
 const root=participantRoot(participants),{prizes,remainder}=buildBasket(budget,weights,minimumUnit),{outcomeHash,policyHash}=policyHashes(rules,weights,minimumUnit),basketHash=hash(['uint256[]'],[prizes]);
 const audit=participants.map(p=>{const entries=BigInt(p.lastAttempt)-BigInt(p.firstAttempt)+1n,threshold=admissionThreshold(entries,rules),random=BigInt(hash(['bytes32','bytes32','bytes32','address'],[id('SHORT_ADMISSION_V1'),context,seed,p.wallet])),rank=BigInt(hash(['bytes32','bytes32','bytes32','address'],[id('SHORT_ORDER_V1'),context,seed,p.wallet]));return {wallet:p.wallet,entries:String(entries),threshold:String(threshold),random:String(random),rank:String(rank),admitted:random<threshold};});
 const admitted=audit.filter(p=>p.admitted).sort((a,b)=>BigInt(a.rank)<BigInt(b.rank)?-1:BigInt(a.rank)>BigInt(b.rank)?1:BigInt(a.wallet)<BigInt(b.wallet)?-1:1);
 const slots=prizes.map((_,i)=>({index:i,rank:BigInt(hash(['bytes32','bytes32','bytes32','uint256'],[id('SHORT_PRIZE_ORDER_V1'),context,seed,i]))})).sort((a,b)=>a.rank<b.rank?-1:a.rank>b.rank?1:a.index-b.index);
 const winners=admitted.slice(0,prizes.length);
 const result={winners:winners.map(p=>p.wallet),amounts:winners.map((_,i)=>String(prizes[slots[i].index])),prizeIndices:winners.map((_,i)=>String(slots[i].index)),admittedCount:String(admitted.length),resultHash:ZeroHash};
 result.resultHash=hash(['bytes32','bytes32','bytes32','bytes32','bytes32','bytes32',resultType],[id('SHORT_DATASET_RESULT_V1'),context,seed,root,outcomeHash,basketHash,result]);
 return {result,root,outcomeHash,policyHash,basketHash,prizes:prizes.map(String),remainder:String(remainder),audit};
}
