// Adapted pure self-batch verification from QIANQI ae445254.
// Research-only shape decoder. Never grants eligibility or runtime admission.
const {Interface,AbiCoder}=require('ethers');
const P=require('../../tickets/direct-curve.cjs');
const {inspect}=require('./pons-channel-attribution.cjs');
const EXEC=new Interface(['function execute(bytes32 mode,bytes executionCalldata) payable']);
const APPROVE=new Interface(['function approve(address spender,uint256 amount) returns(bool)']);
const TYPES=['tuple(address target,uint256 value,bytes callData)[]'];
const MODE='0x01'+'00'.repeat(31);
const low=x=>x.toLowerCase();
function decode(m,tx,receipt){
  const result={schema:'pons-batch-shape-v1',admitted:false,eligibility:null,status:'REJECTED',reason:null};
  const reject=reason=>({...result,reason});
  try{
    // Check canonical receipt provenance before interpreting any nested call.
    inspect(m,tx,receipt);
    if(low(tx.from)!==low(tx.to)||BigInt(tx.value)!==0n)return reject('NOT_ZERO_VALUE_SELF_CALL');
    const outer=EXEC.decodeFunctionData('execute',tx.input);
    if(low(EXEC.encodeFunctionData('execute',outer))!==low(tx.input)||outer.mode!==MODE)return reject('UNSUPPORTED_EXECUTION_MODE');
    const [calls]=AbiCoder.defaultAbiCoder().decode(TYPES,outer.executionCalldata);
    if(low(AbiCoder.defaultAbiCoder().encode(TYPES,[calls]))!==low(outer.executionCalldata))return reject('NON_CANONICAL_BATCH');
    // Funding calls need their own execution-boundary proof. Do not trim logs
    // to force the direct decoder to accept an ETH-funded receipt.
    if(calls.length!==2)return reject('UNSUPPORTED_CALL_SEQUENCE');
    const [approval,buy]=calls;
    if(low(approval.target)!==low(m.quote)||low(buy.target)!==low(m.curve)||approval.value!==0n||buy.value!==0n)return reject('UNSUPPORTED_CALL_TARGET');
    const a=APPROVE.decodeFunctionData('approve',approval.callData);
    const b=P.CALL.decodeFunctionData('buy',buy.callData);
    if(low(APPROVE.encodeFunctionData('approve',a))!==low(approval.callData)||low(P.CALL.encodeFunctionData('buy',b))!==low(buy.callData))return reject('NON_CANONICAL_INNER_CALL');
    if(low(a.spender)!==low(m.curve)||a.amount!==b.quoteIn||low(b.recipient)!==low(tx.from))return reject('APPROVAL_OR_RECIPIENT_MISMATCH');
    // Projection is only for reusing shape checks. It is NOT a canonical tx:
    // provenance above was checked on the original envelope and all logs stay.
    const candidates=P.decode(m,{...tx,to:buy.target,input:buy.callData},receipt);
    if(candidates.length!==1||candidates[0].status!=='ELIGIBLE')return reject(candidates[0]?.reason||'MISSING_BUY');
    const c=candidates[0];
    return {...result,status:'SHAPE_MATCH',reason:'APPROVE_THEN_CURVE_BUY',candidateId:c.candidateId,account:c.payer,observedBuyQuoteRaw:c.netQuoteDebitRaw,refundQuoteRaw:c.refundQuoteRaw,
      limits:['No executor runtime or authorization proof','No production admission or ticket accrual','Only exact approve + curve buy; funding and relayers unsupported']};
  }catch{return reject('MALFORMED_OR_INCONSISTENT_EVIDENCE');}
}
module.exports={decode,EXEC,APPROVE,TYPES,MODE};
