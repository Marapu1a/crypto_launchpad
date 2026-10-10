import {validateLaunch} from './template.mjs';
import {validateProgramConfig} from '../draws/program-config.mjs';
// Reuse Pons/identity/address validation, without mutating or upgrading signed v1 input.
export function validateDrawLaunch(input){
 const draws=validateProgramConfig(input?.draws);
 const {allocation,version,...legacy}=draws;
 const validated=validateLaunch({...input,draws:{...legacy,version:1,short:{...legacy.short,enabled:true},monthly:{...legacy.monthly,enabled:false}}});
 return {...validated,draws};
}
