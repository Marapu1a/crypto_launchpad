// Pure verification extracted from rh_project 11a050d purchase-recognition.cjs.
const E=require('ethers');
const low=x=>String(x).toLowerCase(),check=(v,m)=>{if(!v)throw Error('Purchase recognition: '+m);};
function pins(m,t){
 return {
  '0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc':'0xf9e0c7528d41526b7e818b1b8dcab413df3f20e8908b5386e4ba6f3c3ef07a8f',
  '0x56101165bcf508b288f383113892e6db6be6db0e':'0x138db16738c14ad90956aecbd0939fcbf72e9d39755867e02b87a4d927a2f4ab',
  '0xd17b21b65cc273a4b342f14b19063da8bb410dbd':'0x0f3e60976384e62a8359f1c3a6424b488b12a05bfa82366fdffafd9d3d1fbf95',
  '0x1ab4c5dfe15ff16170201d7fe0edc20c3d0cada3':'0x0a9f1cdcd49033dedb5525414b57d74ca5aa4832d86263a4189adab37f334174',
  ...Object.fromEntries(['quote','token','curve','weth','fundingPool'].map(k=>[low(m[k]),m.codeHashes[k]])),
  ...Object.fromEntries(Object.values(t.implementations).map(x=>[low(x.address),x.codeHash]))
 };
}
function verify(m,t,row,proof,block){
 const {tx,receipt}=row;
 if(t.adapter==='pons-native-reviewed-v2'&&low(tx.to)!=='0x65050a9b7e5075a2ba5ced7b1b64ee66262c40dc'){const park=require('./pons-park-native.cjs');return (low(tx.to)===park.ROUTER||low(tx.to)===low(tx.from)?park:require('./pons-native-settlement.cjs')).verify(m,row,proof,block);}
 check(!tx.authorizationList?.length,'authorization-bearing transaction');
 check(proof.transactionHash===low(tx.hash)&&proof.blockHash===low(block.hash),'proof purchase binding');
 const shape=require('./pons-router-calldata-research.cjs').decode(m,tx);
 check(shape.deadline>=BigInt(block.timestamp),'expired purchase');
 const result=require('./pons-router-trace-research.cjs').inspect({manifest:m,tx,receipt,trace:proof.trace});
 const expected=pins(m,t),fee='0xb8159ba378904f803639d274cec79f788931c9c8';
 const executed=new Set();
 function walk(frame){
  const address=low(frame.to);executed.add(address);
  if(address===fee)check(frame.type==='CALL'&&frame.input==='0x'&&!(frame.calls?.length)&&!(frame.logs?.length),'fee receiver callback');
  else check(expected[address],'unreviewed execution target');
  for(const child of frame.calls||[])walk(child);
 }
 walk(proof.trace);
 for(const address of executed){
  const codeHash=proof.codeHashes?.[address];check(E.isHexString(codeHash,32),'missing runtime evidence');
  check(proof.parentCodeHashes?.[address]===codeHash,'runtime changed or missing parent evidence');
  check(codeHash===(address===fee?E.keccak256('0x'):low(expected[address])),'runtime mismatch');
 }
 // The outer signer is the only supported beneficiary. Contract/7702 accounts
 // require a separate adapter; never infer ownership through an arbitrary caller.
 check(proof.codeHashes?.[low(tx.from)]===E.keccak256('0x')&&proof.parentCodeHashes?.[low(tx.from)]===E.keccak256('0x'),'non-EOA payer');
 if(shape.native){
  const feeAmount=shape.amountIn/100n,payments=result.nativePayments;
  check(payments.length===2&&payments[0].to===fee&&BigInt(payments[0].valueRaw)===feeAmount&&payments[1].to===low(m.weth)&&BigInt(payments[1].valueRaw)===shape.amountIn-feeAmount,'native funding mismatch');
 }
 return {payer:result.recipient,recipient:result.recipient,grossQuoteRaw:shape.native?result.curveQuoteRaw:result.observedWalletQuoteDebitRaw};
}

module.exports={verify};
