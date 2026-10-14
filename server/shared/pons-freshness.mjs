export const CONTRACT_MAX_AGE_MS=1860000,SOURCE_MAX_AGE_MS=660000;
export function ponsFreshness({observedAt,sourceCheckedAt,eventIdle=false,nextCheckAt,now=Date.now()}){
 const contractAge=now-Date.parse(observedAt),sourceAge=now-Number(sourceCheckedAt)*1000;
 const contractValid=Number.isFinite(contractAge)&&contractAge>=0;
 const sourceFresh=Number.isSafeInteger(sourceCheckedAt)&&sourceAge>=0&&sourceAge<=SOURCE_MAX_AGE_MS;
 const awaitingActivity=eventIdle===true&&contractValid&&sourceFresh&&(nextCheckAt===null||Number.isSafeInteger(nextCheckAt)&&nextCheckAt>now);
 return {contractVerifiedAt:observedAt,sourceCheckedAt:Number.isSafeInteger(sourceCheckedAt)?new Date(sourceCheckedAt*1000).toISOString():null,
  contractStale:!contractValid||contractAge>CONTRACT_MAX_AGE_MS,awaitingActivity,
  stale:!contractValid||!sourceFresh||contractAge>CONTRACT_MAX_AGE_MS&&!awaitingActivity};
}
