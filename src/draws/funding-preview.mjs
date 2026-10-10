// Pure receipt-allocation preview, NOT a vault or settlement journal.
import {amount} from './config.mjs';
import {validateProgramConfig} from './program-config.mjs';
const MAX=(1n<<256n)-1n;
const uint=n=>{if(typeof n!=='bigint'||n<0n||n>MAX)throw Error('Expected uint256 bigint');return n;};
const ceilDiv=(n,d)=>(n+d-1n)/d;
function totals(config,received){
 const short=ceilDiv(received*BigInt(config.allocation.shortBps),10000n);
 const monthly=received-short;
 const candidate=monthly/3n;
 const cap=amount(config.monthly.nextReserve);
 const next=candidate>cap?cap:candidate;
 return {short,current:monthly-next,next};
}
export function createFundingPreview(input){
 const config=validateProgramConfig(input);
 return {schema:'draw-funding-preview-v2',config,received:0n,short:0n,current:0n,next:0n};
}
export function previewFundingReceipt(previous,receipt){
 uint(receipt);
 if(!previous||previous.schema!=='draw-funding-preview-v2'||Object.keys(previous).some(k=>!['schema','config','received','short','current','next'].includes(k)))throw Error('Invalid preview state');
 const config=validateProgramConfig(previous.config),received=uint(previous.received);
 const expected=totals(config,received);
 for(const k of ['short','current','next'])if(uint(previous[k])!==expected[k])throw Error('Inconsistent preview balances');
 const total=uint(received+receipt),balances=totals(config,total);
 const allocated=Object.fromEntries(Object.keys(balances).map(k=>[k,balances[k]-previous[k]]));
 return {state:{schema:previous.schema,config,received:total,...balances},allocated};
}
