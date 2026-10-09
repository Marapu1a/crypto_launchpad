// Independent BigInt reference: one global gate, then one weighted interval.
const {AbiCoder,id,keccak256,isHexString,ZeroHash,ZeroAddress}=require('ethers');
const legacy=require('./short-outcome.cjs');
const coder=AbiCoder.defaultAbiCoder(),Q=1n<<128n,U=1n<<256n;
const RULES=Object.freeze({version:2,pNumerator:3,pDenominator:4,hNumerator:1,hDenominator:1});
const digest=(types,values)=>keccak256(coder.encode(types,values));
function rulesHash(r){
 if(BigInt(r.version)===1n)return legacy.rulesHash(r);
 if(!Object.entries(RULES).every(([k,v])=>String(r[k])===String(v)))throw Error('Invalid monthly rules');
 return digest(['bytes32',legacy.RULES],[id('MONTHLY_OUTCOME_RULES_V2'),r]);
}
function weight(entries){const e=BigInt(entries);if(e<1n||e>=Q)throw Error('Invalid monthly entries');return Q*e/(e+1n);}
const random=(tag,context,seed)=>BigInt(digest(['bytes32','bytes32','bytes32'],[id(tag),context,seed]));
function pays(context,seed){return random('MONTHLY_PAYOUT_V2',context,seed)<3n*(U/4n);}
function selection(context,seed,total){if(total<=0n||total>=U)throw Error('Invalid monthly total weight');return random('MONTHLY_WINNER_V2',context,seed)*total/U;}
function compute(context,seed,participants,rules,budget){
 rulesHash(rules);
 if(BigInt(rules.version)===1n){const r=legacy.compute(context,seed,participants,rules,[budget]);return {winner:r.winners[0]||ZeroAddress,admittedCount:r.admittedCount};}
 if(!isHexString(context,32)||context===ZeroHash||!isHexString(seed,32))throw Error('Invalid context/seed');
 legacy.participantsHash(participants);
 const weights=participants.map(p=>weight(BigInt(p.lastAttempt)-BigInt(p.firstAttempt)+1n));
 const totalWeight=weights.reduce((a,b)=>a+b,0n),point=selection(context,seed,totalWeight);
 let offset=0n,winner=ZeroAddress;
 const payout=pays(context,seed);
 for(let i=0;i<participants.length;i++){offset+=weights[i];if(payout&&winner===ZeroAddress&&point<offset)winner=participants[i].wallet.toLowerCase();}
 return {winner,admittedCount:payout?BigInt(participants.length):0n,totalWeight};
}
function expectedResult(m,artifact){
 const out=compute(m.context,m.seed,artifact.snapshot.participants,artifact.rules,m.budget);
 const resultHash=digest(['bytes32','bytes32','bytes32','bytes32','address','uint256','uint256'],
  [id(BigInt(artifact.rules.version)===2n?'MONTHLY_RESULT_V2':'MONTHLY_RESULT_V1'),m.context,m.seed,m.root,out.winner,out.admittedCount,m.budget]);
 return {winner:out.winner,resultHash,admittedCount:String(out.admittedCount),...(out.totalWeight===undefined?{}:{totalWeight:String(out.totalWeight)})};
}
module.exports={RULES,rulesHash,weight,pays,selection,compute,expectedResult};
