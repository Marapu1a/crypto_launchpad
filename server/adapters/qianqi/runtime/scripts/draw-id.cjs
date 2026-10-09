const {isHexString,toBeHex}=require('ethers');
const MASK=(1n<<255n)-1n;
function kindNumber(kind){
  if(kind==='SHORT'||kind===0)return 0n;
  if(kind==='MONTHLY'||kind===1)return 1n;
  throw Error('Invalid draw kind');
}
// The seed is a bytes32 identifier, not randomness used to choose winners.
function drawIdFor(kind,seed){
  const k=kindNumber(kind);
  if(!isHexString(seed,32)||(BigInt(seed)&MASK)===0n)throw Error('Invalid draw ID payload');
  return toBeHex((k<<255n)|(BigInt(seed)&MASK),32);
}
function validateDrawId(drawId,kind){
  if(!isHexString(drawId,32)||drawIdFor(kind,drawId)!==drawId.toLowerCase())throw Error('Wrong draw ID namespace');
}
module.exports={drawIdFor,validateDrawId};
