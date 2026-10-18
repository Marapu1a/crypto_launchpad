import {drawAsset} from '../draws/assets.mjs';
import {percentBps} from '../pons/validation.mjs';
import {validateLaunch} from './template.mjs';
import {validateDrawLaunch} from './draw-template.mjs';
import {igwMonthlyDraft} from '../draws/program-config.mjs';

// Validate a copy: failed edits must not corrupt the last valid draft or hidden settings.
export function readOwnerForm(previous,data){
 const input=structuredClone(previous),v=n=>String(data.get(n)),v2=[2,3,4].includes(input.draws.version);
 const monthlyIGW=v2&&(data.has('schedule')?v('schedule')==='igw-monthly':!!input.draws.schedule);
 if(data.has('schedule')&&!['legacy','igw-monthly'].includes(v('schedule')))throw Error('Invalid schedule');
 if(input.draws.schedule&&!monthlyIGW)throw Error('Create a separate legacy draft');
 const requestedAsset=v2&&data.has('asset')?v('asset'):input.draws.asset;drawAsset(requestedAsset);
 if(requestedAsset!==input.draws.asset){
  input.draws.asset=requestedAsset;input.draws.version=requestedAsset==='ETH'?4:(monthlyIGW?3:2);input.draft.pair=drawAsset(requestedAsset).address;
  // Every amount must be re-entered when the unit changes, including hidden lanes.
  for(const name of ['ticketPurchase','minimumFund','minimumUnit','monthlyMinimum','monthlyNext'])if(!data.has(name)||!v(name).trim())throw Error('Enter explicit amounts for the selected asset');
  input.draws.short.minimumFund=v('minimumFund');input.draws.short.basket.minimumUnit=v('minimumUnit');input.draws.monthly.minimumFund=v('monthlyMinimum');input.draws.monthly.nextReserve=v('monthlyNext');
 }
 const mode=monthlyIGW?'short':v2?v('mode'):'short';
 if(!['short','monthly','both'].includes(mode))throw Error('Выберите режим розыгрышей');
 for(const k of ['name','symbol','creatorFee','openingBuy'])input.draft[k]=v(k);
 for(const k of ['logo','website'])if(data.has(k))input.draft[k]=v(k);
 if(data.has('slug'))input.slug=v('slug');
 input.team=v('team');input.operations=v('operations');input.draws.ticketPurchase=v('ticketPurchase');
 if(!input.draws.monthly.minimumFund&&data.has('monthlyMinimum'))input.draws.monthly.minimumFund=v('monthlyMinimum');
 if(!input.draws.monthly.nextReserve&&data.has('monthlyNext'))input.draws.monthly.nextReserve=v('monthlyNext');
 if(!input.draws.short.minimumFund&&data.has('minimumFund'))input.draws.short.minimumFund=v('minimumFund');
 if(!input.draws.short.basket.minimumUnit&&data.has('minimumUnit'))input.draws.short.basket.minimumUnit=v('minimumUnit');
 if(mode!=='monthly'){
  const short=input.draws.short;short.minimumFund=v('minimumFund');short.intervalSeconds=monthlyIGW?2592000:Number(v('hours'))*3600;short.basket.minimumUnit=v('minimumUnit');
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
 if(monthlyIGW){
  if(!input.draws.schedule)input.draws.short.intervalSeconds=previous.draws.short.intervalSeconds;
  input.draws=igwMonthlyDraft(input.draws);
 }
 return (v2?validateDrawLaunch:validateLaunch)(input);
}
