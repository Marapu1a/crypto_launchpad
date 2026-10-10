// V2 planning only. Never silently upgrades signed v1 launch plans.
import {validateConfig} from './config.mjs';
export const SHORT_MAX_SECONDS=604800;
export const MONTHLY_SECONDS=2592000;
export function validateProgramConfig(input){
 if(!input||input.version!==2)throw Error('Expected program config v2');
 const {allocation,...legacy}=input;
 const config=validateConfig({...legacy,version:1});
 if(config.short.intervalSeconds>SHORT_MAX_SECONDS)throw Error('Short: maximum seven days');
 if(config.monthly.intervalSeconds!==MONTHLY_SECONDS)throw Error('Monthly: exactly 30 days');
 if(!allocation||Object.keys(allocation).length!==1||!Number.isInteger(allocation.shortBps)||allocation.shortBps<0||allocation.shortBps>10000)throw Error('Invalid prize allocation');
 const bps=allocation.shortBps;
 if(!config.short.enabled&&bps!==0||!config.monthly.enabled&&bps!==10000||config.short.enabled&&config.monthly.enabled&&(bps===0||bps===10000))throw Error('Allocation must fund each enabled draw');
 return {...config,version:2,allocation:{shortBps:bps}};
}
// Explicit draft conversion; caller must choose the allocation, no financial default.
export function upgradeProgramDraft(legacy,shortBps){
 return validateProgramConfig({...validateConfig(legacy),version:2,allocation:{shortBps}});
}
