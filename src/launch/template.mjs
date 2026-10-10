import {getAddress,ZeroAddress} from 'ethers';
import {validateConfig} from '../draws/config.mjs';
import {initialDraft} from '../pons/plan.mjs';
import {assertDraft,DRAFT_FIELDS} from '../pons/validation.mjs';
export const USDG='0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
export const ESCROW='0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e';
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validateLaunch(input){
 if(!input||Object.keys(input).some(k=>!['id','slug','draft','draws','team','operations'].includes(k))||!UUID.test(input.id)||!/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(input.slug))throw Error('Неверный идентификатор или поддомен проекта');
 const draws=validateConfig(input.draws);
 if(!input.draft||Object.keys(input.draft).some(k=>!DRAFT_FIELDS.includes(k))||!/^0x[0-9a-fA-F]{64}$/.test(input.draft.salt??''))throw Error('Нужен сохранённый черновик запуска');
 if(!draws.short.enabled||draws.monthly.enabled)throw Error('Этот шаблон поддерживает только Short');
 const team=getAddress(input.team),operations=getAddress(input.operations);
 if(team===ZeroAddress||operations===ZeroAddress)throw Error('Нужны адреса команды и обслуживания');
 const draft={...initialDraft(),...input.draft};
 if(draft.pair.toLowerCase()!==USDG.toLowerCase()||draft.destination!=='wallet'||draft.feeWallet)throw Error('Нужна пара USDG; получателя комиссий закрепляет шаблон');
 assertDraft(draft,{account:team,requireAccount:true});
 return {id:input.id,slug:input.slug,draft,draws,team,operations};
}
