import {Interface,ZeroAddress} from 'ethers';
import {digest} from '../tickets/digest.mjs';
import {holderFundingInstance} from './funding-receipt.mjs';

const abi=new Interface([
 'function forward()', 'function deliver(uint256 lane)',
 'event Revenue(bytes32 indexed instance,address indexed source,uint256 amount,uint256 totalReceived)',
 'event Delivered(uint256 indexed lane,address indexed recipient,uint256 amount)',
 'event Deposited(bytes32 indexed instance,address indexed source,uint256 amount,uint256 totalReceived)'
]);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
function requireEvidence(value){if(!value)throw Object.assign(Error('holder-funding-evidence-missing'),{code:'HOLDER_FUNDING_EVIDENCE_MISSING'});}

// Pure validation before any holder import or cursor write. Never infer the lane
// from whichever events an incomplete receipt happens to contain.
export function serviceFundingLogs(policy,history,transaction,receipt){
 const forward=history.action.endsWith(':collector.forward'),role=forward?'collector':'splitter';
 requireEvidence(forward||history.action.endsWith(':splitter.deliver'));
 const t=transaction,r=receipt;
 requireEvidence(t&&r&&r.status===1&&same(r.hash,history.hash)&&same(r.blockHash,history.blockHash)&&r.blockNumber===history.blockNumber);
 requireEvidence(same(t.hash,history.hash)&&same(t.to,policy.contracts[role].address)&&same(t.from,policy.executor)&&t.nonce===history.nonce&&t.chainId===4663n&&t.value===0n);
 requireEvidence(same(t.blockHash,r.blockHash)&&t.blockNumber===r.blockNumber&&digest({to:t.to.toLowerCase(),data:t.data,value:'0'})===history.requestHash);
 let call;try{call=abi.parseTransaction(t);}catch{requireEvidence(false);}
 requireEvidence(call?.name===(forward?'forward':'deliver'));
 requireEvidence(t.data===abi.encodeFunctionData(call.name,Array.from(call.args)));
 const instance=holderFundingInstance({projectId:policy.projectId,chainId:4663,token:policy.contracts.token.address.toLowerCase(),asset:ZeroAddress});
 const logs=(name,role)=>r.logs.filter(l=>same(l.address,policy.contracts[role].address)&&l.topics[0]===abi.getEvent(name).topicHash).map(log=>{
  requireEvidence(!log.removed&&Number.isSafeInteger(log.index)&&log.index>=0);
  let event;try{event=abi.parseLog(log);}catch{requireEvidence(false);}return {log,args:event.args};
 });
 const revenues=logs('Revenue','splitter'),deposits=logs('Deposited','vault'),deliveries=logs('Delivered','splitter');
 if(forward){
  requireEvidence(revenues.length===1&&deposits.length===0&&deliveries.length===0);
  const {args,log}=revenues[0];
  requireEvidence(args.instance===instance&&same(args.source,policy.contracts.collector.address)&&args.amount>0n&&args.totalReceived>=args.amount);
  return [log];
 }
 const lane=Number(call.args[0]);requireEvidence([0,1,2].includes(lane)&&revenues.length===0&&deliveries.length===1);
 const delivered=deliveries[0].args,recipient=lane===0?policy.contracts.vault.address:lane===1?policy.contracts.short.address:policy.project;
 requireEvidence(delivered.lane===BigInt(lane)&&same(delivered.recipient,recipient)&&delivered.amount>0n);
 if(lane!==0){requireEvidence(deposits.length===0);return [];}
 requireEvidence(deposits.length===1);
 const {args,log}=deposits[0];
 requireEvidence(args.instance===instance&&same(args.source,policy.contracts.splitter.address)&&args.amount===delivered.amount&&args.totalReceived>=args.amount);
 return [log];
}
