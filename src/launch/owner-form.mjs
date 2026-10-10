import {percentBps} from '../pons/validation.mjs';
import {validateLaunch} from './template.mjs';
import {validateDrawLaunch} from './draw-template.mjs';

// Validate a copy: failed edits must not corrupt the last valid draft or hidden settings.
export function readOwnerForm(previous,data){
 const input=structuredClone(previous),v=n=>String(data.get(n)),v2=input.draws.version===2;
 const mode=v2?v('mode'):'short';
 if(!['short','monthly','both'].includes(mode))throw Error('Выберите режим розыгрышей');
 for(const k of ['name','symbol','logo','creatorFee','openingBuy'])input.draft[k]=v(k);
 input.slug=v('slug');input.team=v('team');input.operations=v('operations');input.draws.ticketPurchase=v('ticketPurchase');
 if(mode!=='monthly'){
  const short=input.draws.short;short.minimumFund=v('minimumFund');short.intervalSeconds=Number(v('hours'))*3600;short.basket.minimumUnit=v('minimumUnit');
  const count=Number(v('count')),weights=v('weights').trim()?v('weights').split(':').map(Number):[];
  if(!Number.isInteger(count)||count<1||count>64||weights.length>count)throw Error('Нужно 1–64 места, весов не больше числа мест');
  short.basket.weights=[...weights,...Array(count-weights.length).fill(1)];
 }
 input.draws.fees={prizesBps:percentBps(v('prizes')),teamBps:percentBps(v('teamShare')),operationsBps:percentBps(v('operationsShare'))};
 if(v2){
  input.draws.short.enabled=mode!=='monthly';input.draws.monthly.enabled=mode!=='short';
  if(input.draws.monthly.enabled){input.draws.monthly.minimumFund=v('monthlyMinimum');input.draws.monthly.nextReserve=v('monthlyNext');}
  input.draws.allocation={shortBps:mode==='short'?10000:mode==='monthly'?0:Number(v('shortShare'))};
 }
 return (v2?validateDrawLaunch:validateLaunch)(input);
}
