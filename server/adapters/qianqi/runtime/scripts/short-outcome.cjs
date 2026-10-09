// Exact, independent full-sort reference for the bounded top-K Solidity algorithm.
const {AbiCoder,id,keccak256,isAddress,isHexString,ZeroAddress,ZeroHash}=require('ethers');
const {hash}=require('./direct-buy.cjs');
const coder=AbiCoder.defaultAbiCoder();
const PARTICIPANTS='tuple(address wallet,uint128 firstAttempt,uint128 lastAttempt)[]';
const RULES='tuple(uint32 version,uint32 pNumerator,uint32 pDenominator,uint32 hNumerator,uint32 hDenominator)';
const RESULT='tuple(address[] winners,uint256[] amounts,uint256[] prizeIndices,uint256 admittedCount,bytes32 resultHash)';
const UINT256=1n<<256n;
const check=(ok,message)=>{if(!ok)throw Error(message);};
function uint(value,bits){
  check(typeof value==='bigint'||(typeof value==='number'&&Number.isSafeInteger(value))
    ||(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)),'Noncanonical integer');
  const n=BigInt(value);check(n>=0n&&n<(1n<<BigInt(bits)),'Integer out of range');return n;
}
const digest=(types,values)=>keccak256(coder.encode(types,values));
function gcd(a,b){while(b){[a,b]=[b,a%b];}return a;}
function validatedRules(input){
  const r=Object.fromEntries(['version','pNumerator','pDenominator','hNumerator','hDenominator'].map(k=>[k,uint(input[k],32)]));
  check(r.version===1n&&r.pNumerator>0n&&r.pNumerator<r.pDenominator&&r.hNumerator>0n&&r.hDenominator>0n
    &&gcd(r.pNumerator,r.pDenominator)===1n&&gcd(r.hNumerator,r.hDenominator)===1n,'Invalid outcome rules');
  return r;
}
function rulesHash(r){return digest(['bytes32',RULES],[id('SHORT_OUTCOME_RULES_V1'),validatedRules(r)]);}
function validatedParticipants(input){
  let previous=0n;
  return input.map(p=>{
    check(isAddress(p.wallet)&&p.wallet.toLowerCase()!==ZeroAddress,'Invalid wallet');
    const wallet=p.wallet.toLowerCase(),firstAttempt=uint(p.firstAttempt,128),lastAttempt=uint(p.lastAttempt,128);
    check(BigInt(wallet)>previous&&firstAttempt>0n&&lastAttempt>=firstAttempt,'Invalid or unsorted participant range');
    previous=BigInt(wallet);return {wallet,firstAttempt,lastAttempt};
  });
}
function participantsHash(input){return digest([PARTICIPANTS],[validatedParticipants(input)]);}
function threshold(entries,input){
  const r=validatedRules(input),e=uint(entries,128);
  return UINT256*r.pNumerator*e*r.hDenominator/(r.pDenominator*(e*r.hDenominator+r.hNumerator));
}
function commitmentsForSnapshot(snapshot){
  check(snapshot.schema==='attempt-snapshot-v1'&&snapshot.kind==='SHORT','Expected Short replay snapshot');
  const participants=validatedParticipants(snapshot.participants);
  participants.forEach((p,i)=>check(uint(snapshot.participants[i].count,128)===p.lastAttempt-p.firstAttempt+1n,'Snapshot count/range mismatch'));
  return {attemptSnapshotHash:hash(snapshot),evmParticipantsHash:participantsHash(participants),participants};
}
function verifySnapshotCommitments(replayedSnapshot,committed){
  const result=commitmentsForSnapshot(replayedSnapshot);
  check(result.attemptSnapshotHash===committed.attemptSnapshotHash.toLowerCase(),'JSON commitment mismatch');
  check(result.evmParticipantsHash===committed.evmParticipantsHash.toLowerCase(),'EVM commitment mismatch');
  return result;
}
function rank(tag,context,seed,type,value){return BigInt(digest(['bytes32','bytes32','bytes32',type],[id(tag),context,seed,value]));}
const compare=(a,b)=>a.rank<b.rank?-1:a.rank>b.rank?1:a.tie<b.tie?-1:a.tie>b.tie?1:0;
function compute(context,seed,input,rules,rawPrizes){
  check(isHexString(context,32)&&context!==ZeroHash&&isHexString(seed,32),'Invalid context/seed');
  const participants=validatedParticipants(input),r=validatedRules(rules),prizes=rawPrizes.map(p=>uint(p,256));
  check(prizes.length>0&&prizes.length<=64&&prizes.every(p=>p>0n)&&prizes.reduce((a,b)=>a+b,0n)<UINT256,'Invalid basket');
  const admitted=participants.filter(p=>rank('SHORT_ADMISSION_V1',context,seed,'address',p.wallet)<threshold(p.lastAttempt-p.firstAttempt+1n,r));
  const ordered=admitted.map(p=>({wallet:p.wallet,rank:rank('SHORT_ORDER_V1',context,seed,'address',p.wallet),tie:BigInt(p.wallet)})).sort(compare);
  const slots=prizes.map((_,i)=>({index:BigInt(i),rank:rank('SHORT_PRIZE_ORDER_V1',context,seed,'uint256',i),tie:BigInt(i)})).sort(compare);
  const count=Math.min(ordered.length,prizes.length);
  const result={winners:ordered.slice(0,count).map(p=>p.wallet),amounts:slots.slice(0,count).map(p=>prizes[Number(p.index)]),
    prizeIndices:slots.slice(0,count).map(p=>p.index),admittedCount:BigInt(admitted.length),resultHash:ZeroHash};
  result.resultHash=digest(['bytes32','bytes32','bytes32','bytes32','bytes32','bytes32',RESULT],
    [id('SHORT_RESULT_V1'),context,seed,participantsHash(participants),rulesHash(r),digest(['uint256[]'],[prizes]),result]);
  return result;
}
module.exports={compute,rulesHash,participantsHash,threshold,commitmentsForSnapshot,verifySnapshotCommitments,PARTICIPANTS,RULES,RESULT};
