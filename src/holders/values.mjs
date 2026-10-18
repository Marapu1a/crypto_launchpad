import {digest} from '../tickets/digest.mjs';
export const check=(ok,message)=>{if(!ok)throw Error(message);};
export function uint(value){
 check(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value),'Expected canonical integer string');
 const n=BigInt(value);check(n<(1n<<256n),'uint256 overflow');return n;
}
export function address(value){check(typeof value==='string'&&/^0x[0-9a-f]{40}$/i.test(value),'Invalid address');return value.toLowerCase();}
export function key(value){check(typeof value==='string'&&/^[a-zA-Z0-9:_./-]{1,160}$/.test(value),'Invalid identifier');return value;}
export function hash(value){check(typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value),'Invalid transaction hash');return value.toLowerCase();}
export function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
 check(value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value),'Non-JSON value');return value;
}
export const identity=value=>digest(canonical(value));
export function scope(input){
 check(input&&Number.isSafeInteger(input.chainId)&&input.chainId>0,'Invalid chain');
 return {projectId:key(input.projectId),chainId:input.chainId,token:address(input.token),asset:address(input.asset)};
}
