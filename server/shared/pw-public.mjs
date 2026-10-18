import {readPwService} from './pw-service.mjs';
import {writeHealthFile} from '../short-runtime/health-file.mjs';
// Public projection contains no policy, signature, private path or raw journal.
export async function publishPwService({pool,projectId,file,result,serviceObservation}){
 const {policy,state}=await readPwService(pool,projectId),r=state.runtime;
 const cycles=Object.entries(r?.cycles?.short??{}).map(([cycle,s])=>({cycle:Number(cycle),budget:s.budget,participants:s.participants.length,checkpoint:s.checkpoint,source:'Pons API'}));
 const view={schema:'pw-service-view-v1',projectId,token:policy.contracts.token.address,checkedAt:new Date().toISOString(),status:result.status,reason:result.reason??null,operation:result.operation??null,sourceCheckedAt:r?.ponsAccounting?.checkedAt??null,nextCheckAt:serviceObservation?.nextCheckAt??null,launchAt:policy.launchAt,draws:cycles,holderFundingCursor:r?.holderFundingCursor??0,lastConfirmed:state.history.at(-1)?.hash??null};
 await writeHealthFile(file,view);return view;
}
