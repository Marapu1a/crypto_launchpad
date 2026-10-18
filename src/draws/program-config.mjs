// Explicit program configuration. Never silently upgrades signed launch plans.
import {validateConfig} from './config.mjs';
export const SHORT_MAX_SECONDS=604800;
export const MONTHLY_SECONDS=2592000;
export function validateProgramConfig(input){
 if(!input||![2,3,4].includes(input.version))throw Error('Expected program config v2, v3 or v4');
 const {allocation,schedule,...legacy}=input;
 const native=input.version===4,monthlyIGW=input.version===3||schedule!==undefined;
 if(input.asset!==(native?'ETH':'USDG'))throw Error('Asset does not match config version');
 if(input.version===2&&schedule!==undefined)throw Error('Legacy configuration cannot set schedule');
 if(monthlyIGW&&(!schedule||Object.keys(schedule).length!==2||schedule.algorithm!=='igw-short-v1'||schedule.cadence!=='launch-then-terminal-30d'))throw Error('Explicit IGW monthly schedule required');
 const config=validateConfig({...legacy,version:1},{asset:input.asset});
 if(!monthlyIGW&&config.short.intervalSeconds>SHORT_MAX_SECONDS)throw Error('Short: maximum seven days');
 if(monthlyIGW&&(!config.short.enabled||config.monthly.enabled||config.short.intervalSeconds!==MONTHLY_SECONDS))throw Error('IGW monthly requires only Short at 30 days');
 if(config.monthly.intervalSeconds!==MONTHLY_SECONDS)throw Error('Monthly: exactly 30 days');
 if(!allocation||Object.keys(allocation).length!==1||!Number.isInteger(allocation.shortBps)||allocation.shortBps<0||allocation.shortBps>10000)throw Error('Invalid prize allocation');
 const bps=allocation.shortBps;
 if(!config.short.enabled&&bps!==0||!config.monthly.enabled&&bps!==10000||config.short.enabled&&config.monthly.enabled&&(bps===0||bps===10000))throw Error('Allocation must fund each enabled draw');
 return {...config,version:input.version,allocation:{shortBps:bps},...(monthlyIGW?{schedule:{...schedule}}:{})};
}
// Only new unsigned drafts: no in-place migration of deployed policies.
export function igwMonthlyDraft(input){
 const c=validateProgramConfig(input);
 return validateProgramConfig({...c,version:c.asset==='ETH'?4:3,short:{...c.short,enabled:true,intervalSeconds:MONTHLY_SECONDS},monthly:{...c.monthly,enabled:false},allocation:{shortBps:10000},schedule:{algorithm:'igw-short-v1',cadence:'launch-then-terminal-30d'}});
}
// Explicit draft conversion; caller must choose the allocation, no financial default.
export function upgradeProgramDraft(legacy,shortBps){
 return validateProgramConfig({...validateConfig(legacy),version:2,allocation:{shortBps}});
}
