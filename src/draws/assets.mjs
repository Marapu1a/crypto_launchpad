import {ZeroAddress} from 'ethers';
export const ASSETS=Object.freeze({
 USDG:Object.freeze({symbol:'USDG',address:'0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',decimals:6,native:false}),
 ETH:Object.freeze({symbol:'ETH',address:ZeroAddress,decimals:18,native:true})
});
export function drawAsset(symbol){if(typeof symbol!=='string'||!Object.hasOwn(ASSETS,symbol))throw Error('Unsupported draw asset');return ASSETS[symbol];}
export function quoteAddress(policy){return policy.template.config.asset==='ETH'?ZeroAddress:policy.contracts.quote.address;}
