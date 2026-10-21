import {check} from './store.mjs';

// The provider recommendation includes headroom (usually 2 * baseFee). It is
// not a minimum inclusion price. Keep the owner's ceiling and require enough
// room for the observed base fee plus the recommended priority fee.
export function boundedPwFees(fees,baseFee,ceiling){
 const recommended=fees.maxFeePerGas??fees.gasPrice,priority=fees.maxPriorityFeePerGas??0n;
 const cap=BigInt(ceiling);
 check(typeof recommended==='bigint'&&recommended>0n&&typeof baseFee==='bigint'&&baseFee>=0n&&priority>=0n&&cap>0n,'Launch fee data unavailable');
 const maxFee=recommended<cap?recommended:cap;
 check(baseFee+priority<=maxFee,'Launch fee exceeds approved budget');
 return {maxFeePerGas:maxFee,maxPriorityFeePerGas:priority};
}
