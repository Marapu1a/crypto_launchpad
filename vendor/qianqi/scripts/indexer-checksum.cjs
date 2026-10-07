// Local storage integrity only. Does not change any ledger/config/on-chain hash.
const {createHash}=require('node:crypto');
const {canonical,hash}=require('./direct-buy.cjs');
// Preserve the existing canonical bytes without building one history-sized string.
function indexerChecksum(payload){
 const digest=createHash('sha256');
 function visit(value,depth=0){
  if(depth>=3||!value||typeof value!=='object'){digest.update(canonical(value),'utf8');return;}
  if(Array.isArray(value)){digest.update('[');value.forEach((v,i)=>{if(i)digest.update(',');visit(v,depth+1);});digest.update(']');}
  else{digest.update('{');Object.keys(value).sort().forEach((k,i)=>{if(i)digest.update(',');digest.update(JSON.stringify(k)+':');visit(value[k],depth+1);});digest.update('}');}
 }
 visit(payload);return 'sha256-v1:'+digest.digest('hex');
}
function validIndexerChecksum(payload,checksum){
 return typeof checksum==='string'&&(checksum.startsWith('sha256-v1:')?checksum===indexerChecksum(payload):checksum===hash(payload));
}
module.exports={indexerChecksum,validIndexerChecksum};
