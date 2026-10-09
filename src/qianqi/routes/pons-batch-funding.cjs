// Adapted pure self-batch verification from QIANQI ae445254.
// Research-only ETH funding shape. Does not prove execution call boundaries.
const {Interface,AbiCoder,ZeroAddress}=require('ethers');
const B=require('./pons-batch-buy.cjs');
const P=require('../../tickets/direct-curve.cjs');
const {inspect}=require('./pons-channel-attribution.cjs');
const ROUTER=new Interface(['function multicall(uint256 deadline,bytes[] data) payable returns(bytes[])','function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns(uint256)']);
const low=x=>x.toLowerCase();
const check=(ok,why)=>{if(!ok)throw Error(why);};
function canonical(iface,name,data){const a=iface.decodeFunctionData(name,data);check(low(iface.encodeFunctionData(name,a))===low(data),'NON_CANONICAL_CALL');return a;}
function decode(m,profile,tx,receipt){
 const base={schema:'pons-eth-funding-shape-v1',admitted:false,eligibility:null};
 try{
  const observation=inspect(m,tx,receipt),account=low(tx.from);
  check(account===low(tx.to)&&BigInt(tx.value)===0n,'NOT_SELF_CALL');
  const outer=canonical(B.EXEC,'execute',tx.input);check(outer.mode===B.MODE,'WRONG_MODE');
  const [calls]=AbiCoder.defaultAbiCoder().decode(B.TYPES,outer.executionCalldata);
  check(low(AbiCoder.defaultAbiCoder().encode(B.TYPES,[calls]))===low(outer.executionCalldata),'NON_CANONICAL_BATCH');
  check(calls.length===5,'CALL_COUNT');
  const [wrap,approve,swap,quoteApprove,buy]=calls;
  check(low(wrap.target)===low(profile.weth)&&wrap.callData==='0xd0e30db0'&&wrap.value>0n,'WRAP_MISMATCH');
  check(calls.slice(1).every(c=>c.value===0n),'EXTRA_NATIVE_VALUE');
  check(low(approve.target)===low(profile.weth)&&low(swap.target)===low(profile.router)&&low(quoteApprove.target)===low(m.quote)&&low(buy.target)===low(m.curve),'TARGET_MISMATCH');
  const approval=canonical(B.APPROVE,'approve',approve.callData);
  check(low(approval.spender)===low(profile.router)&&approval.amount===wrap.value,'WETH_APPROVAL_MISMATCH');
  const multicall=canonical(ROUTER,'multicall',swap.callData);check(multicall.data.length===1,'SWAP_CALL_COUNT');
  const {params}=canonical(ROUTER,'exactInput',multicall.data[0]);
  const path=low(profile.weth)+'000064'+low(m.quote).slice(2);
  check(low(params.path)===path&&low(params.recipient)===account&&params.amountIn===wrap.value,'SWAP_INPUT_MISMATCH');
  const qa=canonical(B.APPROVE,'approve',quoteApprove.callData),bc=canonical(P.CALL,'buy',buy.callData);
  check(low(qa.spender)===low(m.curve)&&qa.amount===bc.quoteIn&&bc.quoteIn===params.amountOutMinimum&&bc.quoteIn>0n&&low(bc.recipient)===account,'BUY_MISMATCH');
  const topic=P.TRANSFER.getEvent('Transfer').topicHash;
  const transfers=receipt.logs.filter(l=>l.topics[0]===topic&&[low(profile.weth),low(m.quote),low(m.token)].includes(low(l.address))).map(l=>({asset:low(l.address),...P.TRANSFER.parseLog(l).args.toObject(),index:BigInt(l.logIndex)}));
  const wt=transfers.filter(t=>t.asset===low(profile.weth));
  const mint=wt.find(t=>low(t.from)===ZeroAddress&&low(t.to)===account);
  const spend=wt.find(t=>low(t.from)===account&&low(t.to)===low(profile.pool));
  check(wt.length===2&&mint&&spend&&mint.value===wrap.value&&spend.value===wrap.value&&mint.index<spend.index,'WETH_FLOW_MISMATCH');
  const qt=transfers.filter(t=>t.asset===low(m.quote));
  const funding=qt.find(t=>low(t.from)===low(profile.pool)&&low(t.to)===account);
  const payment=qt.find(t=>low(t.from)===account&&low(t.to)===low(m.curve));
  check(qt.length===2&&funding&&payment&&funding.value>=bc.quoteIn&&payment.value===bc.quoteIn&&mint.index<funding.index&&funding.index<spend.index&&spend.index<payment.index,'QUOTE_FLOW_MISMATCH');
  const tt=transfers.filter(t=>t.asset===low(m.token));
  check(tt.length===1&&low(tt[0].from)===low(m.curve)&&low(tt[0].to)===account&&payment.index<tt[0].index,'TOKEN_FLOW_MISMATCH');
  check(observation.events.length===1,'BUY_EVENT_COUNT');const e=observation.events[0];
  check(e.curveCaller===account&&e.curveRecipient===account&&BigInt(e.quoteInRaw)===bc.quoteIn&&BigInt(e.tokensOutRaw)===tt[0].value&&tt[0].value>=bc.minTokensOut&&tt[0].index<BigInt(e.logIndex),'BUY_EVENT_MISMATCH');
  check(!receipt.logs.some(l=>low(l.address)===low(m.curve)&&[P.EVENTS.getEvent('CurveBuyRefunded').topicHash,P.EVENTS.getEvent('CurveSell').topicHash].includes(l.topics[0])),'REFUND_OR_SELL_UNSUPPORTED');
  return {...base,status:'SHAPE_MATCH',account,candidateId:e.candidateId,fundingQuoteRaw:String(funding.value),observedBuyQuoteRaw:String(payment.value),unspentFundingQuoteRaw:String(funding.value-payment.value),fundingLogIndex:String(funding.index),paymentLogIndex:String(payment.index),limits:['Profile supplied by caller, not admitted','Logs and calldata are not trace call-boundary proof','No refund, multihop, relay or production eligibility']};
 }catch(e){return {...base,status:'REJECTED',reason:e.message};}
}
module.exports={decode,ROUTER};
