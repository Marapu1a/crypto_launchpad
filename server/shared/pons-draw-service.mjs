import {createPonsService} from './pons-service.mjs';
import {runDrawWorker} from './draw-worker.mjs';
export function drawServiceObservation(r){
 return {status:r.status==='waiting'&&r.serviceIdle===true&&['conditions','participants','native-recipient-unavailable'].includes(r.reason)?'idle':'unknown',...(r.nextCheckAt?{nextCheckAt:r.nextCheckAt*1000}:{})};
}
export function createPonsDrawService(input,options={}){
 if(!input.ponsRehearsal?.load)throw Error('Pons draw service requires its explicit rehearsal source');
 return createPonsService({...options,now:options.now??(input.now?()=>input.now()*1000:Date.now),loadReport:()=>input.ponsRehearsal.load(),
  run:async({report,sourceError})=>runDrawWorker({...input,ponsRehearsal:{load:async()=>{if(sourceError)throw sourceError;return report;}}}),
  observe:drawServiceObservation});
}
