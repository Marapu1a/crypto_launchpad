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

export function boundedPwGas(estimate,ceiling){
 const cap=BigInt(ceiling),preferred=(estimate*120n+99n)/100n;
 // Retain at least 10% headroom. A slightly smaller than 20% margin is
 // acceptable without changing the approved gas cap or total launch budget.
 check(estimate>0n&&(estimate*110n+99n)/100n<=cap,'Launch gas exceeds approved budget');
 return preferred<cap?preferred:cap;
}
