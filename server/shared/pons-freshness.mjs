export const CONTRACT_MAX_AGE_MS=1860000,SOURCE_MAX_AGE_MS=660000;
export function ponsFreshness({observedAt,sourceCheckedAt,now=Date.now()}){
 const contractAge=now-Date.parse(observedAt),sourceAge=now-Number(sourceCheckedAt)*1000;
 return {contractVerifiedAt:observedAt,sourceCheckedAt:Number.isSafeInteger(sourceCheckedAt)?new Date(sourceCheckedAt*1000).toISOString():null,
  stale:!Number.isFinite(contractAge)||contractAge<0||contractAge>CONTRACT_MAX_AGE_MS||!Number.isSafeInteger(sourceCheckedAt)||sourceAge<0||sourceAge>SOURCE_MAX_AGE_MS};
}
