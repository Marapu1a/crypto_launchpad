// Ethereum header bloom: a negative test proves absence, a positive is only a hint.
// Bind the bloom to the canonical header hash rather than trusting a stored flag.
const E=require('ethers');
const fields=['parentHash','sha3Uncles','miner','stateRoot','transactionsRoot','receiptsRoot','logsBloom','difficulty','number','gasLimit','gasUsed','timestamp','extraData','mixHash','nonce','baseFeePerGas'];
const quantities=new Set(['difficulty','number','gasLimit','gasUsed','timestamp','baseFeePerGas']);
const check=(ok,msg)=>{if(!ok)throw Error('Bloom evidence: '+msg);};
function encodeHeader(b){
 const values=fields.map(k=>{check(b[k]!=null,'missing header field '+k);return quantities.has(k)?BigInt(b[k])===0n?'0x':E.toBeHex(BigInt(b[k])):b[k];});
 const encoded=E.encodeRlp(values);check(E.keccak256(encoded)===b.hash.toLowerCase(),'unsupported or mismatched header');return encoded;
}
function contains(bloom,value){
 check(E.isHexString(bloom,256),'invalid bloom');const digest=E.getBytes(E.keccak256(value));let mask=0n;
 for(let i=0;i<6;i+=2)mask|=1n<<BigInt(((digest[i]<<8)|digest[i+1])&2047);
 return (BigInt(bloom)&mask)===mask;
}
function relevant(bloom,manifest,addresses=[]){
 const watched=[...(manifest?[manifest.token,manifest.curve,manifest.registry]:[]),...addresses].filter(Boolean);
 return watched.some(a=>contains(bloom,a))||!!(manifest?.manager&&contains(bloom,manifest.manager)&&contains(bloom,manifest.poolId));
}
function validateOmission(b,manifest,addresses=[]){
 if(b.ponsOmission===undefined)return;
 check(Array.isArray(b.transactions)&&b.transactions.length===0,'omission with transactions');
 const values=E.decodeRlp(b.ponsOmission);
 check(Array.isArray(values)&&values.length===16&&values.every(v=>typeof v==='string'),'unsupported header');
 check(E.encodeRlp(values)===b.ponsOmission,'noncanonical RLP');
 check(E.keccak256(b.ponsOmission)===b.hash.toLowerCase(),'header hash mismatch');
 const number=v=>v==='0x'?0n:BigInt(v);
 check(values[0].toLowerCase()===b.parentHash.toLowerCase()&&number(values[8])===BigInt(b.number)&&number(values[11])===BigInt(b.timestamp),'header identity mismatch');
 check(!relevant(values[6],manifest,addresses),'potential project event omitted');
}
module.exports={encodeHeader,contains,relevant,validateOmission};
