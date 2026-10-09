const {Transaction}=require('ethers');
// Unprotected legacy transactions have no chainId. Bind their signed contents
// to the receipt's transaction hash; canonical block provenance is checked by replay.
function matchesChain(tx,chainId){
 if(tx.chainId!=null&&BigInt(tx.chainId)!==0n)return BigInt(tx.chainId)===BigInt(chainId);
 try{
  if(BigInt(tx.type)!==0n||![27n,28n].includes(BigInt(tx.v)))return false;
  const signed=Transaction.from({type:0,chainId:0,nonce:Number(BigInt(tx.nonce)),gasLimit:tx.gas,gasPrice:tx.gasPrice,to:tx.to,value:tx.value,data:tx.input,signature:{v:Number(BigInt(tx.v)),r:tx.r,s:tx.s}});
  return signed.hash.toLowerCase()===tx.hash.toLowerCase()&&signed.from.toLowerCase()===tx.from.toLowerCase();
 }catch{return false;}
}
module.exports={matchesChain};
